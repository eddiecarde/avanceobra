/**
 * Indicadores del dashboard: curva S (programado vs. real vs. proyectado) y semáforo por actividad.
 * El programado se reparte de forma lineal en días laborables entre inicio y fin planeados.
 */
import { addDays, addWorkingDays, diffDays, workdayCounter, workingDaysBetween, type ISODate, type WorkCalendar } from "./calendar.js";

export interface ScheduleActivity {
  id: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  plannedStart: ISODate | null;
  plannedFinish: ISODate | null;
  /** Peso en el avance global (p. ej. valor contractual). Por defecto todas pesan igual. */
  weight?: number;
}

export interface DailyQuantity {
  activityId: string;
  date: ISODate;
  quantity: number;
}

/** Cantidad programada acumulada a una fecha (lineal en días laborables). */
export function plannedQtyAt(a: ScheduleActivity, date: ISODate, cal: WorkCalendar = {}): number {
  if (!a.plannedStart || !a.plannedFinish) return 0;
  if (diffDays(a.plannedStart, date) < 0) return 0;
  if (diffDays(a.plannedFinish, date) >= 0) return a.contractQty;
  const total = workingDaysBetween(a.plannedStart, a.plannedFinish, cal);
  if (total <= 0) return a.contractQty;
  return (a.contractQty * workingDaysBetween(a.plannedStart, date, cal)) / total;
}

/**
 * Rendimiento diario reciente: cantidad de los últimos `windowDays` días calendario
 * ÷ días laborables de esa ventana (los días sin reporte cuentan como cero).
 */
export function recentDailyRate(daily: DailyQuantity[], activityId: string, today: ISODate, windowDays = 14, cal: WorkCalendar = {}): number {
  const from = addDays(today, -(windowDays - 1));
  const qty = daily
    // Fechas ISO: se comparan como texto (miles de registros, sin convertir a fecha)
    .filter((d) => d.activityId === activityId && d.date >= from && d.date <= today)
    .reduce((s, d) => s + d.quantity, 0);
  const days = workingDaysBetween(from, today, cal);
  return days > 0 ? qty / days : 0;
}

export interface SCurvePoint {
  date: ISODate;
  /** Fracciones 0..1 del avance global ponderado. */
  planned: number;
  actual: number | null;
  projected: number | null;
}

export interface SCurveInput {
  activities: ScheduleActivity[];
  daily: DailyQuantity[];
  from: ISODate;
  /** Fin del eje: normalmente la fecha contractual. Se extiende si la proyección termina después. */
  to: ISODate;
  today: ISODate;
  calendar?: WorkCalendar;
  /** Ventana para el rendimiento reciente de la proyección. */
  rateWindowDays?: number;
  /** Límite de extensión de la proyección (días calendario después de `to`). */
  maxExtensionDays?: number;
  /**
   * Grupo de trabajo de cada actividad (Hincas, Módulos…). Con grupos, la proyección sigue el ritmo
   * del grupo y no el de cada subcampo: la cuadrilla pasa de un subcampo al siguiente.
   */
  groupOf?: (activityId: string) => string | null;
}

export interface SCurveResult {
  points: SCurvePoint[];
  plannedToday: number;
  actualToday: number;
  /** Índice de desempeño del cronograma: real ÷ programado (1 = al día). */
  spi: number | null;
  /** Fecha en que terminan las actividades que avanzan (null si ninguna con saldo tiene ritmo). */
  projectedFinish: ISODate | null;
  /** Actividades con saldo y sin avance reciente: con ellas la obra no termina al ritmo actual. */
  stalled: string[];
  /** Actividades fuera de la curva por no tener cantidad o fechas programadas. */
  excluded: string[];
}

/**
 * Actividades que entran al avance global y su peso normalizado. Sin fechas no hay programado
 * (incluirlas dejaría la curva por debajo del 100 %). Si alguna actividad tiene peso, se usan los
 * pesos (las que no lo tienen pesan 0); si ninguna lo tiene, todas pesan igual.
 */
