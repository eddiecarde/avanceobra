/**
 * Reglas de calidad y correcciones que el teléfono revisa antes de enviar, con los mismos límites
 * que la base de datos (que vuelve a validarlas): así el supervisor ve el error al instante.
 */

export type AnswerResult = "ok" | "no_ok" | "na";

export interface ChecklistItem {
  id: string;
  text: string;
}

export interface InspectionAnswer {
  result: AnswerResult | "";
  note: string;
  impeditive: boolean;
}

/** Lo que falta para poder registrar la inspección (vacío = lista). */
export function inspectionErrors(items: ChecklistItem[], answers: Record<string, InspectionAnswer>): string[] {
  const out: string[] = [];
  for (const it of items) {
    const a = answers[it.id];
    if (!a || !a.result) out.push(`Falta responder: ${it.text}`);
    else if (a.result === "no_ok" && a.note.trim().length < 3) out.push(`Describe qué no cumple en: ${it.text}`);
  }
  return out;
}

export interface CorrectableEntry {
  quantity: number;
  work_date: string;
  notes: string;
}

/** Convierte "12,5" o "12.5" en número; vacío o inválido → NaN. */
export const parseQty = (s: string) => (s.trim() ? Number(s.trim().replace(",", ".")) : NaN);

const FIELD_LABEL: Record<string, string> = {
  quantity: "Cantidad",
  work_date: "Fecha",
  notes: "Notas",
  effective_hours: "Horas efectivas",
  lost_hours: "Horas perdidas",
  loss_cause: "Causa de pérdida",
  crew_size: "Personas",
};

/** Lo que cambia una corrección, para decidirla: "Cantidad: 10 → 1". */
export function correctionDiff(previous: Record<string, unknown>, proposed: Record<string, unknown>): string[] {
  const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("es-CO") : String(v));
  return Object.keys(FIELD_LABEL)
    .filter((k) => k in proposed && show(previous[k]) !== show(proposed[k]))
    .map((k) => `${FIELD_LABEL[k]}: ${show(previous[k])} → ${show(proposed[k])}`);
}

/**
 * Cambios de una corrección (solo los campos que cambian) o el motivo por el que no se puede enviar.
 */
export function correctionRequest(
  entry: CorrectableEntry,
  form: { quantity: string; work_date: string; notes: string; reason: string },
  today: string,
): { changes: Partial<CorrectableEntry>; error: null } | { changes: null; error: string } {
  const q = parseQty(form.quantity);
  if (!Number.isFinite(q) || q < 0) return { changes: null, error: "La cantidad debe ser un número mayor o igual a 0." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.work_date) || form.work_date > today) return { changes: null, error: "La fecha debe ser AAAA-MM-DD y no puede ser futura." };
  const changes: Partial<CorrectableEntry> = {};
  if (Math.abs(q - entry.quantity) > 1e-9) changes.quantity = q;
  if (form.work_date !== entry.work_date) changes.work_date = form.work_date;
  if (form.notes.trim() !== (entry.notes ?? "").trim()) changes.notes = form.notes.trim();
  if (!Object.keys(changes).length) return { changes: null, error: "La corrección no cambia nada del registro." };
  if (form.reason.trim().length < 10) return { changes: null, error: "Explica el motivo de la corrección (al menos 10 letras)." };
  return { changes, error: null };
}
