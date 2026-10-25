import { FormulaError, formulaRefs } from "./expr.js";
import {
  FIELD_TYPES,
  FormDefinition,
  SCHEMA_VERSION,
  type ColumnField,
  type Condition,
  type Field,
  type FieldType,
  type FormCategory,
} from "./schema.js";

export interface DefinitionIssue {
  fieldId?: string;
  message: string;
}

function conditionFields(c: Condition): string[] {
  if ("all" in c) return c.all.flatMap(conditionFields);
  if ("any" in c) return c.any.flatMap(conditionFields);
  return [c.field];
}

/**
 * Revisa un formato antes de publicarlo: estructura válida, ids únicos, fórmulas que
 * compilan y solo usan campos existentes (sin ciclos), y condiciones que miran campos
 * anteriores (para que el supervisor llene en orden).
 */
export function validateDefinition(input: unknown): { ok: boolean; issues: DefinitionIssue[]; definition?: FormDefinition } {
  const parsed = FormDefinition.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ message: `${i.path.join(".") || "formato"}: ${i.message}` })),
    };
  }
  const def = parsed.data;
  const issues: DefinitionIssue[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, Field>();

  const checkFormula = (f: { id: string; expression: string }, scope: Set<string>, tableIds: Set<string>) => {
    try {
      for (const r of formulaRefs(f.expression)) {
        if (r === f.id) issues.push({ fieldId: f.id, message: "La fórmula no puede usarse a sí misma" });
        else if (!scope.has(r) && !tableIds.has(r)) issues.push({ fieldId: f.id, message: `La fórmula usa "${r}", que no existe` });
      }
    } catch (e) {
      issues.push({ fieldId: f.id, message: e instanceof FormulaError ? e.message : String(e) });
    }
  };

  const allIds = new Set(def.fields.map((f) => f.id));
  const tableIds = new Set(def.fields.filter((f) => f.type === "table").map((f) => f.id));

  def.fields.forEach((f) => {
    if (seen.has(f.id)) issues.push({ fieldId: f.id, message: `El identificador "${f.id}" está repetido` });
    seen.add(f.id);
    byId.set(f.id, f);
    if (f.type === "formula") checkFormula(f, allIds, tableIds);
    if (f.type === "select" || f.type === "multiselect") {
      const vals = f.options.map((o) => o.value);
      if (new Set(vals).size !== vals.length) issues.push({ fieldId: f.id, message: "Hay opciones repetidas" });
    }
    if (f.type === "table") {
      const colIds = new Set<string>();
      for (const c of f.columns) {
        if (colIds.has(c.id)) issues.push({ fieldId: `${f.id}.${c.id}`, message: `Columna "${c.id}" repetida` });
        colIds.add(c.id);
      }
      for (const c of f.columns) if (c.type === "formula") checkFormula(c, new Set([...colIds, ...allIds]), tableIds);
    }
    if (f.showIf) {
      for (const ref of conditionFields(f.showIf)) {
        if (!byId.has(ref) || ref === f.id)
          issues.push({ fieldId: f.id, message: `La condición usa "${ref}", que debe ser un campo anterior` });
      }
    }
    if (f.type === "number" && f.min !== undefined && f.max !== undefined && f.min > f.max)
      issues.push({ fieldId: f.id, message: "El mínimo es mayor que el máximo" });
  });

  // Ciclos entre fórmulas de nivel superior
  const formulas = new Map(def.fields.filter((f) => f.type === "formula").map((f) => [f.id, f.type === "formula" ? safeRefs(f.expression) : []]));
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    const cyc = (formulas.get(id) ?? []).some((r) => formulas.has(r) && visit(r));
    state.set(id, 2);
    return cyc;
  };
  for (const id of formulas.keys()) {
    state.clear();
    if (visit(id)) {
      issues.push({ fieldId: id, message: "Las fórmulas forman un ciclo" });
      break;
    }
  }

  return { ok: issues.length === 0, issues, definition: def };
}

function safeRefs(expr: string): string[] {
  try {
    return formulaRefs(expr);
  } catch {
    return [];
  }
}

/** Comparación estable (para no publicar una versión idéntica a la anterior). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export const sameDefinition = (a: FormDefinition, b: FormDefinition) => stableStringify(a) === stableStringify(b);

/** Id nuevo y único a partir de la etiqueta: "Profundidad final" → "profundidad_final". */
export function slugId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "c_$1")
      .slice(0, 32) || "campo";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Campo nuevo con valores por defecto, para el constructor. */
export function newField(type: FieldType, taken: Iterable<string>): Field {
  const label = {
    section: "Nueva sección",
    text: "Texto",
    number: "Cantidad",
    select: "Lista",
    multiselect: "Selección múltiple",
    date: "Fecha",
    checkbox: "Verificado",
    photo: "Foto",
    signature: "Firma",
    gps: "Ubicación",
    qr: "Código",
    formula: "Resultado",
    table: "Tabla",
  }[type];
  const id = slugId(label, taken);
  switch (type) {
    case "select":
    case "multiselect":
      return { id, label, type, options: [{ value: "opcion_1", label: "Opción 1" }, { value: "opcion_2", label: "Opción 2" }] };
    case "formula":
      return { id, label, type, expression: "0" };
    case "table":
      return { id, label, type, columns: [{ id: "valor", label: "Valor", type: "number" }] };
    default:
      return { id, label, type } as Field;
  }
}

