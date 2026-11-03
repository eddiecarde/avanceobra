/**
 * Centro de control de producción: por actividad, lo programado, lo ejecutado en campo, lo aprobado
 * y el saldo; y para cualquier grupo de actividades (una empresa, un subcampo, un frente) el avance
 * ponderado, el ritmo frente al necesario y la fecha realista de terminación.
 */

import type { WorkCalendar } from "./calendar.js";
import { activityStatus, plannedQtyAt, recentDailyRate, weighting, type ActivityStatus, type DailyQuantity, type ScheduleActivity } from "./dashboard.js";

type ISODate = string;

export interface ControlEntry {
  activityId: string;
  date: ISODate;
  quantity: number;
  /** Solo cuentan "submitted" (ejecutado por aprobar) y "approved". */
  status: string;
}

export interface ActivityControl {
  activity: ScheduleActivity;
  /** Semáforo y proyección con lo ejecutado en campo (ritmo de los últimos 14 días). */
  status: ActivityStatus;
  planned: number;
  reported: number;
  approved: number;
  /** Ejecutado aún sin aprobar. */
  review: number;
  /** Contratado menos aprobado. */
  balance: number;
}

/** Control de cada actividad a la fecha de corte. */
export function activityControl(activities: ScheduleActivity[], entries: ControlEntry[], cutoff: ISODate, cal: WorkCalendar = {}): ActivityControl[] {
  const valid = entries.filter((e) => e.date <= cutoff && (e.status === "submitted" || e.status === "approved"));
  const daily: DailyQuantity[] = valid.map((e) => ({ activityId: e.activityId, date: e.date, quantity: e.quantity }));
  return activities.map((a) => {
    const mine = valid.filter((e) => e.activityId === a.id);
    const reported = mine.reduce((t, e) => t + e.quantity, 0);
    const approved = mine.filter((e) => e.status === "approved").reduce((t, e) => t + e.quantity, 0);
    return {
      activity: a,
      status: activityStatus(a, reported, recentDailyRate(daily, a.id, cutoff, 14, cal), cutoff, cal),
      planned: plannedQtyAt(a, cutoff, cal),
      reported,
      approved,
      review: reported - approved,
      balance: Math.max(0, a.contractQty - approved),
    };
  });
}

export interface ControlSummary {
  activities: number;
  /** Avance ponderado (0–1), igual que la curva S: programado, ejecutado y aprobado. */
  plannedPct: number | null;
  executedPct: number | null;
  approvedPct: number | null;
  late: number;
  /** Actividades con saldo que ya debían avanzar y no lo hicieron en los últimos 14 días. */
  stalled: string[];
  /** Ritmo real frente al necesario (1 = justo lo necesario), promedio de las actividades en curso. */
  paceRatio: number | null;
  /** Fecha realista: la última terminación proyectada; null si alguna actividad con saldo no avanza. */
  projectedFinish: ISODate | null;
  /** La última fecha planeada de terminación del grupo. */
  plannedFinish: ISODate | null;
}

/** Resumen de un grupo de actividades (todas, una empresa, un subcampo…). */
export function controlSummary(rows: ActivityControl[]): ControlSummary {
  const { acts, w } = weighting(rows.map((r) => r.activity));
  const avg = (f: (r: ActivityControl) => number) =>
    acts.length ? acts.reduce((t, a) => t + w(a) * Math.min(1, f(rows.find((r) => r.activity.id === a.id)!) / a.contractQty), 0) : null;
  const open = rows.filter((r) => r.status.light !== "done" && r.activity.contractQty > r.reported);
  const paced = open.filter((r) => r.status.requiredRate && r.status.requiredRate > 0 && Number.isFinite(r.status.requiredRate));
  const finishes = rows.map((r) => r.status.projectedFinish).filter((d): d is string => !!d);
  const planned = rows.map((r) => r.activity.plannedFinish).filter((d): d is string => !!d);
  const anyWithoutDate = open.some((r) => !r.status.projectedFinish);
  return {
    activities: rows.length,
    plannedPct: avg((r) => r.planned),
    executedPct: avg((r) => r.reported),
    approvedPct: avg((r) => r.approved),
    late: rows.filter((r) => r.status.light === "red").length,
    // Ya debía haber empezado (programado > 0) y no avanzó en 14 días
    stalled: open.filter((r) => r.status.dailyRate <= 0 && r.planned > 0).map((r) => r.activity.id),
    paceRatio: paced.length ? paced.reduce((t, r) => t + Math.min(2, r.status.dailyRate / r.status.requiredRate!), 0) / paced.length : null,
    projectedFinish: anyWithoutDate || !finishes.length ? null : finishes.sort().at(-1)!,
    plannedFinish: planned.length ? planned.sort().at(-1)! : null,
  };
}
