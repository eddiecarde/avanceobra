import { plannedQtyAt, weighting, type ScheduleActivity } from "@avanceobra/engine";

/**
 * Avance real y programado del proyecto con lo que hay en el teléfono (sin señal). Los pesos del
 * contrato no se descargan, así que todas las actividades pesan igual: es una aproximación del panel web.
 */
export function homeProgress(
  activities: ScheduleActivity[],
  executed: Record<string, number>,
  today: string,
): { actual: number; planned: number } | null {
  const { acts, w } = weighting(activities);
  if (!acts.length) return null;
  return {
    actual: acts.reduce((t, a) => t + w(a) * Math.min(1, (executed[a.id] ?? 0) / a.contractQty), 0),
    planned: acts.reduce((t, a) => t + w(a) * Math.min(1, plannedQtyAt(a, today) / a.contractQty), 0),
  };
}

export const pctText = (x: number) => `${Math.round(x * 100)} %`;

export interface PlanItem {
  activityId: string;
  code: string;
  name: string;
  unit: string;
  frontId: string;
  plannedQty: number;
  responsible: string | null;
}

export interface TodayTask extends PlanItem {
  /** Lo registrado esta semana (lunes a hoy, sin rechazados). */
  doneQty: number;
  remainingQty: number;
  /** Lo que hay que hacer hoy para cumplir: lo que falta repartido en los días que quedan de la semana. */
  todayQty: number;
  done: boolean;
}

/**
 * Lo que toca hoy según el plan semanal comprometido: por actividad, lo que falta para cumplir la
 * semana repartido en los días hábiles que quedan (hoy incluido). Primero lo pendiente con más saldo.
 */
export function todayTasks(
  items: PlanItem[],
  entries: { activityId: string; workDate: string; quantity: number }[],
  weekStart: string,
  today: string,
  workdays: number[] = [1, 2, 3, 4, 5, 6],
): TodayTask[] {
  const done = new Map<string, number>();
  for (const e of entries) if (e.workDate >= weekStart && e.workDate <= today) done.set(e.activityId, (done.get(e.activityId) ?? 0) + e.quantity);
  // Días hábiles desde hoy hasta el domingo de la semana
  const isoDow = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const daysLeft = Math.max(1, workdays.filter((d) => d >= isoDow(today)).length);
  return items
    .map((i) => {
      const doneQty = done.get(i.activityId) ?? 0;
      const remainingQty = Math.max(0, i.plannedQty - doneQty);
      return { ...i, doneQty, remainingQty, todayQty: remainingQty / daysLeft, done: remainingQty <= 1e-9 };
    })
    .sort((a, b) => Number(a.done) - Number(b.done) || b.remainingQty / b.plannedQty - a.remainingQty / a.plannedQty || a.code.localeCompare(b.code));
}