export function weighting(activities: ScheduleActivity[]) {
  const acts = activities.filter((a) => a.contractQty > 0 && a.plannedStart && a.plannedFinish);
  const excluded = activities.filter((a) => !acts.includes(a)).map((a) => a.id);
  const weighted = acts.some((a) => a.weight != null);
  const raw = (a: ScheduleActivity) => (weighted ? (a.weight ?? 0) : 1);
  const total = acts.reduce((s, a) => s + raw(a), 0) || 1;
  return { acts, excluded, weighted, w: (a: ScheduleActivity) => raw(a) / total };
}

export function sCurve(input: SCurveInput): SCurveResult {
  const cal = input.calendar ?? {};
  const { acts, excluded, w } = weighting(input.activities);
  const maxExt = input.maxExtensionDays ?? 120;
  const window = input.rateWindowDays ?? 14;

  // Días laborables en O(1): una planta tiene miles de actividades y cientos de fechas
  const dates = acts.flatMap((a) => [a.plannedStart!, a.plannedFinish!]);
  const lo = [input.from, input.today, addDays(input.today, -(window - 1)), ...dates].reduce((m, d) => (d < m ? d : m));
  const hi = [addDays(input.to, maxExt + 1), input.today, ...dates].reduce((m, d) => (d > m ? d : m));
  const wd = workdayCounter(cal, lo, hi);

  // Registros por actividad (las fechas ISO se comparan como texto)
  const byAct = new Map<string, DailyQuantity[]>();
  for (const d of input.daily) {
    if (!byAct.has(d.activityId)) byAct.set(d.activityId, []);
    byAct.get(d.activityId)!.push(d);
  }
  const sumUntil = (id: string, date: ISODate) => (byAct.get(id) ?? []).reduce((s, d) => (d.date <= date ? s + d.quantity : s), 0);

  // Programado: mismo reparto lineal que plannedQtyAt, con el contador rápido
  const totalWd = new Map(acts.map((a) => [a.id, wd(a.plannedStart!, a.plannedFinish!)]));
  const plannedQty = (a: ScheduleActivity, date: ISODate) => {
    if (date < a.plannedStart!) return 0;
    if (date >= a.plannedFinish!) return a.contractQty;
    const total = totalWd.get(a.id)!;
    return total <= 0 ? a.contractQty : (a.contractQty * wd(a.plannedStart!, date)) / total;
  };
  const planned = (date: ISODate) => acts.reduce((s, a) => s + w(a) * (plannedQty(a, date) / a.contractQty), 0);

  // Proyección: cada actividad sigue a su ritmo reciente desde mañana
  const rateFrom = addDays(input.today, -(window - 1));
  const rateDays = wd(rateFrom, input.today);
  const rates = new Map(
    acts.map((a) => {
      const qty = (byAct.get(a.id) ?? []).reduce((s, d) => (d.date >= rateFrom && d.date <= input.today ? s + d.quantity : s), 0);
      return [a.id, rateDays > 0 ? qty / rateDays : 0];
    }),
  );
  const doneToday = new Map(acts.map((a) => [a.id, Math.min(a.contractQty, sumUntil(a.id, input.today))]));

  // Unidades de proyección: cada grupo de trabajo, o cada actividad suelta. f = fracción hecha,
  // r = fracción por día laborable, W = peso en el total
  const units = new Map<string, { acts: ScheduleActivity[]; W: number; f: number; r: number; daysLeft: number | null }>();
  for (const a of acts) {
    const g = input.groupOf?.(a.id);
    const key = g ? `g:${g}` : `a:${a.id}`;
    if (!units.has(key)) units.set(key, { acts: [], W: 0, f: 0, r: 0, daysLeft: null });
    const u = units.get(key)!;
    u.acts.push(a);
    u.W += w(a);
  }
  for (const u of units.values()) {
    const W = u.W || 1;
    u.f = u.acts.reduce((t, a) => t + (w(a) / W) * (doneToday.get(a.id)! / a.contractQty), 0);
    u.r = u.acts.reduce((t, a) => t + (w(a) / W) * (rates.get(a.id)! / a.contractQty), 0);
    if (u.acts.length === 1) {
      const a = u.acts[0]!;
      const left = a.contractQty - doneToday.get(a.id)!;
      u.daysLeft = left <= 1e-9 ? 0 : rates.get(a.id)! > 0 ? Math.ceil(left / rates.get(a.id)! - 1e-9) : null;
    } else u.daysLeft = u.f >= 1 - 1e-9 ? 0 : u.r > 0 ? Math.ceil((1 - u.f) / u.r - 1e-9) : null;
  }
  const projected = (date: ISODate) => {
    const days = date > input.today ? wd(addDays(input.today, 1), date) : 0;
    let s = 0;
    for (const u of units.values()) s += u.W * Math.min(1, u.f + u.r * days);
    return s;
  };

  const actualAt = (date: ISODate) => acts.reduce((s, a) => s + w(a) * Math.min(1, sumUntil(a.id, date) / a.contractQty), 0);
  const actualToday = actualAt(input.today);
  const plannedToday = planned(input.today);

  // Fecha de terminación proyectada (todas las actividades al 100 %)
  let projectedFinish: ISODate | null = null;
  const pendingUnits = [...units.values()].filter((u) => u.daysLeft !== 0);
  const moving = pendingUnits.filter((u) => u.daysLeft != null);
  const stalled = pendingUnits
    .filter((u) => u.daysLeft == null)
    .flatMap((u) => u.acts.filter((a) => doneToday.get(a.id)! < a.contractQty - 1e-9).map((a) => a.id));
  if (pendingUnits.length === 0) projectedFinish = input.today;
  else if (moving.length) projectedFinish = addWorkingDays(addDays(input.today, 1), Math.max(...moving.map((u) => u.daysLeft!)), cal);

  let end = input.to;
  if (projectedFinish && diffDays(end, projectedFinish) > 0) end = projectedFinish;
  if (diffDays(input.to, end) > maxExt) end = addDays(input.to, maxExt);
  if (!projectedFinish && diffDays(end, input.today) > 0) end = input.today;

  // Real acumulado: se recorre una sola vez en orden de fecha
  const cum = new Map<string, number>();
  const sorted = [...input.daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let k = 0;
  const actualRunning = (date: ISODate) => {
    for (; k < sorted.length && sorted[k]!.date <= date; k++) cum.set(sorted[k]!.activityId, (cum.get(sorted[k]!.activityId) ?? 0) + sorted[k]!.quantity);
    return acts.reduce((s, a) => s + w(a) * Math.min(1, (cum.get(a.id) ?? 0) / a.contractQty), 0);
  };

  const points: SCurvePoint[] = [];
  for (let d = input.from; diffDays(d, end) >= 0; d = addDays(d, 1)) {
    const past = d <= input.today;
    points.push({
      date: d,
      planned: planned(d),
      actual: past ? actualRunning(d) : null,
      // Une la proyección con el real en la fecha de hoy
      projected: d >= input.today ? (d === input.today ? actualToday : projected(d)) : null,
    });
  }

  return { points, plannedToday, actualToday, spi: plannedToday > 0 ? actualToday / plannedToday : null, projectedFinish, stalled, excluded };
}

export type Light = "green" | "amber" | "red" | "done" | "not_started" | "no_plan";

export const LIGHT_LABEL: Record<Light, string> = {
  green: "Al día",
  amber: "En riesgo",
  red: "Atrasada",
  done: "Terminada",
  not_started: "Por iniciar",
  no_plan: "Sin programa",
};

export interface ActivityStatus {
  id: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  executedQty: number;
  plannedQty: number;
  actualPct: number;
  plannedPct: number;
  /** Diferencia real − programado en puntos porcentuales (negativo = atraso). */
  gapPts: number;
  dailyRate: number;
  /** Rendimiento diario necesario para terminar en la fecha planeada. */
  requiredRate: number | null;
  projectedFinish: ISODate | null;
  /** Días calendario de retraso proyectado frente al fin planeado (negativo = adelanto). */
  delayDays: number | null;
  light: Light;
  reason: string;
}

export interface StatusThresholds {
  /** Atraso proyectado tolerado (días) antes de pasar a rojo. */
  redDelayDays: number;
  /** Brecha en puntos porcentuales para ámbar y rojo. */
  amberGapPts: number;
  redGapPts: number;
}

export const DEFAULT_THRESHOLDS: StatusThresholds = { redDelayDays: 3, amberGapPts: 5, redGapPts: 15 };

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** Semáforo de una actividad: combina la brecha frente al programa y el retraso proyectado. */
export function activityStatus(
  a: ScheduleActivity,
  executedQty: number,
  dailyRate: number,
  today: ISODate,
  cal: WorkCalendar = {},
  th: StatusThresholds = DEFAULT_THRESHOLDS,
): ActivityStatus {
  const qty = a.contractQty;
  const executed = Math.min(executedQty, qty);
  const plannedQty = plannedQtyAt(a, today, cal);
  const actualPct = qty > 0 ? executed / qty : 0;
  const plannedPct = qty > 0 ? plannedQty / qty : 0;
  const gapPts = (actualPct - plannedPct) * 100;
  const remaining = Math.max(0, qty - executed);
  const tomorrow = addDays(today, 1);

  let projectedFinish: ISODate | null = null;
  if (remaining <= 1e-9) projectedFinish = today;
  else if (dailyRate > 0) projectedFinish = addWorkingDays(tomorrow, Math.ceil(remaining / dailyRate - 1e-9), cal);

  const delayDays = a.plannedFinish && projectedFinish ? diffDays(a.plannedFinish, projectedFinish) : null;
  let requiredRate: number | null = null;
  if (a.plannedFinish && remaining > 0) {
    const left = workingDaysBetween(tomorrow, a.plannedFinish, cal);
    requiredRate = left > 0 ? remaining / left : Infinity;
  }

  const base = { id: a.id, code: a.code, name: a.name, unit: a.unit, contractQty: qty, executedQty: executed, plannedQty, actualPct, plannedPct, gapPts, dailyRate, requiredRate, projectedFinish, delayDays };

  if (qty > 0 && remaining <= 1e-9) return { ...base, light: "done", reason: "Cantidad contractual completa." };
  if (!a.plannedStart || !a.plannedFinish) return { ...base, light: "no_plan", reason: "La actividad no tiene fechas programadas." };
  if (executed === 0 && diffDays(today, a.plannedStart) > 0)
    return { ...base, light: "not_started", reason: `Programada para iniciar el ${a.plannedStart}.` };

  const reqTxt = requiredRate === null ? "" : Number.isFinite(requiredRate) ? ` Se necesitan ${fmt(requiredRate)} ${a.unit}/día y van ${fmt(dailyRate)}.` : " Ya pasó la fecha planeada de fin.";
  if (dailyRate <= 0)
    return { ...base, light: "red", reason: `Sin avance en los últimos días y quedan ${fmt(remaining)} ${a.unit}.${reqTxt}` };
  if ((delayDays ?? 0) > th.redDelayDays || gapPts <= -th.redGapPts)
    return { ...base, light: "red", reason: `Al ritmo actual termina el ${projectedFinish}, ${delayDays} día(s) después de lo planeado.${reqTxt}` };
  if ((delayDays ?? 0) > 0 || gapPts <= -th.amberGapPts)
    return {
      ...base,
      light: "amber",
      reason:
        (delayDays ?? 0) > 0
          ? `Termina ${delayDays} día(s) tarde al ritmo actual.${reqTxt}`
          : `Va ${fmt(-gapPts)} puntos por debajo del programa, pero el ritmo actual alcanza.`,
    };
  return { ...base, light: "green", reason: delayDays !== null && delayDays < 0 ? `Termina ${-delayDays} día(s) antes de lo planeado.` : "Avanza según el programa." };
}

export interface WeekColumn {
  /** Número de semana desde el inicio del proyecto (1, 2, …): es el número del informe semanal. */
  index: number;
  /** Lunes y domingo de la semana. */
  start: ISODate;
  end: ISODate;
  /** Último día laborable de la semana (para el rótulo "12/10 – 17/10"). */
  lastWorkday: ISODate;
}

/** Semanas de lunes a domingo que cubren [from, to]. */
export function reportWeeks(from: ISODate, to: ISODate, cal: WorkCalendar = {}): WeekColumn[] {
  const dow = (d: ISODate) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
  const weeks: WeekColumn[] = [];
  let start = addDays(from, -dow(from));
  for (let i = 1; diffDays(start, to) >= 0; i++, start = addDays(start, 7)) {
    const end = addDays(start, 6);
    let last = end;
    while (diffDays(start, last) > 0 && workingDaysBetween(last, last, cal) === 0) last = addDays(last, -1);
    weeks.push({ index: i, start, end, lastWorkday: last });
  }
  return weeks;
}

export interface WeeklyRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  /** Peso normalizado en el avance global (0 si la actividad no entra). */
  weight: number;
  /** % programado y ejecutado acumulados al cierre de cada semana (0–1); ejecutado null en semanas futuras. */
  planned: number[];
  actual: (number | null)[];
  /** Cantidad ejecutada dentro de cada semana. */
  executed: number[];
}

