/**
 * Modelo común de una programación importada: frentes y actividades con fechas planeadas,
 * cantidad contractual y predecesoras (por código). Los tres lectores producen esto.
 */

export type ImportSource = "excel" | "msproject" | "primavera";

export interface ImportFront {
  code: string;
  name: string;
  maxParallel?: number | null;
}

export interface ImportActivity {
  frontCode: string;
  code: string;
  name: string;
  /** Unidad de medida. MS Project y Primavera no la traen: null conserva la existente. */
  unit: string | null;
  /** Cantidad contractual. MS Project y Primavera no la traen: queda null para completarla. */
  quantity: number | null;
  start: string | null;
  finish: string | null;
  /** Códigos de las actividades predecesoras. */
  predecessors: string[];
  /** Id en el programa de origen (UID de MS Project, task_id de Primavera, fila de Excel). */
  externalRef: string | null;
  /** Solo si el archivo los trae: peso global, zona (subcampo, tramo…) y grupo de trabajo. */
  weight?: number | null;
  subfield?: string | null;
  workGroup?: string | null;
  /** Solo si el archivo la trae: costo directo presupuestado por unidad (para el valor ganado). */
  budgetUnitCost?: number | null;
  /** Líneas base del cronograma (MS Project: 0 = la línea base, 1-10 = las demás). */
  baselines?: { name: string; start: string | null; finish: string | null }[];
  /** Avance registrado en el cronograma: % completado y fechas reales. */
  progress?: { pct: number; actualStart: string | null; actualFinish: string | null } | null;
  /** Historial diario de lo ejecutado (informe Eiffage: una columna por día). */
  history?: { date: string; quantity: number }[];
}

export interface ImportIssue {
  /** Fila (Excel) o actividad de origen. */
  where?: string;
  message: string;
}

export interface ImportPlan {
  source: ImportSource;
  projectName: string | null;
  /** Fecha de estado del cronograma (hasta cuándo está actualizado el avance). */
  statusDate?: string | null;
  fronts: ImportFront[];
  activities: ImportActivity[];
  warnings: ImportIssue[];
  errors: ImportIssue[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Normaliza una fecha a YYYY-MM-DD. Acepta Date, ISO, "YYYY-MM-DD hh:mm" (XER),
 * "dd/mm/yyyy" (formato colombiano) y número de serie de Excel.
 */
export function toISODate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") {
    if (v < 1 || v > 100_000) return null;
    // Serie de Excel: días desde 1899-12-30
    return toISODate(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000));
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return valid(y, +m[2]!, +m[1]!);
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Número con coma o punto decimal y separadores de miles ("1.234,5", "1,234.5", "2400"). */
export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  if (!s) return null;
  // Solo puntos en grupos de tres ("2.400", "1.250.000"): separador de miles, como se escribe en Colombia
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, "");
  else if (lastComma >= 0 && lastDot < 0) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Código limpio: mayúsculas, sin espacios dobles. */
export const cleanCode = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, "-").toUpperCase();

/** Validaciones comunes a cualquier fuente (duplicados, fechas invertidas, predecesoras inexistentes, ciclos). */
/** Unidades habituales en obra; otra unidad no bloquea, pero se avisa para revisar que no sea un error. */
export const KNOWN_UNITS = [
  "m", "ml", "m2", "m²", "m3", "m³", "km", "ha", "und", "un", "unid", "unidad", "unidades", "gl", "global", "kg", "t", "ton", "h", "hr", "día", "dia", "mes",
  "pilotes", "pilote", "hincas", "trackers", "tracker", "mesas", "mesa", "módulos", "modulos", "módulo", "strings", "string", "cajas", "inversores",
  "kwp", "mwp", "kw", "mw", "lote", "viaje", "viajes", "punto", "puntos",
];
const unitKey = (u: string) => u.trim().toLowerCase().replace(/\.$/, "");
export const isKnownUnit = (u: string) => KNOWN_UNITS.includes(unitKey(u));
/** Códigos: letras, números, punto, guion, guion bajo o barra; máximo 40 caracteres. */
export const VALID_CODE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,39}$/;

