/**
 * Seguimiento de una planta por subcampos: matriz subcampo × grupo de trabajo, preparación de cada
 * subcampo para energizar (por circuito) y KPI semanal por grupo (rendimiento real vs. requerido y
 * fin proyectado con el promedio de las últimas 3 semanas), como el informe semanal del contratista.
 */
import { addDays, diffDays, isWorkingDay, type ISODate, type WorkCalendar } from "./calendar.js";
import { plannedQtyAt, type DailyQuantity, type ScheduleActivity } from "./dashboard.js";

export interface GroupedActivity extends ScheduleActivity {
  /** Grupo de trabajo (Hincas, Módulos, Cable solar…). */
  group: string | null;
  /** Subcampo (código), o null si es obra general. */
  subfield: string | null;
}

const share = (a: ScheduleActivity, executed: number) => (a.contractQty > 0 ? Math.min(1, executed / a.contractQty) : 0);
const weightOf = (a: ScheduleActivity) => a.weight ?? 1;

/** Avance (0–1) de un conjunto de actividades, ponderado por su peso. */
export function weightedProgress(acts: ScheduleActivity[], executed: Record<string, number>): number | null {
  const tw = acts.reduce((t, a) => t + weightOf(a), 0);
  return tw > 0 ? acts.reduce((t, a) => t + weightOf(a) * share(a, executed[a.id] ?? 0), 0) / tw : null;
}

export interface MatrixCell {
  pct: number;
  count: number;
}

/** Matriz subcampo × grupo: avance ponderado de las actividades de cada celda. */
export function progressMatrix(acts: GroupedActivity[], executed: Record<string, number>) {
  const inField = acts.filter((a) => a.subfield && a.group);
  // Grupos en el orden en que aparecen (orden del informe); subcampos ordenados
  const groups = [...new Set(inField.map((a) => a.group!))];
  const subfields = [...new Set(inField.map((a) => a.subfield!))].sort();
  const cells: Record<string, Record<string, MatrixCell>> = {};
  for (const sf of subfields) {
    cells[sf] = {};
    for (const g of groups) {
      const list = inField.filter((a) => a.subfield === sf && a.group === g);
      if (list.length) cells[sf]![g] = { pct: weightedProgress(list, executed) ?? 0, count: list.length };
    }
  }
  return { groups, subfields, cells };
}

export interface SubfieldPlan {
  code: string;
  name: string;
  circuit: string | null;
  position: "cabecera" | "cuerpo" | "cola" | null;
  order: number | null;
  /** Energización del plan vigente y de la línea base contractual. */
  planned: ISODate | null;
  baseline: ISODate | null;
}

export interface SubfieldReadiness extends SubfieldPlan {
  pct: number;
  pending: number;
  ready: boolean;
  /** Cuándo queda lista según el ritmo de cada actividad pendiente (null: alguna no avanza). */
  projectedReady: ISODate | null;
  /** Días de la fecha proyectada respecto a la energización planeada (positivo = atraso). */
  delayDays: number | null;
  /** Grupos de trabajo pendientes sin fecha proyectada: los que frenan la energización. */
  blockers: string[];
  /** Grupo pendiente que termina más tarde: el que marca la fecha proyectada. */
  sets: string | null;
}

const POSITION_RANK = { cabecera: 0, cuerpo: 1, cola: 2 } as const;

/**
 * Preparación para energizar: un subcampo está listo cuando todas sus actividades están completas.
 * Un circuito se energiza de cabecera a cola, así que queda listo cuando lo están todos sus subcampos.
 */
