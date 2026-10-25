/**
 * MS Project XML (Archivo → Guardar como → XML). Las tareas resumen de primer nivel son los
 * frentes; las tareas hoja, las actividades. Los hitos (duración 0) se omiten. Las fechas
 * planeadas son Start/Finish. MS Project no tiene cantidad contractual ni unidad: quedan para
 * completarlas en la vista previa.
 *
 * También trae, si el archivo los tiene: las líneas base (Baseline 0-10), el avance (% completado,
 * comienzo y fin reales, fecha de estado), el grupo de trabajo (la tarea resumen que agrupa) y la
 * zona (Subcampo, Tramo, Bloque, Piso, Sector) leída del nombre de la tarea o de sus resúmenes.
 */
import { cleanCode, toISODate, validatePlan, zoneOf, type ImportFront, type ImportPlan } from "./model.js";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );

/** Contenido de la primera etiqueta hija con ese nombre (sin anidar la misma etiqueta). */
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]!.trim()) : null;
};
const blocks = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]!);

interface MspTask {
  uid: string;
  id: string;
  name: string;
  wbs: string | null;
  level: number;
  summary: boolean;
  milestone: boolean;
  start: string | null;
  finish: string | null;
  preds: string[];
  pct: number;
  actualStart: string | null;
  actualFinish: string | null;
  baselines: { name: string; start: string | null; finish: string | null }[];
}

