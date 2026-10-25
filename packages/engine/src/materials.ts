/**
 * Materiales en obra: lo entregado contra lo instalado. Lo instalado sale del avance registrado
 * (cantidad × consumo por unidad de cada actividad); las existencias alcanzan para N días de trabajo
 * al ritmo de las últimas dos semanas.
 */
import { addDays, addWorkingDays, workingDaysBetween, type ISODate, type WorkCalendar } from "./calendar.js";
import type { DailyQuantity, ScheduleActivity } from "./dashboard.js";

export interface MaterialInput {
  id: string;
  name: string;
  unit: string;
  /** Avisar cuando alcance para menos de estos días de trabajo. */
  lowDays: number;
}

export interface MaterialRow extends MaterialInput {
  /** Total que pide la obra: cantidad contratada de las actividades × consumo por unidad. */
  required: number;
  delivered: number;
  consumed: number;
  stock: number;
  /** Lo que falta por entregar para completar la obra. */
  pendingDelivery: number;
  /** Lo que falta por instalar. */
  pendingInstall: number;
  /** Consumo por día de trabajo (últimas dos semanas). */
  ratePerDay: number;
  /** Días de trabajo que alcanzan las existencias (null si no se está consumiendo). */
  daysLeft: number | null;
  runOutDate: ISODate | null;
  /** covered: alcanza para terminar; ok; low: menos de lowDays; out: sin existencias con trabajo pendiente. */
  status: "covered" | "ok" | "low" | "out";
}

export function materialStatus(
  materials: MaterialInput[],
  usage: { materialId: string; activityId: string; factor: number }[],
  activities: ScheduleActivity[],
  daily: DailyQuantity[],
  deliveries: { materialId: string; date: ISODate; quantity: number }[],
  today: ISODate,
  cal: WorkCalendar = {},
  windowDays = 14,
): MaterialRow[] {
  const from = addDays(today, -(windowDays - 1));
  const workDays = Math.max(1, workingDaysBetween(from, today, cal));
  const qtyOf = new Map(activities.map((a) => [a.id, a.contractQty]));
  return materials.map((m) => {
    const uses = usage.filter((u) => u.materialId === m.id);
    const factor = new Map(uses.map((u) => [u.activityId, u.factor]));
    let consumed = 0;
    let recent = 0;
    for (const d of daily) {
      const f = factor.get(d.activityId);
      if (f == null || d.date > today) continue;
      consumed += d.quantity * f;
      if (d.date >= from) recent += d.quantity * f;
    }
    const required = uses.reduce((t, u) => t + (qtyOf.get(u.activityId) ?? 0) * u.factor, 0);
    const delivered = deliveries.filter((d) => d.materialId === m.id && d.date <= today).reduce((t, d) => t + d.quantity, 0);
    const stock = delivered - consumed;
    const pendingInstall = Math.max(0, required - consumed);
    const ratePerDay = recent / workDays;
    const daysLeft = ratePerDay > 0 ? Math.max(0, stock) / ratePerDay : null;
    const covered = pendingInstall <= Math.max(0, stock) + 1e-9;
    const status: MaterialRow["status"] = covered ? "covered" : stock <= 1e-9 ? "out" : daysLeft != null && daysLeft < m.lowDays ? "low" : "ok";
    return {
      ...m,
      required,
      delivered,
      consumed,
      stock,
      pendingDelivery: Math.max(0, required - delivered),
      pendingInstall,
      ratePerDay,
      daysLeft,
      runOutDate: daysLeft != null && !covered ? addWorkingDays(addDays(today, 1), Math.max(1, Math.floor(daysLeft)), cal) : null,
      status,
    };
  });
}
