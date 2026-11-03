import { evaluateFormula, formulaRefs } from "./expr.js";
import type { Answers, ColumnField, Condition, Field, FormDefinition, Tolerance } from "./schema.js";

/** Lógica condicional: ¿se muestra el campo con las respuestas actuales? */
export function evalCondition(c: Condition, values: Answers): boolean {
  if ("all" in c) return c.all.every((x) => evalCondition(x, values));
  if ("any" in c) return c.any.some((x) => evalCondition(x, values));
  const v = values[c.field];
  const num = (x: unknown) => (typeof x === "number" ? x : Number(x));
  switch (c.op) {
    case "truthy":
      return Array.isArray(v) ? v.length > 0 : Boolean(v) && v !== "0";
    case "falsy":
      return Array.isArray(v) ? v.length === 0 : !v || v === "0";
    case "eq":
      return Array.isArray(v) ? v.includes(c.value) : String(v ?? "") === String(c.value ?? "");
    case "neq":
      return Array.isArray(v) ? !v.includes(c.value) : String(v ?? "") !== String(c.value ?? "");
    case "in":
      return Array.isArray(c.value) && c.value.map(String).includes(String(v));
    case "gt":
      return num(v) > num(c.value);
    case "gte":
      return num(v) >= num(c.value);
    case "lt":
      return num(v) < num(c.value);
    case "lte":
      return num(v) <= num(c.value);
  }
}

export function isVisible(f: { showIf?: Condition }, values: Answers): boolean {
  return !f.showIf || evalCondition(f.showIf, values);
}

const round = (n: number, d?: number) => (d === undefined ? n : Math.round(n * 10 ** d) / 10 ** d);

/** Orden de cálculo de las fórmulas: primero las que no dependen de otras fórmulas. */
function formulaOrder(fields: { id: string; type: string; expression?: string }[]): string[] {
  const formulas = new Map(fields.filter((f) => f.type === "formula").map((f) => [f.id, formulaRefs(f.expression!)]));
  const done: string[] = [];
  const state = new Map<string, number>();
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`Las fórmulas forman un ciclo en "${id}"`);
    state.set(id, 1);
    for (const r of formulas.get(id) ?? []) if (formulas.has(r)) visit(r);
    state.set(id, 2);
    done.push(id);
  };
  [...formulas.keys()].forEach(visit);
  return done;
}

/** Calcula todas las fórmulas (también las de las columnas de cada fila de tabla). */
export function computeFormulas(def: Pick<FormDefinition, "fields">, values: Answers): Answers {
  const out: Answers = { ...values };
  for (const t of def.fields) {
    if (t.type !== "table" || !Array.isArray(out[t.id])) continue;
    const order = formulaOrder(t.columns);
    out[t.id] = (out[t.id] as Answers[]).map((row) => {
      const r: Answers = { ...row };
      for (const id of order) {
        const col = t.columns.find((c) => c.id === id) as Extract<ColumnField, { type: "formula" }>;
        const v = evaluateFormula(col.expression, { ...out, ...r });
        r[id] = Number.isFinite(v) ? round(v, col.decimals) : null;
      }
      return r;
    });
  }
  for (const id of formulaOrder(def.fields)) {
    const f = def.fields.find((x) => x.id === id) as Extract<Field, { type: "formula" }>;
    const v = evaluateFormula(f.expression, out);
    out[id] = Number.isFinite(v) ? round(v, f.decimals) : null;
  }
  return out;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "number" && Number.isNaN(v));

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 4 });

function checkTolerance(t: Tolerance, n: number, unit = ""): string | null {
  const lo = t.target - t.minus;
  const hi = t.target + t.plus;
  if (n < lo || n > hi) return `Fuera de tolerancia: ${fmt(n)}${unit ? " " + unit : ""} (admisible ${fmt(lo)} a ${fmt(hi)})`;
  return null;
}

export interface AnswerCheck {
  /** Bloquean el guardado. */
  errors: Record<string, string>;
  /** Avisan (tolerancias), pero dejan guardar. */
  warnings: Record<string, string>;
  ok: boolean;
}

function checkValue(f: Field | ColumnField, v: unknown, key: string, res: AnswerCheck) {
  if (f.type === "section") return;
  if (isEmpty(v)) {
    if (f.required && f.type !== "formula") res.errors[key] = "Obligatorio";
    return;
  }
  if (f.type === "number" || f.type === "formula") {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) {
      res.errors[key] = "Debe ser un número";
      return;
    }
    if (f.type === "number" && f.min !== undefined && n < f.min) res.errors[key] = `Mínimo ${fmt(f.min)}${f.unit ? " " + f.unit : ""}`;
    else if (f.type === "number" && f.max !== undefined && n > f.max) res.errors[key] = `Máximo ${fmt(f.max)}${f.unit ? " " + f.unit : ""}`;
    else if (f.tolerance) {
      const w = checkTolerance(f.tolerance, n, f.unit);
      if (w) res.warnings[key] = w;
    }
  }
  if (f.type === "text" && f.maxLength && String(v).length > f.maxLength) res.errors[key] = `Máximo ${f.maxLength} caracteres`;
  if ((f.type === "select" || f.type === "multiselect") && f.options) {
    const allowed = new Set(f.options.map((o) => o.value));
    const vals = Array.isArray(v) ? v : [v];
    if (vals.some((x) => !allowed.has(String(x)))) res.errors[key] = "Opción no válida";
  }
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) res.errors[key] = "Fecha AAAA-MM-DD";
}

/**
 * Valida las respuestas: obligatorios (solo si el campo está visible), rangos, opciones,
 * filas de tablas y tolerancias. Las claves de tabla son "tabla[fila].columna".
 */
export function validateAnswers(def: Pick<FormDefinition, "fields">, raw: Answers): AnswerCheck {
  const values = computeFormulas(def, raw);
  const res: AnswerCheck = { errors: {}, warnings: {}, ok: true };
  for (const f of def.fields) {
    if (!isVisible(f, values)) continue;
    if (f.type === "table") {
      const rows = Array.isArray(values[f.id]) ? (values[f.id] as Answers[]) : [];
      if (f.required && rows.length === 0) res.errors[f.id] = "Agrega al menos una fila";
      if (f.minRows !== undefined && rows.length < f.minRows) res.errors[f.id] = `Mínimo ${f.minRows} filas`;
      if (f.maxRows !== undefined && rows.length > f.maxRows) res.errors[f.id] = `Máximo ${f.maxRows} filas`;
      rows.forEach((row, i) => f.columns.forEach((c) => checkValue(c, row[c.id], `${f.id}[${i}].${c.id}`, res)));
      continue;
    }
    checkValue(f, values[f.id], f.id, res);
  }
  res.ok = Object.keys(res.errors).length === 0;
  return res;
}

/** Quita respuestas de campos ocultos para no guardar datos que ya no aplican. */
export function pruneHidden(def: Pick<FormDefinition, "fields">, values: Answers): Answers {
  const out: Answers = {};
  for (const f of def.fields) if (f.type !== "section" && isVisible(f, values) && values[f.id] !== undefined) out[f.id] = values[f.id];
  return out;
}
