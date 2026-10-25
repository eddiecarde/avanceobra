import { z } from "zod";

/**
 * Definición de un formato editable (avance, inspección, checklist, informe diario).
 * Se guarda como JSON inmutable por versión; cada registro guarda la versión con que se llenó.
 */

export const SCHEMA_VERSION = 1;

export const FIELD_TYPES = [
  "section",
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "photo",
  "signature",
  "gps",
  "qr",
  "formula",
  "table",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  section: "Sección (título)",
  text: "Texto",
  number: "Número con unidad",
  select: "Lista desplegable",
  multiselect: "Selección múltiple",
  date: "Fecha",
  checkbox: "Casilla (sí / no)",
  photo: "Foto",
  signature: "Firma",
  gps: "Ubicación GPS",
  qr: "Código QR / barras",
  formula: "Fórmula calculada",
  table: "Tabla repetible",
};

/** Identificador del campo: se usa en fórmulas y condiciones (letras, números y _). */
export const FieldId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Identificador: minúsculas, números y _ (empieza con letra)");

export const ConditionOp = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "truthy", "falsy"]);
export type ConditionOp = z.infer<typeof ConditionOp>;

export type Condition =
  | { field: string; op: ConditionOp; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ field: FieldId, op: ConditionOp, value: z.unknown().optional() }),
    z.object({ all: z.array(Condition).min(1) }),
    z.object({ any: z.array(Condition).min(1) }),
  ]),
);

export const Option = z.object({ value: z.string().min(1), label: z.string().min(1) });
export type Option = z.infer<typeof Option>;

/** Tolerancia: fuera de [objetivo − menos, objetivo + más] se advierte (no bloquea). */
export const Tolerance = z.object({ target: z.number(), minus: z.number().nonnegative(), plus: z.number().nonnegative() });
export type Tolerance = z.infer<typeof Tolerance>;

const base = {
  id: FieldId,
  label: z.string().min(1).max(120),
  help: z.string().max(300).optional(),
  required: z.boolean().optional(),
  showIf: Condition.optional(),
};

const SectionField = z.object({ ...base, type: z.literal("section") });
const TextField = z.object({ ...base, type: z.literal("text"), multiline: z.boolean().optional(), maxLength: z.number().int().positive().optional() });
const NumberField = z.object({
  ...base,
  type: z.literal("number"),
  unit: z.string().max(20).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  tolerance: Tolerance.optional(),
});
const SelectField = z.object({ ...base, type: z.literal("select"), options: z.array(Option).min(1) });
const MultiSelectField = z.object({ ...base, type: z.literal("multiselect"), options: z.array(Option).min(1) });
const DateField = z.object({ ...base, type: z.literal("date") });
const CheckboxField = z.object({ ...base, type: z.literal("checkbox") });
const PhotoField = z.object({ ...base, type: z.literal("photo"), maxPhotos: z.number().int().min(1).max(5).optional() });
const SignatureField = z.object({ ...base, type: z.literal("signature") });
const GpsField = z.object({ ...base, type: z.literal("gps") });
const QrField = z.object({ ...base, type: z.literal("qr") });
const FormulaField = z.object({
  ...base,
  type: z.literal("formula"),
  expression: z.string().min(1).max(500),
  unit: z.string().max(20).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  tolerance: Tolerance.optional(),
});

/** Columnas permitidas dentro de una tabla repetible (sin tablas anidadas ni secciones). */
const ColumnField = z.discriminatedUnion("type", [
  TextField,
  NumberField,
  SelectField,
  DateField,
  CheckboxField,
  QrField,
  FormulaField,
]);
export type ColumnField = z.infer<typeof ColumnField>;

const TableField = z.object({
  ...base,
  type: z.literal("table"),
  columns: z.array(ColumnField).min(1).max(12),
  minRows: z.number().int().min(0).optional(),
  maxRows: z.number().int().min(1).max(200).optional(),
});

export const Field = z.discriminatedUnion("type", [
  SectionField,
  TextField,
  NumberField,
  SelectField,
  MultiSelectField,
  DateField,
  CheckboxField,
  PhotoField,
  SignatureField,
  GpsField,
  QrField,
  FormulaField,
  TableField,
]);
export type Field = z.infer<typeof Field>;
export type FieldOf<T extends FieldType> = Extract<Field, { type: T }>;

export const FormCategory = z.enum(["avance", "inspeccion", "checklist", "informe"]);
export type FormCategory = z.infer<typeof FormCategory>;
export const CATEGORY_LABEL: Record<FormCategory, string> = {
  avance: "Avance",
  inspeccion: "Inspección",
  checklist: "Checklist",
  informe: "Informe diario",
};

export const WORK_TYPES = ["solar", "civil", "vial", "edificacion", "redes", "mineria", "general"] as const;

export const FormDefinition = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().min(3).max(120),
  category: FormCategory,
  workType: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  fields: z.array(Field).min(1).max(150),
});
export type FormDefinition = z.infer<typeof FormDefinition>;

/** Respuestas de un formato: valores por id de campo; las tablas son arreglos de filas. */
export type Answers = Record<string, unknown>;
