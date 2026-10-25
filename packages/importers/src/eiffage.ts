/**
 * Informe diario de Eiffage (hoja "Memoria"): árbol de actividades por esquema de Excel (nivel de
 * agrupación de cada fila), con peso relativo al padre, cantidad, fechas del cronograma (Rev. 21),
 * cantidad ejecutada y una columna por día con lo ejecutado. Cada hoja del árbol se vuelve una
 * actividad; si su nombre es "Subcampo NN" queda en el frente de ese subcampo.
 *
 * El lector recibe las filas ya extraídas (valores y nivel de agrupación), así funciona igual con
 * exceljs en la web, en Node o en pruebas.
 */
import { toISODate, toNumber, validatePlan, type ImportPlan } from "./model.js";

export interface MemoriaRow {
  /** Número de fila en Excel (para los avisos). */
  row: number;
  /** Nivel de agrupación (esquema) de la fila: 0 = grupo principal. */
  outline: number;
  /** Valores de celda, columna A = índice 0. */
  values: unknown[];
}

export interface EiffageLeaf {
  code: string;
  /** Ruta legible: "Hincas › Subcampo 19". */
  name: string;
  section: string;
  /** Grupo de trabajo: el principal (nivel 0) o, si sus partes no son subcampos, cada parte. */
  group: string;
  groupCode: string | null;
  /** "SC19" para "Subcampo 19", o null si la actividad es general. */
  subfield: string | null;
  unit: string;
  quantity: number;
  start: string | null;
  finish: string | null;
  /** Peso en el avance global (suma 1 entre todas las hojas). */
  weight: number;
  executed: number;
  /** Lo ejecutado cada día, según las columnas diarias. */
  daily: { date: string; quantity: number }[];
  sourceRow: number;
}

export interface EiffageSupply {
  name: string;
  unit: string;
  quantity: number;
  date: string | null;
}

export interface EiffageReport {
  cutoff: string | null;
  sections: { name: string; weight: number; leaves: number }[];
  leaves: EiffageLeaf[];
  supplies: EiffageSupply[];
  warnings: string[];
}

/** Columnas de la hoja Memoria (A = 0). */
const COL = { code: 0, name: 1, unit: 2, weight: 3, quantity: 4, start: 5, finish: 6, executed: 12 } as const;

/** Pesos por sección cuando el informe no los trae (hoja "Resumen SC": civiles 10 %, mecánicos 45 %, eléctricos 45 %). */
export const DEFAULT_SECTION_WEIGHTS: Record<string, number> = { "civil works": 0.1, "mechanical works": 0.45, "electrical work": 0.45 };

const SUBFIELD = /^subcampo\s*0*(\d{1,3})\b/i;

const BEFORE = /antes\s+subcampo\s*0*(\d{1,3})/i;

/**
 * Subcampo con la numeración original del cronograma (la del .mpp, la hoja Energización y las
 * filas sin renombrar): "Subcampo 05 (Antes Subcampo 15)" → "SC15"; "Subcampo 07" → "SC07".
 */
export function subfieldOf(name: string): string | null {
  const m = SUBFIELD.exec(name.trim());
  if (!m) return null;
  const n = BEFORE.exec(name)?.[1] ?? m[1]!;
  return `SC${n.padStart(2, "0")}`;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Código corto a partir del nombre: "Cableado BT (tendido)" → "CBT-TEND". */
function abbreviate(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["DE", "DEL", "LA", "EL", "Y", "EN", "POR", "A", "LOS", "LAS", "M"].includes(w));
  return (words.map((w) => (w.length <= 3 ? w : w.slice(0, 3))).join("-") || "ACT").slice(0, 24);
}

interface Node {
  r: MemoriaRow;
  name: string;
  unit: string;
  weight: number | null;
  children: Node[];
}

/**
 * Lee la hoja Memoria. `header` es la fila de encabezados (fila 7) y `kinds` la fila que marca
 * cada columna como "Daily" o "Week" (fila 8): solo las diarias cuentan como avance del día.
 */
