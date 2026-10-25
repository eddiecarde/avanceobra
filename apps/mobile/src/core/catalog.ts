/**
 * Frentes y actividades creados por el administrador desde la app:
 * validaciones, unidades frecuentes y plantillas por tipo de obra.
 */

export const UNIT_OPTIONS = ["pilotes", "trackers", "módulos", "m", "m²", "m³", "und", "kg", "ton", "%"];

export interface ActivityTemplate {
  suffix: string;
  name: string;
  unit: string;
}

/** Actividades típicas de un parque solar: un toque y quedan prellenadas. */
export const SOLAR_TEMPLATES: ActivityTemplate[] = [
  { suffix: "TOP", name: "Topografía y replanteo", unit: "pilotes" },
  { suffix: "HIN", name: "Hincado de pilotes", unit: "pilotes" },
  { suffix: "MON", name: "Montaje de trackers", unit: "trackers" },
  { suffix: "MOD", name: "Instalación de módulos", unit: "módulos" },
  { suffix: "ZAN", name: "Zanjas DC", unit: "m" },
  { suffix: "CDC", name: "Tendido de cable DC", unit: "m" },
  { suffix: "CMT", name: "Tendido de cable MT", unit: "m" },
  { suffix: "INV", name: "Montaje de inversores / string boxes", unit: "und" },
  { suffix: "PAT", name: "Puesta a tierra", unit: "m" },
  { suffix: "VIA", name: "Vías internas", unit: "m²" },
  { suffix: "CER", name: "Cerramiento perimetral", unit: "m" },
  { suffix: "CIV", name: "Obra civil subestación (concreto)", unit: "m³" },
];

export interface FrontInput {
  code: string;
  name: string;
}

export interface ActivityInput {
  code: string;
  name: string;
  unit: string;
  contractQty: string;
  plannedStart: string;
  plannedFinish: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  errors: Partial<Record<keyof T, string>>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "-");

export function validateFront(f: FrontInput, existingCodes: string[], ownCode?: string): ValidationResult<FrontInput> {
  const errors: ValidationResult<FrontInput>["errors"] = {};
  const code = normalizeCode(f.code);
  if (!CODE.test(code)) errors.code = "Código de 1 a 20 caracteres: letras, números, guion.";
  else if (code !== ownCode && existingCodes.map(normalizeCode).includes(code)) errors.code = `Ya existe un frente con el código ${code}.`;
  if (f.name.trim().length < 2) errors.name = "Escribe el nombre del frente.";
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Cantidad escrita a mano, en formato colombiano o con punto decimal del teclado:
 * "1.250" y "1.250,5" usan punto de miles; "12,5" y "12.5" son doce y medio.
 */
export function parseQty(s: string): number {
  let t = s.trim().replace(/\s/g, "");
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = t === "" ? NaN : Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function validateActivity(
  a: ActivityInput,
  existingCodes: string[],
  ownCode?: string,
  executedQty = 0,
): ValidationResult<ActivityInput> {
  const errors: ValidationResult<ActivityInput>["errors"] = {};
  const code = normalizeCode(a.code);
  if (!CODE.test(code)) errors.code = "Código de 1 a 20 caracteres: letras, números, guion.";
  else if (code !== ownCode && existingCodes.map(normalizeCode).includes(code)) errors.code = `Ya existe una actividad ${code} en este frente.`;
  if (a.name.trim().length < 3) errors.name = "Escribe el nombre de la actividad.";
  if (a.unit.trim() === "") errors.unit = "Elige la unidad.";
  const qty = parseQty(a.contractQty);
  if (!(qty > 0)) errors.contractQty = "La cantidad contractual debe ser mayor que cero.";
  else if (qty < executedQty) errors.contractQty = `Ya hay ${executedQty} ejecutados; la cantidad no puede ser menor.`;
  if (a.plannedStart && !DATE.test(a.plannedStart)) errors.plannedStart = "Formato AAAA-MM-DD.";
  if (a.plannedFinish && !DATE.test(a.plannedFinish)) errors.plannedFinish = "Formato AAAA-MM-DD.";
  if (!errors.plannedStart && !errors.plannedFinish && a.plannedStart && a.plannedFinish && a.plannedFinish < a.plannedStart)
    errors.plannedFinish = "La fecha de fin es anterior al inicio.";
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Código sugerido para una actividad nueva: <frente>-<sufijo>, sin repetir. */
export function suggestActivityCode(frontCode: string, suffix: string, existing: string[]): string {
  const base = `${normalizeCode(frontCode)}-${suffix}`;
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) if (!existing.includes(`${base}${i}`)) return `${base}${i}`;
}
