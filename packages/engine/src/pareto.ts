/**
 * Análisis de Pareto de causas (pérdida de tiempo, hallazgos).
 */

export interface ParetoInput {
  key: string;
  value: number;
}

export interface ParetoRow {
  key: string;
  value: number;
  pct: number;
  cumulativePct: number;
  /** Pertenece a los "pocos vitales" que explican hasta el umbral (80 %). */
  vital: boolean;
}

export function pareto(items: ParetoInput[], threshold = 0.8): ParetoRow[] {
  const totals = new Map<string, number>();
  for (const it of items) if (it.value > 0) totals.set(it.key, (totals.get(it.key) ?? 0) + it.value);
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  if (grand === 0) return [];
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let cum = 0;
  let reached = false;
  return sorted.map(([key, value]) => {
    const vital = !reached; // incluye la causa que cruza el umbral
    cum += value;
    if (cum / grand >= threshold - 1e-9) reached = true;
    return { key, value, pct: value / grand, cumulativePct: cum / grand, vital };
  });
}

/** Una línea de pérdida de tiempo de un registro de avance (2 h Clima, 1 h Material…). */
export interface LossLine {
  cause: string;
  hours: number;
}

/**
 * Líneas de pérdida de un registro: el detalle si lo trae; si no (registros anteriores o teléfonos sin
 * actualizar), una sola línea con las horas perdidas y su causa.
 */
export function entryLossLines(e: { lostHours: number; lossCause: string; losses?: LossLine[] | null }): LossLine[] {
  const lines = (e.losses ?? []).filter((l) => l && l.cause && l.cause !== "none" && Number(l.hours) > 0).map((l) => ({ cause: l.cause, hours: Number(l.hours) }));
  if (lines.length) return lines;
  return e.lossCause && e.lossCause !== "none" && Number(e.lostHours) > 0 ? [{ cause: e.lossCause, hours: Number(e.lostHours) }] : [];
}

export type ParetoMetric = "lost_hours" | "lost_quantity" | "lost_cost" | "events";

export interface LossRecord {
  cause: string;
  lostHours: number;
  /** Rendimiento horario del frente (para cantidad no ejecutada). */
  hourlyRate?: number;
  /** Costo horario de los recursos parados. */
  idleCostPerHour?: number;
}

export function lossPareto(records: LossRecord[], metric: ParetoMetric, threshold = 0.8): ParetoRow[] {
  const value = (r: LossRecord) => {
    switch (metric) {
      case "lost_hours":
        return r.lostHours;
      case "lost_quantity":
        return r.lostHours * (r.hourlyRate ?? 0);
      case "lost_cost":
        return r.lostHours * (r.idleCostPerHour ?? 0);
      case "events":
        return r.lostHours > 0 ? 1 : 0;
    }
  };
  return pareto(
    records.filter((r) => r.cause !== "none").map((r) => ({ key: r.cause, value: value(r) })),
    threshold,
  );
}

/** Días reclamables = horas perdidas por causas imputables al cliente/fuerza mayor ÷ horas de la jornada. */
export function claimableDays(records: LossRecord[], claimableCauses: string[], hoursPerDay: number): number {
  const hours = records.filter((r) => claimableCauses.includes(r.cause)).reduce((a, r) => a + r.lostHours, 0);
  return Math.floor(hours / hoursPerDay);
}