export interface WeeklyProgress {
  weeks: WeekColumn[];
  rows: WeeklyRow[];
  /** Avance general ponderado por semana. */
  totalPlanned: number[];
  totalActual: (number | null)[];
  weighted: boolean;
}

/** Seguimiento semanal: % programado vs. % ejecutado acumulado por actividad y semana, y su desviación. */
export function weeklyProgress(input: { activities: ScheduleActivity[]; daily: DailyQuantity[]; from: ISODate; to: ISODate; today: ISODate; calendar?: WorkCalendar }): WeeklyProgress {
  const cal = input.calendar ?? {};
  const { acts, weighted, w } = weighting(input.activities);
  const weeks = reportWeeks(input.from, input.to, cal);
  const inAvance = new Set(acts.map((a) => a.id));
  // Registros por actividad (fechas ISO comparadas como texto) y días laborables en O(1)
  const byAct = new Map<string, DailyQuantity[]>();
  for (const d of input.daily) {
    if (!byAct.has(d.activityId)) byAct.set(d.activityId, []);
    byAct.get(d.activityId)!.push(d);
  }
  const dates = input.activities.flatMap((a) => (a.plannedStart && a.plannedFinish ? [a.plannedStart, a.plannedFinish] : []));
  const lo = [input.from, weeks[0]?.start ?? input.from, ...dates].reduce((m, d) => (d < m ? d : m));
  const hi = [input.to, weeks.at(-1)?.end ?? input.to, ...dates].reduce((m, d) => (d > m ? d : m));
  const wd = workdayCounter(cal, lo, hi);
  const plannedQty = (a: ScheduleActivity, date: ISODate) => {
    if (!a.plannedStart || !a.plannedFinish || date < a.plannedStart) return 0;
    if (date >= a.plannedFinish) return a.contractQty;
    const total = wd(a.plannedStart, a.plannedFinish);
    return total <= 0 ? a.contractQty : (a.contractQty * wd(a.plannedStart, date)) / total;
  };
  const rows: WeeklyRow[] = input.activities.map((a) => {
    const mine = byAct.get(a.id) ?? [];
    const executed = weeks.map((wk) => mine.reduce((s, d) => (d.date >= wk.start && d.date <= wk.end ? s + d.quantity : s), 0));
    const before = mine.reduce((s, d) => (d.date < (weeks[0]?.start ?? "") ? s + d.quantity : s), 0);
    let running = before;
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      contractQty: a.contractQty,
      weight: inAvance.has(a.id) ? w(a) : 0,
      planned: weeks.map((wk) => (a.contractQty > 0 ? plannedQty(a, wk.end) / a.contractQty : 0)),
      actual: weeks.map((wk, i) => {
        running += executed[i]!;
        return wk.start > input.today ? null : a.contractQty > 0 ? Math.min(1, running / a.contractQty) : 0;
      }),
      executed,
    };
  });
  const totalPlanned = weeks.map((_, i) => rows.reduce((s, r) => s + r.weight * r.planned[i]!, 0));
  const totalActual = weeks.map((_, i) => (rows.some((r) => r.actual[i] === null) ? null : rows.reduce((s, r) => s + r.weight * (r.actual[i] ?? 0), 0)));
  return { weeks, rows, totalPlanned, totalActual, weighted };
}