export function fromMsProjectXml(xml: string): ImportPlan {
  const plan: ImportPlan = { source: "msproject", projectName: null, fronts: [], activities: [], warnings: [], errors: [] };
  if (!/<Project[\s>]/.test(xml) || !/<Tasks>/.test(xml)) {
    plan.errors.push({ message: "El archivo no parece un XML de MS Project (falta <Project> o <Tasks>)." });
    return plan;
  }
  const tasksXml = /<Tasks>([\s\S]*)<\/Tasks>/.exec(xml)![1]!;
  // El nombre del proyecto está fuera de <Tasks>
  const header = xml.slice(0, xml.indexOf("<Tasks>"));
  plan.projectName = tag(header, "Title") ?? tag(header, "Name");
  plan.statusDate = toISODate(tag(header, "StatusDate"));

  const tasks: MspTask[] = blocks(tasksXml, "Task").flatMap((raw) => {
    let t = raw;
    if (tag(t, "IsNull") === "1" || tag(t, "Active") === "0") return [];
    // Los bloques anidados repiten Start/Finish: se leen aparte
    const baselineXml = blocks(t, "Baseline");
    t = t.replace(/<(Baseline|TimephasedData|ExtendedAttribute)>[\s\S]*?<\/\1>/g, "");
    const uid = tag(t, "UID") ?? "";
    const level = Number(tag(t, "OutlineLevel") ?? 1);
    if (uid === "0" || level === 0) return []; // tarea resumen del proyecto
    return [
      {
        uid,
        id: tag(t, "ID") ?? uid,
        name: tag(t, "Name") ?? `Tarea ${uid}`,
        wbs: tag(t, "WBS") ?? tag(t, "OutlineNumber"),
        level,
        summary: tag(t, "Summary") === "1",
        milestone: tag(t, "Milestone") === "1",
        start: toISODate(tag(t, "Start")),
        finish: toISODate(tag(t, "Finish")),
        preds: blocks(t, "PredecessorLink").map((p) => tag(p, "PredecessorUID") ?? ""),
        pct: Number(tag(t, "PercentComplete") ?? 0) || 0,
        actualStart: toISODate(tag(t, "ActualStart")),
        actualFinish: toISODate(tag(t, "ActualFinish")),
        baselines: baselineXml
          .map((b) => ({ n: Number(tag(b, "Number") ?? 0), start: toISODate(tag(b, "Start")), finish: toISODate(tag(b, "Finish")) }))
          .filter((b) => b.start || b.finish)
          .map((b) => ({ name: b.n === 0 ? "Línea base" : `Línea base ${b.n}`, start: b.start, finish: b.finish })),
      },
    ];
  });

  const fronts = new Map<string, ImportFront>();
  const codeByUid = new Map<string, string>();
  const frontOf = new Map<string, string>();
  const stack: MspTask[] = [];
  for (const t of tasks) {
    while (stack.length && stack.at(-1)!.level >= t.level) stack.pop();
    const top = stack[0];
    if (t.summary) {
      if (t.level === 1) {
        const code = frontCode(t);
        fronts.set(code, { code, name: t.name });
      }
      stack.push(t);
      continue;
    }
    if (t.milestone) {
      plan.warnings.push({ where: t.name, message: "Hito omitido (no tiene cantidad que avanzar)." });
      continue;
    }
    let fc: string;
    if (top) fc = frontCode(top);
    else {
      fc = "GENERAL";
      if (!fronts.has(fc)) fronts.set(fc, { code: fc, name: "General" });
    }
    const code = cleanCode(t.wbs || `T${t.id}`);
    codeByUid.set(t.uid, code);
    frontOf.set(t.uid, fc);
    // Grupo: el resumen que la contiene (si no es el frente); zona: la de su nombre o la de un resumen
    const parent = stack.at(-1);
    const ownZone = zoneOf(t.name);
    const zone = ownZone ?? [...stack].reverse().map((x) => zoneOf(x.name)).find(Boolean) ?? null;
    plan.activities.push({
      frontCode: fc,
      code,
      name: ownZone && parent ? `${parent.name} › ${t.name}` : t.name,
      unit: null,
      quantity: null,
      start: t.start,
      finish: t.finish,
      predecessors: [],
      externalRef: `msp:${t.uid}`,
      workGroup: parent && parent.level >= 2 ? parent.name : t.name,
      // Se aclara abajo si dos resúmenes distintos se llaman igual
      subfield: zone?.code ?? null,
      ...(t.baselines.length ? { baselines: t.baselines } : {}),
      progress: t.pct > 0 || t.actualStart ? { pct: t.pct, actualStart: t.actualStart, actualFinish: t.actualFinish } : null,
    });
  }
  // Grupos con el mismo nombre en resúmenes distintos ("Excavation" de zanjas DC y de MT): se antepone su padre
  const parentOf = new Map<string, MspTask | undefined>();
  const st: MspTask[] = [];
  for (const t of tasks) {
    while (st.length && st.at(-1)!.level >= t.level) st.pop();
    if (t.summary) st.push(t);
    else parentOf.set(t.uid, st.at(-1) && st.at(-1)!.level >= 2 ? st.at(-1) : undefined);
    if (!t.summary) parentOf.set(`${t.uid}:gp`, st.length >= 2 ? st.at(-2) : undefined);
  }
  const owners = new Map<string, Set<string>>();
  for (const t of tasks) {
    const p = parentOf.get(t.uid);
    if (p) owners.set(p.name, (owners.get(p.name) ?? new Set()).add(p.uid));
  }
  for (const t of tasks) {
    const p = parentOf.get(t.uid);
    const gp = parentOf.get(`${t.uid}:gp`);
    const code = codeByUid.get(t.uid);
    if (!p || !gp || !code || (owners.get(p.name)?.size ?? 0) < 2) continue;
    const a = plan.activities.find((x) => x.code === code);
    if (a) a.workGroup = `${gp.name} › ${p.name}`;
  }

  // Predecesoras: solo entre actividades (las de tareas resumen o hitos se descartan con aviso)
  for (const t of tasks) {
    const code = codeByUid.get(t.uid);
    if (!code) continue;
    const a = plan.activities.find((x) => x.code === code)!;
    for (const p of t.preds) {
      const pc = codeByUid.get(p);
      if (pc) a.predecessors.push(pc);
      else plan.warnings.push({ where: code, message: `Predecesora UID ${p} es un resumen o hito: se ignora.` });
    }
  }
  plan.fronts = [...fronts.values()];
  if (plan.activities.length) plan.warnings.unshift({ message: "MS Project no trae unidad ni cantidad contractual: complétalas antes de importar." });
  else plan.errors.push({ message: "No se encontraron tareas de trabajo en el archivo." });
  return validatePlan(plan);
}

function frontCode(t: MspTask) {
  const w = cleanCode(t.wbs ?? "");
  return /^\d/.test(w) || !w ? `F${w || t.id}` : w;
}