export function parseEiffageMemoria(
  rows: MemoriaRow[],
  header: unknown[],
  kinds: unknown[],
  opts: { cutoff?: string | null; sectionWeights?: Record<string, number> } = {},
): EiffageReport {
  const warnings: string[] = [];
  const dayCols: { col: number; date: string }[] = [];
  header.forEach((h, col) => {
    const date = h instanceof Date || typeof h === "number" ? toISODate(h) : null;
    if (date && clean(kinds[col]).toLowerCase() === "daily") dayCols.push({ col, date });
  });
  if (!dayCols.length) warnings.push("No se encontraron columnas diarias (fila 8 marcada como Daily): no habrá historial de avance.");

  // Árbol por secciones: una fila sin unidad ni cantidad en el nivel 0 abre una sección
  const sections: { name: string; nodes: Node[] }[] = [];
  const supplies: EiffageSupply[] = [];
  let stack: Node[] = [];
  for (const r of rows) {
    const name = clean(r.values[COL.name]);
    if (!name) continue;
    const unit = clean(r.values[COL.unit]);
    const qty = toNumber(r.values[COL.quantity]);
    // Dentro de "Suministro" los títulos sin unidad (CABLE BT, CABLE MT) son subtítulos, no secciones
    const inSupplies = /^suministro/i.test(sections.at(-1)?.name ?? "");
    if (r.outline === 0 && !unit && qty == null && !inSupplies) {
      sections.push({ name, nodes: [] });
      stack = [];
      continue;
    }
    const section = sections.at(-1);
    if (!section) continue;
    // La sección de suministros no es obra: se guarda aparte (materiales)
    if (/^suministro/i.test(section.name)) {
      if (unit && qty != null) supplies.push({ name, unit, quantity: qty, date: toISODate(r.values[COL.start]) });
      continue;
    }
    const node: Node = { r, name, unit, weight: toNumber(r.values[COL.weight]), children: [] };
    while (stack.length && stack.at(-1)!.r.outline >= r.outline) stack.pop();
    if (stack.length) stack.at(-1)!.children.push(node);
    else section.nodes.push(node);
    stack.push(node);
  }

  const sectionWeights = opts.sectionWeights ?? DEFAULT_SECTION_WEIGHTS;
  const workSections = sections.filter((s) => s.nodes.length);
  const rawSectionW = workSections.map((s) => sectionWeights[s.name.toLowerCase()] ?? null);
  if (rawSectionW.some((w) => w == null)) warnings.push("Hay secciones sin peso conocido: se reparten por igual.");
  const sectionW = normalize(rawSectionW.map((w) => w ?? 1));

  const leaves: EiffageLeaf[] = [];
  const usedCodes = new Set<string>();
  const uniqueCode = (base: string) => {
    let code = base.slice(0, 40);
    for (let i = 2; usedCodes.has(code); i++) code = `${base.slice(0, 36)}-${i}`;
    usedCodes.add(code);
    return code;
  };

  workSections.forEach((s, si) => {
    walk(s.nodes, sectionW[si]!, [], null, null, null);
    function walk(nodes: Node[], parentWeight: number, path: string[], groupName: string | null, groupCode: string | null, workGroup: string | null) {
      // Pesos de los hijos normalizados: el informe a veces los da relativos al padre y a veces globales
      const given = nodes.map((n) => n.weight);
      let shares: number[];
      if (given.every((w) => w != null && w > 0)) shares = normalize(given as number[]);
      else {
        const sameUnit = new Set(nodes.map((n) => n.unit.toLowerCase())).size === 1;
        const qtys = nodes.map((n) => toNumber(n.r.values[COL.quantity]) ?? 0);
        shares = sameUnit && qtys.some((q) => q > 0) ? normalize(qtys) : normalize(nodes.map(() => 1));
      }
      // Un grupo cuyas partes son etapas con su propio desglose (Drainages: cunetas, ODT, vados;
      // vías: subrasante, subbase, base) se divide: cada etapa es su propio grupo de trabajo. Si alguna
      // parte es una hoja (tipos de zanja, elementos del campamento) el grupo queda entero
      const split = path.length === 1 && nodes.length >= 2 && nodes.every((c) => !subfieldOf(c.name) && c.children.length > 0);
      nodes.forEach((n, i) => {
        const w = parentWeight * shares[i]!;
        const gName = groupName ?? n.name;
        const gCode = groupCode ?? (clean(n.r.values[COL.code]) || null);
        const wg = split ? partName(gName, n.name) : (workGroup ?? gName);
        if (n.children.length) return walk(n.children, w, [...path, n.name], gName, gCode, wg);
        const quantity = toNumber(n.r.values[COL.quantity]);
        if (quantity == null || quantity <= 0) {
          warnings.push(`Fila ${n.r.row}: "${n.name}" sin cantidad; no se importa.`);
          return;
        }
        const subfield = subfieldOf(n.name);
        const base = `${gCode && /^[A-Z]{2}\.[A-Z]{2}/.test(gCode) ? gCode : abbreviate(gName)}${path.length > 1 ? `-${abbreviate(path.at(-1)!).split("-")[0]}` : ""}`;
        const daily = dayCols
          .map(({ col, date }) => ({ date, quantity: toNumber(n.r.values[col]) ?? 0 }))
          .filter((d) => d.quantity !== 0 && (!opts.cutoff || d.date <= opts.cutoff));
        leaves.push({
          code: uniqueCode(subfield ? `${base}-${subfield}` : `${base}-${abbreviate(n.name).split("-").slice(0, 2).join("")}`),
          name: [...path, subfield ? `Subcampo ${subfield.slice(2)}` : n.name].join(" › "),
          section: s.name,
          group: wg,
          groupCode: gCode,
          subfield,
          unit: n.unit || "Ud",
          quantity,
          start: toISODate(n.r.values[COL.start]),
          finish: toISODate(n.r.values[COL.finish]),
          weight: w,
          executed: toNumber(n.r.values[COL.executed]) ?? 0,
          daily,
          sourceRow: n.r.row,
        });
      });
    }
  });

  return {
    cutoff: opts.cutoff ?? null,
    sections: workSections.map((s, i) => ({ name: s.name, weight: sectionW[i]!, leaves: leaves.filter((l) => l.section === s.name).length })),
    leaves,
    supplies,
    warnings,
  };
}

