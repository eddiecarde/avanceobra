/**
 * Pérdidas de tiempo de un registro de avance: varias líneas (2 h Clima, 1 h Material…).
 * Lógica pura para probarla sin dispositivo; el servidor valida y recalcula lo mismo.
 */

export interface LossDraftLine {
  /** Lo que escribió el supervisor ("2", "1,5"). */
  hours: string;
  /** "none" mientras no elija la causa. */
  cause: string;
}

export interface LossSummary {
  /** Una línea por causa (se unen las repetidas), sin las vacías. */
  lines: { cause: string; hours: number }[];
  total: number;
  /** Causa con más horas ("none" si no hay pérdidas): va en loss_cause para lo que lee una sola causa. */
  main: string;
  error: string | null;
}

const toNum = (s: string) => Number(String(s).replace(",", ".").trim());

export function summarizeLosses(draft: LossDraftLine[]): LossSummary {
  const byCause = new Map<string, number>();
  for (const [i, l] of draft.entries()) {
    const raw = l.hours.trim();
    if (raw === "" || raw === "0") continue;
    const h = toNum(raw);
    if (!(h > 0 && h <= 24)) return { lines: [], total: 0, main: "none", error: `Pérdida ${i + 1}: las horas deben estar entre 0 y 24.` };
    if (!l.cause || l.cause === "none") return { lines: [], total: 0, main: "none", error: `Pérdida ${i + 1}: indica la causa de las ${raw} h.` };
    byCause.set(l.cause, (byCause.get(l.cause) ?? 0) + h);
  }
  const lines = [...byCause.entries()].map(([cause, hours]) => ({ cause, hours })).sort((a, b) => b.hours - a.hours);
  const total = lines.reduce((s, l) => s + l.hours, 0);
  if (total > 24) return { lines: [], total, main: "none", error: "Las horas perdidas suman más de 24." };
  return { lines, total, main: lines[0]?.cause ?? "none", error: null };
}

/** Borradores anteriores (una sola pérdida) a la lista nueva. */
export function lossesFromLegacy(lostHours: string | undefined, cause: string | undefined): LossDraftLine[] {
  return lostHours && lostHours.trim() !== "" && lostHours !== "0" ? [{ hours: lostHours, cause: cause ?? "none" }] : [];
}
