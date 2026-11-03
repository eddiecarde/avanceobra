/**
 * Bandeja de aprobación: señales que conviene mirar antes de aprobar un registro y el orden en que
 * se revisan (primero los que tienen señales, luego los más antiguos). Las señales ayudan; la
 * decisión es del residente.
 */
export interface ReviewEntry {
  id: string;
  work_date: string;
  quantity: number;
  contract_qty: number;
  /** Lo registrado antes de este (aprobado o enviado), de la misma actividad. */
  executed_before: number;
  elements: number;
  photos: number;
  has_gps: boolean;
  unit: string;
}

/** Motivos estandarizados de rechazo (se puede agregar un comentario). */
export const REJECT_REASONS = [
  "Falta foto o la foto no corresponde",
  "La cantidad no cuadra con lo verificado",
  "Actividad o frente equivocado",
  "Fecha equivocada",
  "Registro duplicado",
] as const;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

export function reviewFlags(e: ReviewEntry, today: string, usual: number[]): string[] {
  const flags: string[] = [];
  if (e.photos === 0) flags.push("Sin foto");
  if (!e.has_gps) flags.push("Sin ubicación GPS");
  const saldo = e.contract_qty - e.executed_before;
  if (e.contract_qty > 0 && e.quantity > saldo + 1e-9) flags.push(`Supera el saldo del contrato (quedaban ${fmt(Math.max(0, saldo))} ${e.unit})`);
  if (e.elements > 0 && Math.abs(e.elements - e.quantity) > 1e-9) flags.push(`No cuadra con lo marcado en el plano (${fmt(e.elements)})`);
  const typical = median(usual);
  if (typical != null && usual.length >= 3 && e.quantity > typical * 3) flags.push(`Muy por encima de lo usual (normalmente ${fmt(typical)} ${e.unit})`);
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${e.work_date}T12:00:00Z`)) / 86_400_000);
  if (days > 3) flags.push(`Registro de hace ${days} días`);
  return flags;
}

/** Orden de revisión: más señales primero; a igualdad, el más antiguo primero. */
export function reviewOrder<T extends { work_date: string; flags: string[] }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.flags.length - a.flags.length || a.work_date.localeCompare(b.work_date));
}