/** Nombre de una parte de un grupo: "Internal Roads (Subrasante)(m)" ya lo dice; "Cunetas" → "Drainages › Cunetas". */
function partName(group: string, part: string): string {
  const key = group.toLowerCase().split(/[\s(]+/)[0]!.slice(0, 5);
  return part.toLowerCase().includes(key) ? part : `${group} › ${part}`;
}

function normalize(xs: number[]): number[] {
  const t = xs.reduce((a, b) => a + b, 0);
  return t > 0 ? xs.map((x) => x / t) : xs.map(() => 1 / xs.length);
}

/**
 * Convierte el informe en una programación importable: un frente por subcampo (y "GEN" para la
 * obra general) y una actividad por hoja, con su peso, subcampo y grupo de trabajo.
 */
export function eiffageToPlan(rep: EiffageReport): ImportPlan {
  const subfields = [...new Set(rep.leaves.map((l) => l.subfield).filter(Boolean) as string[])].sort();
  const warnings = rep.warnings.map((message) => ({ message }));
  const activities = rep.leaves.map((l) => {
    let finish = l.finish;
    if (l.start && finish && finish < l.start) {
      warnings.push({ message: `Fila ${l.sourceRow}: termina (${finish}) antes de empezar (${l.start}); se usa la fecha de inicio como fin.` });
      finish = l.start;
    }
    return {
      frontCode: l.subfield ?? "GEN",
      code: l.code,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      start: l.start,
      finish,
      predecessors: [],
      externalRef: `Memoria!${l.sourceRow}`,
      weight: l.weight,
      subfield: l.subfield,
      workGroup: l.group,
      history: l.daily.filter((d) => d.quantity > 0),
    };
  });
  return validatePlan({
    source: "excel",
    projectName: null,
    fronts: [...subfields.map((sf) => ({ code: sf, name: `Subcampo ${sf.slice(2)}` })), { code: "GEN", name: "Obras generales" }],
    activities,
    warnings,
    errors: [],
  });
}