export function energizationReadiness(
  subfields: SubfieldPlan[],
  acts: GroupedActivity[],
  executed: Record<string, number>,
  projectedFinish: Record<string, ISODate | null>,
  today: ISODate,
) {
  const rows: SubfieldReadiness[] = subfields.map((sf) => {
    const list = acts.filter((a) => a.subfield === sf.code);
    const open = list.filter((a) => share(a, executed[a.id] ?? 0) < 0.999);
    const dates = open.map((a) => projectedFinish[a.id] ?? null);
    const projectedReady: ISODate | null =
      open.length === 0 ? today : dates.some((d) => d == null) ? null : (dates as ISODate[]).reduce((m, d) => (d > m ? d : m), today);
    return {
      ...sf,
      pct: weightedProgress(list, executed) ?? 0,
      pending: open.length,
      ready: list.length > 0 && open.length === 0,
      projectedReady,
      delayDays: sf.planned && projectedReady && open.length ? diffDays(sf.planned, projectedReady) : null,
      blockers: [...new Set(open.filter((a) => projectedFinish[a.id] == null).map((a) => a.group ?? a.name))],
      sets: open.length && projectedReady ? (open.find((a) => projectedFinish[a.id] === projectedReady)?.group ?? null) : null,
    };
  });
  const circuits = [...new Set(rows.map((r) => r.circuit ?? "Sin circuito"))]
    .map((circuit) => {
      const list = rows
        .filter((r) => (r.circuit ?? "Sin circuito") === circuit)
        .sort((a, b) => POSITION_RANK[a.position ?? "cuerpo"] - POSITION_RANK[b.position ?? "cuerpo"] || (a.order ?? 99) - (b.order ?? 99));
      const max = (xs: (ISODate | null)[]): ISODate | null =>
        xs.length === 0 || xs.some((x) => x == null) ? null : (xs as ISODate[]).reduce((m, x) => (x > m ? x : m));
      return {
        circuit,
        subfields: list,
        ready: list.every((r) => r.ready),
        pct: list.reduce((t, r) => t + r.pct, 0) / (list.length || 1),
        planned: max(list.map((r) => r.planned)),
        baseline: max(list.map((r) => r.baseline)),
        projectedReady: max(list.map((r) => r.projectedReady)),
        blockers: [...new Set(list.flatMap((r) => r.blockers))],
        sets: list.find((r) => r.projectedReady && r.projectedReady === max(list.map((x) => x.projectedReady)))?.sets ?? null,
        firstOrder: Math.min(...list.map((r) => r.order ?? 99)),
      };
    })
    .sort((a, b) => a.firstOrder - b.firstOrder);
  return { rows, circuits };
}

export interface WeeklyKpiRow {
  group: string;
  /** Unidad común del grupo, o null si mezcla unidades (entonces todo va en % del grupo). */
  unit: string | null;
  total: number;
  executed: number;
  remaining: number;
  /** Lo ejecutado en cada una de las últimas semanas (la más antigua primero). */
  weeks: number[];
  lastWeek: number;
  avg3: number;
  plannedFinish: ISODate | null;
  /** Ritmo semanal necesario para terminar en la fecha planeada (null si ya venció o no tiene fecha). */
  requiredPerWeek: number | null;
  /** Última semana ÷ requerido (1 = al ritmo justo). */
  kpi: number | null;
  /** Fin proyectado con el promedio de las últimas 3 semanas (null si no avanza). */
  forecastFinish: ISODate | null;
  done: boolean;
}

/** KPI semanal por grupo de trabajo, con semanas de 7 días que terminan en `today`. */
export function weeklyKpi(acts: GroupedActivity[], daily: DailyQuantity[], today: ISODate, weeks = 6): WeeklyKpiRow[] {
  const groups = [...new Set(acts.map((a) => a.group).filter(Boolean) as string[])];
  const byId = new Map(acts.map((a) => [a.id, a]));
  return groups.map((group) => {
    const list = acts.filter((a) => a.group === group);
    const units = [...new Set(list.map((a) => a.unit.trim().toLowerCase()))];
    const unit = units.length === 1 ? list[0]!.unit : null;
    const tw = list.reduce((t, a) => t + weightOf(a), 0) || 1;
    // Cantidad en la unidad del grupo, o fracción del grupo si mezcla unidades
    const measure = (a: ScheduleActivity, q: number) => (unit ? q : a.contractQty > 0 ? (weightOf(a) / tw) * (q / a.contractQty) : 0);
    const total = unit ? list.reduce((t, a) => t + a.contractQty, 0) : 1;
    const mine = daily.filter((d) => d.date <= today && byId.get(d.activityId)?.group === group);
    const executedRaw = mine.reduce((t, d) => t + measure(byId.get(d.activityId)!, d.quantity), 0);
    const executed = Math.min(total, executedRaw);
    const remaining = Math.max(0, total - executed);
    const series = Array.from({ length: weeks }, (_, i) => {
      const end = addDays(today, -7 * (weeks - 1 - i));
      const start = addDays(end, -6);
      return mine.filter((d) => d.date >= start && d.date <= end).reduce((t, d) => t + measure(byId.get(d.activityId)!, d.quantity), 0);
    });
    const lastWeek = series.at(-1) ?? 0;
    const avg3 = series.slice(-3).reduce((t, x) => t + x, 0) / Math.min(3, series.length || 1);
    const finishes = list.map((a) => a.plannedFinish).filter(Boolean) as ISODate[];
    const plannedFinish = finishes.length ? finishes.reduce((m, d) => (d > m ? d : m)) : null;
    // Terminado al 99,9 %: los informes arrastran decimales de redondeo
    const done = remaining <= total * 1e-3;
    const daysLeft = plannedFinish ? diffDays(today, plannedFinish) : null;
    const requiredPerWeek = done ? 0 : daysLeft != null && daysLeft > 0 ? remaining / (daysLeft / 7) : null;
    return {
      group,
      unit,
      total,
      executed,
      remaining,
      weeks: series,
      lastWeek,
      avg3,
      plannedFinish,
      requiredPerWeek,
      kpi: requiredPerWeek ? lastWeek / requiredPerWeek : null,
      forecastFinish: done ? null : avg3 > 0 ? addDays(today, Math.ceil((remaining / avg3) * 7)) : null,
      done,
    };
  });
}