export function validatePlan(plan: ImportPlan): ImportPlan {
  const codes = new Map<string, number>();
  // Repetidos sin distinguir mayúsculas: "BA-HIN" y "ba-hin" son el mismo código en la obra
  const upper = new Map<string, string[]>();
  for (const a of plan.activities) {
    codes.set(a.code, (codes.get(a.code) ?? 0) + 1);
    upper.set(a.code.toUpperCase(), [...(upper.get(a.code.toUpperCase()) ?? []), a.code]);
  }
  for (const [code, n] of codes) if (n > 1) plan.errors.push({ where: code, message: `El código ${code} está repetido ${n} veces.` });
  for (const variants of upper.values()) {
    const distinct = [...new Set(variants)];
    if (distinct.length > 1) plan.errors.push({ where: distinct[0], message: `Los códigos ${distinct.join(" y ")} solo difieren en mayúsculas: en la obra serían el mismo.` });
  }
  const seenNames = new Map<string, string>();
  for (const a of plan.activities) {
    if (!VALID_CODE.test(a.code)) plan.errors.push({ where: a.code, message: `El código «${a.code}» no es válido: usa letras, números, punto, guion o barra, sin espacios (máximo 40).` });
    if (a.unit && !isKnownUnit(a.unit)) plan.warnings.push({ where: a.code, message: `La unidad «${a.unit}» no es habitual: revisa que no sea un error de digitación.` });
    if (a.quantity === 0) plan.warnings.push({ where: a.code, message: "La cantidad contractual es 0: la actividad no suma avance." });
    const key = `${a.frontCode}|${a.name.trim().toLowerCase()}`;
    if (a.name.trim() && seenNames.has(key)) plan.warnings.push({ where: a.code, message: `Posible duplicado: se llama igual que ${seenNames.get(key)} en el mismo frente.` });
    else seenNames.set(key, a.code);
  }
  const frontCodes = new Set(plan.fronts.map((f) => f.code));
  for (const a of plan.activities) {
    if (!frontCodes.has(a.frontCode)) plan.errors.push({ where: a.code, message: `El frente ${a.frontCode} no existe en el archivo.` });
    if (a.start && a.finish && a.finish < a.start) plan.errors.push({ where: a.code, message: `Termina (${a.finish}) antes de empezar (${a.start}).` });
    if (a.quantity != null && a.quantity < 0) plan.errors.push({ where: a.code, message: "La cantidad no puede ser negativa." });
    const missing = a.predecessors.filter((p) => !codes.has(p));
    if (missing.length) {
      plan.warnings.push({ where: a.code, message: `Predecesoras no encontradas (se ignoran): ${missing.join(", ")}.` });
      a.predecessors = a.predecessors.filter((p) => codes.has(p));
    }
  }
  const cycle = findCycle(plan.activities);
  if (cycle) plan.errors.push({ message: `Las predecesoras forman un ciclo: ${cycle.join(" → ")}.` });
  return plan;
}

function findCycle(acts: ImportActivity[]): string[] | null {
  const preds = new Map(acts.map((a) => [a.code, a.predecessors]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (c: string): string[] | null => {
    if (state.get(c) === 2) return null;
    if (state.get(c) === 1) return [...stack.slice(stack.indexOf(c)), c];
    state.set(c, 1);
    stack.push(c);
    for (const p of preds.get(c) ?? []) {
      const r = visit(p);
      if (r) return r;
    }
    stack.pop();
    state.set(c, 2);
    return null;
  };
  for (const a of acts) {
    const r = visit(a.code);
    if (r) return r;
  }
  return null;
}

const ZONE = /^(subcampo|tramo|bloque|piso|sector|zona)\s*[-:#]?\s*([a-z0-9]{1,6})\b/i;
const ZONE_PREFIX: Record<string, string> = { subcampo: "SC", tramo: "TR", bloque: "BL", piso: "PI", sector: "SE", zona: "ZO" };

/**
 * Zona de trabajo a partir de un nombre: "Subcampo 7" → SC07, "Tramo 3" → TR03, "Bloque A" → BLA.
 * "Subcampo 05 (Antes Subcampo 15)" usa la numeración anterior (la del cronograma original).
 */
export function zoneOf(name: string): { code: string; kind: string } | null {
  const m = ZONE.exec(name.trim());
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const before = /antes\s+subcampo\s*0*(\d{1,3})/i.exec(name)?.[1];
  const id = before ?? m[2]!;
  return { code: `${ZONE_PREFIX[kind]}${/^\d+$/.test(id) ? id.replace(/^0+(?=\d)/, "").padStart(2, "0") : id.toUpperCase()}`, kind };
}
