/**
 * Excel: hoja "Actividades" (obligatoria) y hoja "Frentes" (opcional). La primera fila son los
 * encabezados; se reconocen con o sin tildes y en cualquier orden. El lector recibe las filas ya
 * extraídas (valores de celda), así funciona igual con exceljs en la web o en pruebas.
 */
import { cleanCode, toISODate, toNumber, validatePlan, type ImportFront, type ImportPlan } from "./model.js";

export type Row = unknown[];

export const ACTIVITY_COLUMNS = {
  front: ["frente", "frente codigo", "codigo frente", "zona", "bloque"],
  code: ["codigo", "codigo actividad", "id", "item"],
  name: ["nombre", "actividad", "descripcion", "nombre actividad"],
  unit: ["unidad", "und", "um", "unidad de medida"],
  quantity: ["cantidad", "cantidad contractual", "cant", "cantidad contrato"],
  start: ["inicio", "fecha inicio", "comienzo", "inicio programado"],
  finish: ["fin", "fecha fin", "final", "fin programado", "terminacion"],
  predecessors: ["predecesoras", "predecesora", "depende de", "antecesoras"],
  // Opcionales: agrupan la obra para el KPI semanal y la matriz por zona
  group: ["grupo", "grupo de trabajo", "partida", "capitulo"],
  zone: ["subcampo", "tramo", "sector", "piso", "zona de trabajo"],
  // Opcional: costo directo presupuestado por unidad (valor ganado)
  cost: ["costo unitario", "costo unitario presupuestado", "costo presupuestado", "costo directo unitario", "presupuesto unitario"],
} as const;

export const FRONT_COLUMNS = {
  code: ["codigo", "codigo frente", "frente", "id"],
  name: ["nombre", "nombre frente", "descripcion"],
  maxParallel: ["max recursos", "maximo recursos", "max recursos en paralelo", "recursos en paralelo", "saturacion"],
} as const;

/** Encabezado comparable: minúsculas, sin tildes, sin signos. */
export const normHeader = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function mapHeaders<K extends string>(header: Row, spec: Record<K, readonly string[]>): Partial<Record<K, number>> {
  const norm = header.map(normHeader);
  const out: Partial<Record<K, number>> = {};
  for (const key of Object.keys(spec) as K[]) {
    const idx = norm.findIndex((h) => spec[key].includes(h));
    if (idx >= 0) out[key] = idx;
  }
  return out;
}

const text = (v: unknown) => {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text ?? "").trim(); // celda enriquecida de exceljs
  if (typeof v === "object" && v !== null && "result" in v) return String((v as { result: unknown }).result ?? "").trim(); // fórmula
  return String(v).trim();
};
const value = (v: unknown) => (typeof v === "object" && v !== null && !(v instanceof Date) && "result" in v ? (v as { result: unknown }).result : v);

/** Costo unitario: vacío = sin costo; texto que no es número o negativo = aviso y sin costo. */
let warnCost: ((where: string, message: string) => void) | null = null;
function unitCost(v: unknown, where: string, code: string): number | null {
  if (v == null || v === "") return null;
  const n = toNumber(typeof v === "string" ? v.replace(/[$\s]/g, "") : v);
  if (n == null || n < 0) {
    warnCost?.(where, `${code}: el costo unitario "${String(v)}" no es un número.`);
    return null;
  }
  return n;
}

export function fromExcelRows(sheets: { actividades: Row[]; frentes?: Row[] | null }): ImportPlan {
  const plan: ImportPlan = { source: "excel", projectName: null, fronts: [], activities: [], warnings: [], errors: [] };
  warnCost = (where, message) => plan.warnings.push({ where, message });
  const [header, ...rows] = sheets.actividades;
  if (!header) {
    plan.errors.push({ message: "La hoja Actividades está vacía." });
    return plan;
  }
  const col = mapHeaders(header, ACTIVITY_COLUMNS);
  for (const k of ["front", "code", "name", "unit", "quantity"] as const)
    if (col[k] === undefined) plan.errors.push({ message: `Falta la columna "${ACTIVITY_COLUMNS[k][0]}" en la hoja Actividades.` });
  if (plan.errors.length) return plan;

  const fronts = new Map<string, ImportFront>();
  if (sheets.frentes?.length) {
    const [fh, ...frows] = sheets.frentes;
    const fc = mapHeaders(fh ?? [], FRONT_COLUMNS);
    if (fc.code === undefined) plan.warnings.push({ message: 'La hoja Frentes no tiene columna "codigo": se ignora.' });
    else
      frows.forEach((r) => {
        const code = cleanCode(text(r[fc.code!]));
        if (!code) return;
        fronts.set(code, {
          code,
          name: (fc.name !== undefined ? text(r[fc.name]) : "") || code,
          maxParallel: fc.maxParallel !== undefined ? toNumber(value(r[fc.maxParallel])) : null,
        });
      });
  }

  rows.forEach((r, i) => {
    const where = `Fila ${i + 2}`;
    const get = (k: keyof typeof ACTIVITY_COLUMNS) => (col[k] !== undefined ? r[col[k]!] : undefined);
    const code = cleanCode(text(get("code")));
    const name = text(get("name"));
    if (!code && !name) return; // fila vacía
    if (!code) return plan.errors.push({ where, message: "Falta el código de la actividad." });
    const frontCode = cleanCode(text(get("front")));
    if (!frontCode) return plan.errors.push({ where, message: `${code}: falta el frente.` });
    if (!fronts.has(frontCode)) fronts.set(frontCode, { code: frontCode, name: frontCode });
    const qtyRaw = value(get("quantity"));
    const quantity = toNumber(qtyRaw);
    if (quantity === null) plan.errors.push({ where, message: `${code}: la cantidad "${text(qtyRaw)}" no es un número.` });
    const startRaw = value(get("start"));
    const finishRaw = value(get("finish"));
    const start = toISODate(startRaw);
    const finish = toISODate(finishRaw);
    if (text(startRaw) && !start) plan.warnings.push({ where, message: `${code}: fecha de inicio "${text(startRaw)}" no reconocida.` });
    if (text(finishRaw) && !finish) plan.warnings.push({ where, message: `${code}: fecha de fin "${text(finishRaw)}" no reconocida.` });
    plan.activities.push({
      frontCode,
      code,
      name: name || code,
      unit: text(get("unit")) || null,
      quantity,
      start,
      finish,
      predecessors: text(get("predecessors"))
        .split(/[,;\s]+/)
        .map(cleanCode)
        .filter(Boolean),
      externalRef: null,
      ...(col.group !== undefined ? { workGroup: text(get("group")) || null } : {}),
      ...(col.zone !== undefined ? { subfield: text(get("zone")) || null } : {}),
      ...(col.cost !== undefined ? { budgetUnitCost: unitCost(value(get("cost")), where, code) } : {}),
    });
  });
  plan.fronts = [...fronts.values()];
  if (!plan.activities.length && !plan.errors.length) plan.errors.push({ message: "No se encontraron actividades en el archivo." });
  return validatePlan(plan);
}