export interface ScheduleProgressInput {
  activityId: string;
  contractQty: number;
  /** % completado en el cronograma (0-100). */
  pct: number;
  actualStart: ISODate | null;
  actualFinish: ISODate | null;
  /** Lo ya registrado en la obra y el último día con registro. */
  executed: number;
  lastRecorded: ISODate | null;
}

/**
 * Convierte el % completado de un cronograma en avance diario: solo la diferencia con lo ya
 * registrado, repartida en partes iguales en los días laborables entre el comienzo real (o el día
 * siguiente al último registro) y el fin real o la fecha de estado. Así cada nueva revisión del
 * cronograma suma su avance sin duplicar el anterior.
 */
export function scheduleProgressRows(items: ScheduleProgressInput[], statusDate: ISODate, cal: WorkCalendar = {}) {
  const rows: { activityId: string; date: ISODate; quantity: number }[] = [];
  for (const it of items) {
    const target = (Math.min(100, Math.max(0, it.pct)) / 100) * it.contractQty;
    const delta = target - it.executed;
    if (!(delta > 1e-9)) continue;
    const end = it.actualFinish && it.actualFinish < statusDate ? it.actualFinish : statusDate;
    let start = it.actualStart ?? end;
    if (it.lastRecorded && it.lastRecorded >= start) start = addDays(it.lastRecorded, 1);
    if (start > end) start = end;
    const days: ISODate[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, cal)) days.push(d);
    if (!days.length) days.push(end);
    // Reparto en partes iguales con el redondeo en el último día (cuadra exacto)
    const each = Math.floor((delta / days.length) * 1e4) / 1e4;
    days.forEach((date, i) => rows.push({ activityId: it.activityId, date, quantity: i === days.length - 1 ? +(delta - each * (days.length - 1)).toFixed(4) : each }));
  }
  return rows;
}

/** Lunes de la semana de una fecha. */
export function mondayOf(d: ISODate): ISODate {
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(d, -dow);
}

export interface LookaheadRow {
  activityId: string;
  /** Cantidad sugerida por semana: lo que pide el programa más lo atrasado (en la primera). */
  weeks: number[];
  remaining: number;
}

/**
 * Programación a 3 semanas: para cada actividad, cuánto hay que hacer cada semana para ir al día
 * con el programa. La primera semana recoge lo atrasado; nunca se sugiere más de lo que falta.
 */
export function lookahead(activities: ScheduleActivity[], executed: Record<string, number>, weekStart: ISODate, weeks = 3, cal: WorkCalendar = {}): LookaheadRow[] {
  return activities
    .map((a) => {
      const remaining = Math.max(0, a.contractQty - (executed[a.id] ?? 0));
      let covered = executed[a.id] ?? 0;
      const plan = Array.from({ length: weeks }, (_, i) => {
        const target = Math.min(a.contractQty, plannedQtyAt(a, addDays(weekStart, 7 * i + 6), cal));
        const q = Math.max(0, target - covered);
        covered += q;
        return q;
      });
      return { activityId: a.id, weeks: plan, remaining };
    })
    .filter((r) => r.remaining > 1e-9 && r.weeks.some((q) => q > 1e-9));
}

/** Porcentaje de plan cumplido: tareas cumplidas ÷ tareas comprometidas. */
export function ppc(items: { done: boolean | null }[]): number | null {
  const judged = items.filter((i) => i.done != null);
  return judged.length ? judged.filter((i) => i.done).length / judged.length : null;
}
