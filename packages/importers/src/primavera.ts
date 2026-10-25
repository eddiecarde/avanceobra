/**
 * Primavera P6 XER (exportación de proyecto). Formato de texto separado por tabuladores:
 * "%T" tabla, "%F" campos, "%R" filas. Se usan PROJECT, PROJWBS, TASK y TASKPRED.
 * Frentes = nodos EPS/WBS de primer nivel bajo el proyecto; actividades = TASK que no son
 * hitos ni nivel de esfuerzo. Fechas planeadas: target_start_date / target_end_date.
 */
import { cleanCode, toISODate, validatePlan, zoneOf, type ImportFront, type ImportPlan } from "./model.js";

export type XerTables = Record<string, Record<string, string>[]>;

export function parseXer(text: string): XerTables {
  const tables: XerTables = {};
  let current: string | null = null;
  let fields: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cols = raw.split("\t");
    switch (cols[0]) {
      case "%T":
        current = cols[1]?.trim() ?? null;
        if (current) tables[current] = [];
        fields = [];
        break;
      case "%F":
        fields = cols.slice(1).map((f) => f.trim());
        break;
      case "%R":
        if (current) tables[current]!.push(Object.fromEntries(fields.map((f, i) => [f, (cols[i + 1] ?? "").trim()])));
        break;
    }
  }
  return tables;
}

export function fromPrimaveraXer(text: string, projectId?: string): ImportPlan {
  const plan: ImportPlan = { source: "primavera", projectName: null, fronts: [], activities: [], warnings: [], errors: [] };
  if (!text.startsWith("ERMHDR")) {
    plan.errors.push({ message: "El archivo no parece un XER de Primavera (debe empezar con ERMHDR)." });
    return plan;
  }
  const t = parseXer(text);
  const projects = t.PROJECT ?? [];
  const tasksAll = t.TASK ?? [];
  if (!projects.length || !tasksAll.length) {
    plan.errors.push({ message: "El XER no trae las tablas PROJECT y TASK." });
    return plan;
  }
  // Con varios proyectos se toma el indicado o el que tiene más actividades
  const counts = new Map<string, number>();
  tasksAll.forEach((x) => counts.set(x.proj_id!, (counts.get(x.proj_id!) ?? 0) + 1));
  const proj = projects.find((p) => p.proj_id === projectId) ?? [...projects].sort((a, b) => (counts.get(b.proj_id!) ?? 0) - (counts.get(a.proj_id!) ?? 0))[0]!;
  if (projects.length > 1) plan.warnings.push({ message: `El archivo trae ${projects.length} proyectos; se importa ${proj.proj_short_name}.` });
  plan.projectName = proj.proj_short_name ?? null;
  plan.statusDate = toISODate(proj.last_recalc_date);

  const wbs = (t.PROJWBS ?? []).filter((w) => w.proj_id === proj.proj_id);
  const byId = new Map(wbs.map((w) => [w.wbs_id!, w]));
  const root = wbs.find((w) => w.proj_node_flag === "Y");
  /** Nodo de primer nivel (hijo directo de la raíz del proyecto) que contiene a este WBS. */
  const topOf = (id: string | undefined): Record<string, string> | null => {
    let node = id ? byId.get(id) : undefined;
    let guard = 0;
    while (node && guard++ < 100) {
      if (node.parent_wbs_id === root?.wbs_id || !byId.has(node.parent_wbs_id!)) return node.proj_node_flag === "Y" ? null : node;
      node = byId.get(node.parent_wbs_id!);
    }
    return null;
  };

  const fronts = new Map<string, ImportFront>();
  const codeByTask = new Map<string, string>();
  for (const x of tasksAll.filter((x) => x.proj_id === proj.proj_id)) {
    const type = x.task_type ?? "TT_Task";
    if (type === "TT_Mile" || type === "TT_FinMile") {
      plan.warnings.push({ where: x.task_code, message: "Hito omitido (no tiene cantidad que avanzar)." });
      continue;
    }
    if (type === "TT_LOE" || type === "TT_WBS") {
      plan.warnings.push({ where: x.task_code, message: "Actividad de nivel de esfuerzo o resumen omitida." });
      continue;
    }
    const top = topOf(x.wbs_id);
    const node = byId.get(x.wbs_id!);
    let fc: string;
    if (top) {
      fc = cleanCode(top.wbs_short_name || `W${top.wbs_id}`);
      if (!fronts.has(fc)) fronts.set(fc, { code: fc, name: top.wbs_name || fc });
    } else {
      fc = "GENERAL";
      if (!fronts.has(fc)) fronts.set(fc, { code: fc, name: "General" });
    }
    const code = cleanCode(x.task_code || `A${x.task_id}`);
    codeByTask.set(x.task_id!, code);
    plan.activities.push({
      frontCode: fc,
      code,
      name: x.task_name || code,
      unit: null,
      quantity: null,
      start: toISODate(x.target_start_date || x.early_start_date),
      finish: toISODate(x.target_end_date || x.early_end_date),
      predecessors: [],
      externalRef: `p6:${x.task_id}`,
      // Grupo: el nodo WBS de la actividad (si no es el frente); zona: del nombre o del WBS
      workGroup: node && node !== top && node.proj_node_flag !== "Y" ? node.wbs_name || null : x.task_name || null,
      subfield: (zoneOf(x.task_name ?? "") ?? zoneOf(node?.wbs_name ?? ""))?.code ?? null,
      progress:
        Number(x.phys_complete_pct ?? 0) > 0 || x.act_start_date
          ? { pct: Number(x.phys_complete_pct ?? 0) || 0, actualStart: toISODate(x.act_start_date), actualFinish: toISODate(x.act_end_date) }
          : null,
    });
  }
  for (const p of t.TASKPRED ?? []) {
    const succ = codeByTask.get(p.task_id!);
    const pred = codeByTask.get(p.pred_task_id!);
    if (!succ) continue;
    if (!pred) {
      plan.warnings.push({ where: succ, message: "Predecesora en otro proyecto, hito o resumen: se ignora." });
      continue;
    }
    const a = plan.activities.find((y) => y.code === succ)!;
    if (!a.predecessors.includes(pred)) a.predecessors.push(pred);
  }
  plan.fronts = [...fronts.values()];
  if (plan.activities.length) plan.warnings.unshift({ message: "Primavera no trae unidad ni cantidad contractual: complétalas antes de importar." });
  else plan.errors.push({ message: "No se encontraron actividades en el proyecto." });
  return validatePlan(plan);
}