export function emptyDefinition(name: string, category: FormCategory, workType: string): FormDefinition {
  return { schemaVersion: SCHEMA_VERSION, name, category, workType, fields: [{ id: "observaciones", label: "Observaciones", type: "text", multiline: true }] };
}

// ---------- Excel: una fila por campo ----------

export const SHEET_HEADER = [
  "id",
  "etiqueta",
  "tipo",
  "obligatorio",
  "unidad",
  "minimo",
  "maximo",
  "decimales",
  "opciones",
  "formula",
  "tolerancia_objetivo",
  "tolerancia_menos",
  "tolerancia_mas",
  "mostrar_si",
  "ayuda",
  "tabla",
] as const;

type Cell = string | number | boolean | null;

const enc = (opts?: { value: string; label: string }[]) => (opts ?? []).map((o) => (o.value === o.label ? o.label : `${o.value}=${o.label}`)).join("; ");
const dec = (s: string) =>
  s
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [v, ...rest] = x.split("=");
      const label = rest.length ? rest.join("=").trim() : v!.trim();
      return { value: rest.length ? v!.trim() : slugId(label, []), label };
    });

function fieldRow(f: Field | ColumnField, table = ""): Cell[] {
  const g = f as Record<string, unknown>;
  const tol = g.tolerance as { target: number; minus: number; plus: number } | undefined;
  return [
    f.id,
    f.label,
    f.type,
    f.required ? "si" : "",
    (g.unit as string) ?? "",
    (g.min as number) ?? "",
    (g.max as number) ?? "",
    (g.decimals as number) ?? "",
    enc(g.options as { value: string; label: string }[] | undefined),
    (g.expression as string) ?? "",
    tol?.target ?? "",
    tol?.minus ?? "",
    tol?.plus ?? "",
    f.showIf ? JSON.stringify(f.showIf) : "",
    f.help ?? "",
    table,
  ];
}

/** Hoja de Excel: encabezado + una fila por campo; las columnas de tabla llevan el id de la tabla. */
export function toSheetRows(def: FormDefinition): Cell[][] {
  const rows: Cell[][] = [[...SHEET_HEADER]];
  for (const f of def.fields) {
    rows.push(fieldRow(f));
    if (f.type === "table") f.columns.forEach((c) => rows.push(fieldRow(c, f.id)));
  }
  return rows;
}

/** Lee la hoja (mismo formato que toSheetRows) y arma la definición; luego se valida con validateDefinition. */
export function fromSheetRows(rows: Cell[][], meta: Pick<FormDefinition, "name" | "category" | "workType">): unknown {
  const [header, ...body] = rows;
  const idx = (k: (typeof SHEET_HEADER)[number]) => (header ?? []).findIndex((h) => String(h ?? "").trim().toLowerCase() === k);
  const get = (r: Cell[], k: (typeof SHEET_HEADER)[number]) => {
    const i = idx(k);
    const v = i >= 0 ? r[i] : null;
    return v === null || v === undefined ? "" : String(v).trim();
  };
  const num = (s: string) => (s === "" ? undefined : Number(s.replace(",", ".")));
  const fields: Record<string, unknown>[] = [];
  for (const r of body) {
    const type = get(r, "tipo") as FieldType;
    if (!get(r, "id") && !get(r, "etiqueta")) continue;
    const f: Record<string, unknown> = {
      id: get(r, "id") || slugId(get(r, "etiqueta"), fields.map((x) => String(x.id))),
      label: get(r, "etiqueta"),
      type: (FIELD_TYPES as readonly string[]).includes(type) ? type : "text",
    };
    if (/^(si|sí|x|true|1)$/i.test(get(r, "obligatorio"))) f.required = true;
    if (get(r, "unidad")) f.unit = get(r, "unidad");
    if (num(get(r, "minimo")) !== undefined) f.min = num(get(r, "minimo"));
    if (num(get(r, "maximo")) !== undefined) f.max = num(get(r, "maximo"));
    if (num(get(r, "decimales")) !== undefined) f.decimals = num(get(r, "decimales"));
    if (get(r, "opciones")) f.options = dec(get(r, "opciones"));
    if (get(r, "formula")) f.expression = get(r, "formula");
    if (get(r, "tolerancia_objetivo"))
      f.tolerance = { target: num(get(r, "tolerancia_objetivo")), minus: num(get(r, "tolerancia_menos")) ?? 0, plus: num(get(r, "tolerancia_mas")) ?? 0 };
    if (get(r, "mostrar_si")) {
      try {
        f.showIf = JSON.parse(get(r, "mostrar_si"));
      } catch {
        /* condición ilegible: validateDefinition lo reportará al faltar */
      }
    }
    if (get(r, "ayuda")) f.help = get(r, "ayuda");
    const table = get(r, "tabla");
    if (table) {
      const parent = fields.find((x) => x.id === table && x.type === "table");
      if (parent) ((parent.columns as unknown[]) ??= []).push(f);
      continue;
    }
    if (f.type === "table") f.columns = [];
    fields.push(f);
  }
  return { schemaVersion: SCHEMA_VERSION, ...meta, fields };
}
