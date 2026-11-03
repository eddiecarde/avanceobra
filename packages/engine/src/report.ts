/**
 * Análisis para los informes diario y semanal: estados de actividad con criterios documentados,
 * situaciones prioritarias, desviaciones, tendencias y observaciones de calidad de datos.
 * Lo usan la web (/informe y /semanal) y los PDF de las Edge Functions, para que digan lo mismo.
 * Distingue lo registrado (datos de campo), lo calculado (motor) y lo recomendado (reglas fijas):
 * no inventa causas, responsables ni compromisos.
 */
import { addDays, diffDays, isWorkingDay, workingDaysBetween, type ISODate, type WorkCalendar } from "./calendar.js";
import {
  activityStatus,
  DEFAULT_THRESHOLDS,
  plannedQtyAt,
  sCurve,
  weighting,
  type ActivityStatus,
  type ScheduleActivity,
  type SCurveResult,
  type StatusThresholds,
} from "./dashboard.js";
import { entryLossLines, lossPareto, type LossLine } from "./pareto.js";

/** Estado de la actividad en el informe (más fino que el semáforo del tablero). */
export type ReportStatus = "atrasada" | "sin_avance" | "sin_registros" | "en_riesgo" | "al_dia" | "terminada" | "por_iniciar" | "sin_programa";

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  atrasada: "Atrasada",
  sin_avance: "Sin avance reciente",
  sin_registros: "Sin registros",
  en_riesgo: "En riesgo",
  al_dia: "Al día",
  terminada: "Terminada",
  por_iniciar: "Por iniciar",
  sin_programa: "Sin fecha programada",
};

/** Orden de prioridad (lo que más requiere atención primero). */
export const REPORT_STATUS_ORDER: ReportStatus[] = ["atrasada", "sin_avance", "sin_registros", "en_riesgo", "al_dia", "por_iniciar", "sin_programa", "terminada"];

/** Criterio de cada estado: se imprime en el informe para que el semáforo sea verificable. */
export function reportStatusRules(th: StatusThresholds = DEFAULT_THRESHOLDS, windowDays = 14): Record<ReportStatus, string> {
  return {
    atrasada: `Con fechas programadas y (${th.redGapPts} puntos o más por debajo de lo programado, o terminaría más de ${th.redDelayDays} días después de su fin planeado al ritmo actual).`,
    sin_avance: `Ya tuvo avance, le falta cantidad y no registra producción en los últimos ${windowDays} días; aún no cumple el criterio de atrasada.`,
    sin_registros: "Su inicio programado ya pasó y no tiene ningún registro de avance; aún no cumple el criterio de atrasada.",
    en_riesgo: `Entre ${th.amberGapPts} y ${th.redGapPts} puntos por debajo de lo programado, o terminaría hasta ${th.redDelayDays} días tarde al ritmo actual.`,
    al_dia: "Avanza al ritmo necesario para terminar en su fecha planeada.",
    terminada: "Cantidad ejecutada igual o mayor a la contractual.",
    por_iniciar: "Su inicio programado es posterior a la fecha de corte.",
    sin_programa: "No tiene fecha de inicio o de fin programada: no se evalúa atraso.",
  };
}

export interface ReportActivityInput extends ScheduleActivity {
  /** Frente, sector o zona (código y nombre), si existe. */
  front: string | null;
  frontName: string | null;
  /** Grupo o disciplina (Hincas, Módulos…), si existe. */
  group: string | null;
  /** Empresa o persona responsable registrada, si existe. */
  responsible: string | null;
}

export interface ReportEntryInput {
  activityId: string;
  date: ISODate;
  quantity: number;
  crew: number;
  effectiveHours: number;
  lostHours: number;
  /** "none" si no hubo pérdida. */
  lossCause: string;
  /** Detalle por causa (varias pérdidas en un registro); vacío = una línea con lostHours y lossCause. */
  losses?: LossLine[];
  weather: string | null;
  notes: string;
}

export interface ReportFindingInput {
  id: string;
  type: string;
  severity: string;
  status: string;
  description: string;
  /** Fechas locales YYYY-MM-DD. */
  createdAt: ISODate;
  closedAt: ISODate | null;
  dueDate: ISODate | null;
  impeditive: boolean;
}

export interface ReportInput {
  project: {
    id: string;
    name: string;
    startDate: ISODate | null;
    contractEnd: ISODate | null;
  };
  calendar: WorkCalendar;
  activities: ReportActivityInput[];
  entries: ReportEntryInput[];
  findings: ReportFindingInput[];
  thresholds?: StatusThresholds;
  /** Ventana del ritmo reciente (días calendario). */
  windowDays?: number;
}

export interface ReportActivityRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  front: string | null;
  frontName: string | null;
  group: string | null;
  responsible: string | null;
  plannedStart: ISODate | null;
  plannedFinish: ISODate | null;
  contractQty: number;
  /** Ejecutado registrado (sin tope); el avance sí se limita al 100 %. */
  executedQty: number;
  pendingQty: number;
  /** Cantidad del día (diario) o del periodo (semanal). */
  periodQty: number;
  actualPct: number;
  plannedPct: number;
  /** Real − programado, en puntos porcentuales (negativo = atraso). */
  gapPts: number;
  dailyRate: number;
  requiredRate: number | null;
  projectedFinish: ISODate | null;
  delayDays: number | null;
  lastUpdate: ISODate | null;
  status: ReportStatus;
  /** Semáforo del tablero (activityStatus), para quien lo necesite. */
  light: ActivityStatus["light"];
  /** Le falta cantidad y no registra producción en la ventana reciente. */
  stalled: boolean;
  reason: string;
  /** Recomendación por regla fija (null si no requiere acción). */
  action: string | null;
}

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const fmtPct = (x: number) => `${(x * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;
/** 2026-10-15 → 15/10/2026 */
const dmy = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const fmtPts = (pts: number) => `${pts > 0 ? "+" : ""}${pts.toLocaleString("es-CO", { maximumFractionDigits: 1 })} pts`;

/** Índice por actividad: fechas ordenadas y acumulado, para preguntar "cuánto hasta tal fecha" rápido. */
function indexEntries(entries: ReportEntryInput[]) {
  const by = new Map<string, { dates: ISODate[]; cum: number[] }>();
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of sorted) {
    let x = by.get(e.activityId);
    if (!x) by.set(e.activityId, (x = { dates: [], cum: [] }));
    x.dates.push(e.date);
    x.cum.push((x.cum.at(-1) ?? 0) + e.quantity);
  }
  /** Último índice con fecha <= d (o -1). */
  const upto = (x: { dates: ISODate[] }, d: ISODate) => {
    let lo = 0;
    let hi = x.dates.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (x.dates[mid]! <= d) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
  return {
    sumUntil(id: string, d: ISODate) {
      const x = by.get(id);
      if (!x) return 0;
      const i = upto(x, d);
      return i < 0 ? 0 : x.cum[i]!;
    },
    lastDate(id: string, d: ISODate): ISODate | null {
      const x = by.get(id);
      if (!x) return null;
      const i = upto(x, d);
      return i < 0 ? null : x.dates[i]!;
    },
  };
}

function classify(st: ActivityStatus, executedRaw: number, stalled: boolean, th: StatusThresholds): ReportStatus {
  if (st.light === "done") return "terminada";
  if (st.light === "no_plan") return "sin_programa";
  if (st.light === "not_started") return "por_iniciar";
  const confirmedLate = st.gapPts <= -th.redGapPts || (st.delayDays ?? 0) > th.redDelayDays || st.requiredRate === Infinity;
  if (executedRaw <= 0) return confirmedLate ? "atrasada" : "sin_registros";
  if (stalled) return confirmedLate ? "atrasada" : "sin_avance";
  if (st.light === "red") return confirmedLate ? "atrasada" : "en_riesgo";
  if (st.light === "amber") return "en_riesgo";
  return "al_dia";
}

function actionFor(r: Omit<ReportActivityRow, "action">): string | null {
  const u = r.unit;
  switch (r.status) {
    case "atrasada":
      if (r.requiredRate === Infinity) return `Su fin planeado (${dmy(r.plannedFinish)}) ya pasó: reprogramar y asignar recursos para los ${fmt(r.pendingQty)} ${u} pendientes.`;
      if (r.requiredRate != null && r.dailyRate > 0)
        return `Subir el ritmo de ${fmt(r.dailyRate)} a ${fmt(r.requiredRate)} ${u}/día (×${fmt(r.requiredRate / r.dailyRate)}) o reprogramar su fin (${dmy(r.plannedFinish)}).`;
      if (r.executedQty <= 0) return `Programada desde el ${dmy(r.plannedStart)} sin ningún registro: confirmar si inició y actualizar el reporte, o reprogramarla.`;
      return `Sin producción reciente (último registro ${r.lastUpdate ?? "—"}): identificar y registrar la causa, y definir fecha de reinicio.`;
    case "sin_avance":
      return `Sin producción desde el ${dmy(r.lastUpdate)}: confirmar si está detenida y registrar la causa.`;
    case "sin_registros":
      return `Inició el ${dmy(r.plannedStart)} según el programa y no tiene registros: confirmar si arrancó y actualizar el reporte.`;
    case "en_riesgo":
      return r.requiredRate != null && Number.isFinite(r.requiredRate) && r.requiredRate > r.dailyRate
        ? `Vigilar el ritmo: necesita ${fmt(r.requiredRate)} ${u}/día y lleva ${fmt(r.dailyRate)}.`
        : "Vigilar: va por debajo de lo programado.";
    default:
      return null;
  }
}

export interface Snapshot {
  date: ISODate;
  rows: ReportActivityRow[];
  /** Avance global ponderado (fracción 0..1). */
  actual: number;
  planned: number;
  counts: Record<ReportStatus, number>;
}

/** Estado de todas las actividades a una fecha de corte. `periodFrom` define la cantidad del periodo. */
export function reportSnapshot(input: ReportInput, date: ISODate, periodFrom: ISODate = date, idx = indexEntries(input.entries)): Snapshot {
  const th = input.thresholds ?? DEFAULT_THRESHOLDS;
  const win = input.windowDays ?? 14;
  const cal = input.calendar;
  const windowFrom = addDays(date, -win);
  const rateDays = workingDaysBetween(addDays(date, -(win - 1)), date, cal);
  const rows: ReportActivityRow[] = input.activities.map((a) => {
    const executedRaw = idx.sumUntil(a.id, date);
    const recent = executedRaw - idx.sumUntil(a.id, windowFrom);
    const rate = rateDays > 0 ? recent / rateDays : 0;
    const st = activityStatus(a, executedRaw, rate, date, cal, th);
    const pending = Math.max(0, a.contractQty - executedRaw);
    const stalled = pending > 1e-9 && executedRaw > 0 && recent <= 0;
    const status = classify(st, executedRaw, stalled, th);
    const base = {
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      front: a.front,
      frontName: a.frontName,
      group: a.group,
      responsible: a.responsible,
      plannedStart: a.plannedStart,
      plannedFinish: a.plannedFinish,
      contractQty: a.contractQty,
      executedQty: executedRaw,
      pendingQty: pending,
      periodQty: executedRaw - idx.sumUntil(a.id, addDays(periodFrom, -1)),
      actualPct: st.actualPct,
      plannedPct: st.plannedPct,
      gapPts: st.gapPts,
      dailyRate: st.dailyRate,
      requiredRate: st.requiredRate,
      projectedFinish: st.projectedFinish,
      delayDays: st.delayDays,
      lastUpdate: idx.lastDate(a.id, date),
      status,
      light: st.light,
      stalled,
      reason: st.reason,
    };
    return { ...base, action: actionFor(base) };
  });
  const { acts, w } = weighting(input.activities);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const actual = acts.reduce((s, a) => s + w(a) * Math.min(1, byId.get(a.id)!.executedQty / a.contractQty), 0);
  const planned = acts.reduce((s, a) => s + w(a) * (plannedQtyAt(a, date, cal) / a.contractQty), 0);
  const counts = Object.fromEntries(REPORT_STATUS_ORDER.map((s) => [s, 0])) as Record<ReportStatus, number>;
  rows.forEach((r) => counts[r.status]++);
  return { date, rows, actual, planned, counts };
}

const PRIORITY: ReportStatus[] = ["atrasada", "sin_avance", "sin_registros", "en_riesgo"];
/** Actividades que requieren atención, de la más grave a la menos. */
export function priorityRows(rows: ReportActivityRow[]): ReportActivityRow[] {
  return rows
    .filter((r) => PRIORITY.includes(r.status))
    .sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status) || a.gapPts - b.gapPts || b.pendingQty / (b.contractQty || 1) - a.pendingQty / (a.contractQty || 1));
}

export type Tone = "critical" | "warning" | "info" | "good";
/** Situación destacada: lo que pasó (registrado o calculado), el dato y la acción sugerida. */
export interface Situation {
  tone: Tone;
  title: string;
  /** Dato que la sustenta. */
  evidence: string;
  /** Recomendación por regla fija, o null. */
  action: string | null;
}

export interface Observation {
  /** "dato" = inconsistencia o vacío en los datos de origen; "criterio" = cómo se calculó algo. */
  kind: "dato" | "criterio";
  text: string;
}

/** Inconsistencias y vacíos en los datos de origen (no se corrigen: se informan). */
export function dataObservations(input: ReportInput, cutoff: ISODate, snap: Snapshot): Observation[] {
  const out: Observation[] = [];
  const { excluded, weighted } = weighting(input.activities);
  const noDates = input.activities.filter((a) => !a.plannedStart || !a.plannedFinish);
  const noQty = input.activities.filter((a) => !(a.contractQty > 0));
  if (noDates.length)
    out.push({
      kind: "dato",
      text: `${noDates.length} actividad(es) sin fecha de inicio o fin programada (${noDates
        .slice(0, 5)
        .map((a) => a.code)
        .join(", ")}${noDates.length > 5 ? "…" : ""}): no entran al avance global ni se evalúa su atraso.`,
    });
  if (noQty.length)
    out.push({
      kind: "dato",
      text: `${noQty.length} actividad(es) con cantidad contractual 0: no entran al avance global.`,
    });
  const swapped = input.activities.filter((a) => a.plannedStart && a.plannedFinish && a.plannedFinish < a.plannedStart);
  if (swapped.length)
    out.push({
      kind: "dato",
      text: `${swapped.length} actividad(es) con fin programado anterior al inicio: revisar el programa (${swapped
        .slice(0, 5)
        .map((a) => a.code)
        .join(", ")}).`,
    });
  const over = snap.rows.filter((r) => r.contractQty > 0 && r.executedQty > r.contractQty * 1.0001);
  if (over.length)
    out.push({
      kind: "dato",
      text: `${over.length} actividad(es) con ejecutado mayor que la cantidad contractual (${over
        .slice(0, 4)
        .map((r) => `${r.code}: ${fmt(r.executedQty)} de ${fmt(r.contractQty)} ${r.unit}`)
        .join("; ")}${over.length > 4 ? "…" : ""}). El avance se limita al 100 %; revisar la cantidad contractual o los registros.`,
    });
  const future = input.entries.filter((e) => e.date > cutoff).length;
  if (future)
    out.push({
      kind: "criterio",
      text: `${future} registro(s) con fecha posterior al corte no se incluyen.`,
    });
  const orphan = input.entries.filter((e) => !input.activities.some((a) => a.id === e.activityId)).length;
  if (orphan)
    out.push({
      kind: "dato",
      text: `${orphan} registro(s) de avance de actividades que ya no existen en el programa no se cuentan.`,
    });
  const negative = input.entries.filter((e) => e.quantity < 0).length;
  if (negative)
    out.push({
      kind: "dato",
      text: `${negative} registro(s) con cantidad negativa (ajustes) restan del acumulado.`,
    });
  if (weighted) {
    const zero = input.activities.filter((a) => a.weight == null && a.contractQty > 0 && a.plannedStart && a.plannedFinish).length;
    if (zero)
      out.push({
        kind: "criterio",
        text: `Avance ponderado por peso: ${zero} actividad(es) sin peso asignado pesan 0 en el avance global.`,
      });
  } else if (input.activities.length - excluded.length > 1)
    out.push({
      kind: "criterio",
      text: "Ninguna actividad tiene peso: todas pesan igual en el avance global.",
    });
  if (!input.project.contractEnd)
    out.push({
      kind: "dato",
      text: "El proyecto no tiene fecha contractual: no se calcula el atraso frente al contrato.",
    });
  return out;
}

const DEFAULT_LABELS = { loss: {} as Record<string, string> };

export interface DailyAnalysis {
  day: ISODate;
  workday: boolean;
  curve: SCurveResult;
  actual: number;
  planned: number;
  deviationPts: number;
  spi: number | null;
  contractEnd: ISODate | null;
  projectedFinish: ISODate | null;
  finishDelay: number | null;
  /** Actividades con saldo que no avanzan: impiden proyectar la terminación. */
  stalledCodes: string[];
  snapshot: Snapshot;
  priority: ReportActivityRow[];
  /** Producción del día por frente (o grupo): cantidad por unidad y avance aportado. */
  production: {
    key: string;
    label: string;
    activities: number;
    qtyByUnit: { unit: string; qty: number }[];
    gainPts: number;
  }[];
  entries: number;
  crew: number;
  effectiveHours: number;
  lostHours: number;
  weather: string | null;
  lossesToday: { cause: string; hours: number }[];
  weekCauses: { cause: string; hours: number; pct: number }[];
  findings: {
    opened: ReportFindingInput[];
    closed: ReportFindingInput[];
    open: (ReportFindingInput & { overdue: boolean })[];
    overdue: number;
    impeditive: number;
    criticalHigh: number;
  };
  notes: { code: string; text: string }[];
  situations: Situation[];
  observations: Observation[];
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const TONE_RANK: Record<Tone, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  good: 3,
};

/** Avance aportado (puntos del avance global) por cada registro: comparable entre unidades distintas. */
function gainOf(input: ReportInput) {
  const { acts, w } = weighting(input.activities);
  const m = new Map(acts.map((a) => [a.id, w(a) / a.contractQty]));
  return (activityId: string, qty: number) => (m.get(activityId) ?? 0) * qty * 100;
}

function productionBy(input: ReportInput, list: ReportEntryInput[]) {
  const actById = new Map(input.activities.map((a) => [a.id, a]));
  const grouped = input.activities.some((a) => a.group);
  const gain = gainOf(input);
  const m = new Map<
    string,
    {
      label: string;
      acts: Set<string>;
      units: Map<string, number>;
      gain: number;
    }
  >();
  for (const e of list) {
    const a = actById.get(e.activityId);
    if (!a) continue;
    const key = (grouped ? a.group : a.front) ?? a.front ?? "—";
    const label = grouped ? (a.group ?? key) : a.frontName ? `${a.front} · ${a.frontName}` : key;
    const x = m.get(key) ?? {
      label,
      acts: new Set(),
      units: new Map(),
      gain: 0,
    };
    x.acts.add(a.id);
    x.units.set(a.unit, (x.units.get(a.unit) ?? 0) + e.quantity);
    x.gain += gain(a.id, e.quantity);
    m.set(key, x);
  }
  return [...m.entries()]
    .map(([key, x]) => ({
      key,
      label: x.label,
      activities: x.acts.size,
      qtyByUnit: [...x.units.entries()].map(([unit, qty]) => ({ unit, qty })).sort((a, b) => b.qty - a.qty),
      gainPts: x.gain,
    }))
    .sort((a, b) => b.gainPts - a.gainPts || b.activities - a.activities);
}

function openFindingsAt(findings: ReportFindingInput[], d: ISODate) {
  return findings
    .filter((f) => f.createdAt <= d && (!f.closedAt || f.closedAt > d) && !(f.status === "closed" && !f.closedAt))
    .map((f) => ({ ...f, overdue: f.dueDate != null && f.dueDate < d }))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || Number(b.overdue) - Number(a.overdue));
}

export function buildDailyAnalysis(input: ReportInput, day: ISODate, labels: { loss: Record<string, string> } = DEFAULT_LABELS): DailyAnalysis {
  const cal = input.calendar;
  const upTo = input.entries.filter((e) => e.date <= day);
  const idx = indexEntries(upTo);
  const starts = input.activities.map((a) => a.plannedStart).filter(Boolean) as string[];
  const from = input.project.startDate ?? starts.sort()[0] ?? day;
  const to = input.project.contractEnd ?? day;
  const curve = sCurve({
    activities: input.activities,
    daily: upTo.map((e) => ({
      activityId: e.activityId,
      date: e.date,
      quantity: e.quantity,
    })),
    from: from > day ? day : from,
    to: to < day ? day : to,
    today: day,
    calendar: cal,
    rateWindowDays: input.windowDays,
  });
  const snapshot = reportSnapshot({ ...input, entries: upTo }, day, day, idx);
  const priority = priorityRows(snapshot.rows);
  const todays = upTo.filter((e) => e.date === day);
  const weatherCount = new Map<string, number>();
  todays.forEach((e) => e.weather && weatherCount.set(e.weather, (weatherCount.get(e.weather) ?? 0) + 1));
  const losses = new Map<string, number>();
  todays.flatMap(entryLossLines).forEach((l) => losses.set(l.cause, (losses.get(l.cause) ?? 0) + l.hours));
  const weekCauses = lossPareto(
    upTo
      .filter((e) => e.date >= addDays(day, -6))
      .flatMap(entryLossLines)
      .map((l) => ({ cause: l.cause, lostHours: l.hours })),
    "lost_hours",
  )
    .slice(0, 3)
    .map((r) => ({ cause: r.key, hours: r.value, pct: r.pct }));
  const open = openFindingsAt(input.findings, day);
  const code = new Map(input.activities.map((a) => [a.id, a.code]));
  const finishDelay = curve.projectedFinish && input.project.contractEnd ? diffDays(input.project.contractEnd, curve.projectedFinish) : null;
  const deviationPts = (curve.actualToday - curve.plannedToday) * 100;
  const a: DailyAnalysis = {
    day,
    workday: isWorkingDay(day, cal),
    curve,
    actual: curve.actualToday,
    planned: curve.plannedToday,
    deviationPts,
    spi: curve.spi,
    contractEnd: input.project.contractEnd,
    projectedFinish: curve.projectedFinish,
    finishDelay,
    stalledCodes: curve.stalled.map((id) => code.get(id) ?? "?"),
    snapshot,
    priority,
    production: productionBy(input, todays),
    entries: todays.length,
    crew: todays.reduce((s, e) => s + e.crew, 0),
    effectiveHours: todays.reduce((s, e) => s + e.effectiveHours, 0),
    lostHours: [...losses.values()].reduce((s, h) => s + h, 0),
    weather: [...weatherCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
    lossesToday: [...losses.entries()].map(([cause, hours]) => ({ cause, hours })).sort((x, y) => y.hours - x.hours),
    weekCauses,
    findings: {
      opened: input.findings.filter((f) => f.createdAt === day),
      closed: input.findings.filter((f) => f.closedAt === day),
      open,
      overdue: open.filter((f) => f.overdue).length,
      impeditive: open.filter((f) => f.impeditive).length,
      criticalHigh: open.filter((f) => f.severity === "critical" || f.severity === "high").length,
    },
    notes: todays
      .filter((e) => e.notes?.trim())
      .map((e) => ({
        code: code.get(e.activityId) ?? "?",
        text: e.notes.trim(),
      })),
    situations: [],
    observations: dataObservations(input, day, snapshot),
  };
  a.situations = dailySituations(a, labels);
  return a;
}

function dailySituations(a: DailyAnalysis, labels: { loss: Record<string, string> }): Situation[] {
  const s: Situation[] = [];
  const late = a.snapshot.counts.atrasada;
  if (a.finishDelay != null && a.finishDelay > 0)
    s.push({
      tone: "critical",
      title: `La terminación proyectada supera la fecha contractual en ${a.finishDelay} días`,
      evidence: `Fin proyectado ${dmy(a.projectedFinish)} frente a ${dmy(a.contractEnd)} (al ritmo de los últimos 14 días).`,
      action: "Revisar el plan de recuperación de las actividades críticas atrasadas o evaluar escenarios en el simulador.",
    });
  else if (!a.projectedFinish && a.stalledCodes.length)
    s.push({
      tone: "warning",
      title: "No se puede proyectar la terminación",
      evidence: `${a.stalledCodes.length} actividad(es) con saldo no registran producción reciente (${a.stalledCodes.slice(0, 4).join(", ")}${a.stalledCodes.length > 4 ? "…" : ""}).`,
      action: "Confirmar si están detenidas y registrar la causa o la fecha de reinicio.",
    });
  if (a.planned > 0 && a.deviationPts <= -5)
    s.push({
      tone: a.deviationPts <= -15 ? "critical" : "warning",
      title: `Avance global ${fmt(-a.deviationPts)} puntos por debajo del programa`,
      evidence: `Real ${fmtPct(a.actual)} frente a ${fmtPct(a.planned)} programado${a.spi != null ? ` (SPI ${a.spi.toLocaleString("es-CO", { maximumFractionDigits: 2 })})` : ""}.`,
      action: late ? `Priorizar las ${late} actividad(es) atrasadas de la tabla de prioridades.` : null,
    });
  const top = a.priority.find((r) => r.status === "atrasada");
  if (top)
    s.push({
      tone: "critical",
      title: `${top.code} · ${top.name}: ${fmtPts(top.gapPts)} frente a lo programado`,
      evidence: `${fmtPct(top.actualPct)} ejecutado de ${fmtPct(top.plannedPct)} programado; faltan ${fmt(top.pendingQty)} ${top.unit}.`,
      action: top.action,
    });
  if (a.workday && a.entries === 0)
    s.push({
      tone: "warning",
      title: "Día laborable sin registros de avance",
      evidence: "No hay registros enviados o aprobados con esta fecha.",
      action: "Confirmar con los supervisores si hubo trabajo y que los teléfonos sincronizaron.",
    });
  if (a.findings.overdue || a.findings.impeditive)
    s.push({
      tone: a.findings.impeditive ? "critical" : "warning",
      title: `${a.findings.open.length} hallazgo(s) abierto(s): ${a.findings.overdue} vencido(s)${a.findings.impeditive ? `, ${a.findings.impeditive} impeditivo(s)` : ""}`,
      evidence: a.findings.open[0] ? `El más grave: ${a.findings.open[0].description}${a.findings.open[0].dueDate ? ` (límite ${dmy(a.findings.open[0].dueDate)})` : ""}.` : "",
      action: "Cerrar o reprogramar los hallazgos vencidos con su responsable.",
    });
  if (a.lostHours > 0) {
    const c = a.lossesToday[0]!;
    s.push({
      tone: "info",
      title: `${fmt(a.lostHours)} h perdidas en el día`,
      evidence: `Causa principal registrada: ${labels.loss[c.cause] ?? c.cause} (${fmt(c.hours)} h).`,
      action: null,
    });
  }
  const sinAvance = a.snapshot.counts.sin_avance + a.snapshot.counts.sin_registros;
  if (sinAvance)
    s.push({
      tone: "warning",
      title: `${sinAvance} actividad(es) iniciadas sin producción reciente`,
      evidence: `${a.snapshot.counts.sin_avance} sin avance en 14 días y ${a.snapshot.counts.sin_registros} sin ningún registro desde su inicio programado.`,
      action: "Actualizar su estado o registrar la causa de la detención.",
    });
  if (!s.length && a.entries > 0)
    s.push({
      tone: "good",
      title: "Obra según el programa",
      evidence: `Real ${fmtPct(a.actual)} frente a ${fmtPct(a.planned)} programado.`,
      action: null,
    });
  return s.sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]).slice(0, 5);
}

// ------------------------------------------------------------------ Semanal

export interface WeekDay {
  date: ISODate;
  workday: boolean;
  actual: number;
  planned: number;
  /** Avance aportado en el día (puntos del avance global). */
  gainPts: number;
  /** Avance aportado por frente/grupo (clave → puntos). */
  gainBy: Record<string, number>;
  entries: number;
  crew: number;
  lostHours: number;
}

export interface WeekTrendPoint {
  weekStart: ISODate;
  weekEnd: ISODate;
  actual: number;
  planned: number;
  gainPts: number;
  late: number;
  pending: number;
  attention: number;
  findingsOpened: number;
  findingsClosed: number;
  findingsOpen: number;
}

export interface DeviationRow {
  row: ReportActivityRow;
  /** Brecha al cierre de la semana anterior (null si no aplicaba). */
  prevGapPts: number | null;
  trend: "mejora" | "empeora" | "igual" | "nueva";
  /** Causas registradas en los registros de la semana (horas perdidas), o vacío. */
  causes: { cause: string; hours: number }[];
  /** Ritmo de la semana (cantidad ÷ días laborables). */
  weekRate: number;
}

export interface WeeklyAnalysis {
  weekStart: ISODate;
  weekEnd: ISODate;
  /** Fecha de corte: el fin de la semana o hoy si la semana está en curso. */
  cutoff: ISODate;
  inProgress: boolean;
  actualStart: number;
  actualEnd: number;
  plannedStart: number;
  plannedEnd: number;
  deviationStartPts: number;
  deviationEndPts: number;
  gainPts: number;
  plannedGainPts: number;
  prevGainPts: number | null;
  spi: number | null;
  contractEnd: ISODate | null;
  projectedFinish: ISODate | null;
  finishDelay: number | null;
  /** Fin proyectado con el corte de la semana anterior (para comparar). */
  prevProjectedFinish: ISODate | null;
  curve: SCurveResult;
  start: Snapshot;
  end: Snapshot;
  completed: ReportActivityRow[];
  priority: ReportActivityRow[];
  days: WeekDay[];
  /** Frentes/grupos (clave → etiqueta) en el orden de la leyenda. */
  groups: { key: string; label: string }[];
  production: DailyAnalysis["production"];
  /** Ritmo de la semana frente al necesario, por actividad con saldo y fecha planeada. */
  rateVsRequired: {
    code: string;
    name: string;
    unit: string;
    weekRate: number;
    requiredRate: number;
    ratio: number;
  }[];
  deviations: DeviationRow[];
  trend: WeekTrendPoint[];
  entries: number;
  prevEntries: number;
  crewDays: number;
  lostHours: number;
  prevLostHours: number;
  causes: { cause: string; hours: number; pct: number }[];
  findings: {
    opened: number;
    closed: number;
    open: number;
    overdue: number;
    impeditive: number;
    prevOpened: number;
    prevClosed: number;
  };
  situations: Situation[];
  observations: Observation[];
}

export function buildWeeklyAnalysis(
  input: ReportInput,
  weekStart: ISODate,
  today: ISODate,
  opts: { trendWeeks?: number; labels?: { loss: Record<string, string> } } = {},
): WeeklyAnalysis {
  const cal = input.calendar;
  const labels = opts.labels ?? DEFAULT_LABELS;
  const weekEnd = addDays(weekStart, 6);
  const cutoff = weekEnd < today ? weekEnd : today < weekStart ? weekStart : today;
  const prevEnd = addDays(weekStart, -1);
  const prevStart = addDays(weekStart, -7);
  const upTo = input.entries.filter((e) => e.date <= cutoff);
  const idx = indexEntries(upTo);
  const inp = { ...input, entries: upTo };
  const starts = input.activities.map((a) => a.plannedStart).filter(Boolean) as string[];
  const from0 = input.project.startDate ?? starts.sort()[0] ?? weekStart;
  const from = from0 > cutoff ? cutoff : from0;
  const to = input.project.contractEnd ?? cutoff;
  const grouped = input.activities.some((a) => a.group);
  const groupOf = grouped
    ? {
        groupOf: (id: string) => input.activities.find((a) => a.id === id)?.group ?? null,
        rateWindowDays: 21,
      }
    : {};
  const daily = upTo.map((e) => ({
    activityId: e.activityId,
    date: e.date,
    quantity: e.quantity,
  }));
  const curve = sCurve({
    activities: input.activities,
    daily,
    from,
    to: to < cutoff ? cutoff : to,
    today: cutoff,
    calendar: cal,
    ...groupOf,
  });
  const prevCurve =
    prevEnd >= from
      ? sCurve({
          activities: input.activities,
          daily: daily.filter((d) => d.date <= prevEnd),
          from,
          to: to < prevEnd ? prevEnd : to,
          today: prevEnd,
          calendar: cal,
          ...groupOf,
        })
      : null;

  const start = reportSnapshot(inp, prevEnd, prevStart, idx);
  const end = reportSnapshot(inp, cutoff, weekStart, idx);
  const startById = new Map(start.rows.map((r) => [r.id, r]));
  const inWeek = upTo.filter((e) => e.date >= weekStart && e.date <= cutoff);
  const prevWeek = input.entries.filter((e) => e.date >= prevStart && e.date <= prevEnd);

  // Días de la semana: avance acumulado y aportado por frente/grupo
  const gain = gainOf(input);
  const actById = new Map(input.activities.map((a) => [a.id, a]));
  const keyOf = (id: string) => {
    const a = actById.get(id);
    return a ? ((grouped ? a.group : a.front) ?? a.front ?? "—") : "—";
  };
  const { acts, w } = weighting(input.activities);
  const actualAt = (d: ISODate) => acts.reduce((s, a) => s + w(a) * Math.min(1, idx.sumUntil(a.id, d) / a.contractQty), 0);
  const plannedAt = (d: ISODate) => acts.reduce((s, a) => s + w(a) * (plannedQtyAt(a, d, cal) / a.contractQty), 0);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const es = inWeek.filter((e) => e.date === date);
    const gainBy: Record<string, number> = {};
    for (const e of es) gainBy[keyOf(e.activityId)] = (gainBy[keyOf(e.activityId)] ?? 0) + gain(e.activityId, e.quantity);
    const past = date <= cutoff;
    return {
      date,
      workday: isWorkingDay(date, cal),
      actual: past ? actualAt(date) : NaN,
      planned: plannedAt(date),
      gainPts: past ? (actualAt(date) - actualAt(addDays(date, -1))) * 100 : NaN,
      gainBy,
      entries: es.length,
      crew: es.reduce((s, e) => s + e.crew, 0),
      lostHours: es.flatMap(entryLossLines).reduce((s, l) => s + l.hours, 0),
    };
  });
  const production = productionBy(input, inWeek);
  const groups = production.map((p) => ({ key: p.key, label: p.label }));

  // Ritmo de la semana frente al necesario
  const weekWorkdays = Math.max(1, workingDaysBetween(weekStart, cutoff, cal));
  const rateVsRequired = end.rows
    .filter((r) => r.requiredRate != null && Number.isFinite(r.requiredRate) && r.requiredRate > 0 && r.status !== "terminada" && (r.periodQty > 0 || r.status === "atrasada"))
    .map((r) => {
      const weekRate = r.periodQty / weekWorkdays;
      return {
        code: r.code,
        name: r.name,
        unit: r.unit,
        weekRate,
        requiredRate: r.requiredRate!,
        ratio: weekRate / r.requiredRate!,
      };
    })
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 12);

  // Desviaciones principales
  const causesByAct = new Map<string, Map<string, number>>();
  for (const e of inWeek)
    for (const l of entryLossLines(e)) {
      const m = causesByAct.get(e.activityId) ?? new Map<string, number>();
      m.set(l.cause, (m.get(l.cause) ?? 0) + l.hours);
      causesByAct.set(e.activityId, m);
    }
  const priority = priorityRows(end.rows);
  const deviations: DeviationRow[] = priority.slice(0, 15).map((row) => {
    const prev = startById.get(row.id);
    const prevApplies = prev && !["por_iniciar", "sin_programa"].includes(prev.status);
    const prevGapPts = prevApplies ? prev.gapPts : null;
    const trend = prevGapPts == null ? "nueva" : row.gapPts > prevGapPts + 0.5 ? "mejora" : row.gapPts < prevGapPts - 0.5 ? "empeora" : "igual";
    const causes = [...(causesByAct.get(row.id) ?? new Map()).entries()].map(([cause, hours]) => ({ cause, hours })).sort((a, b) => b.hours - a.hours);
    return {
      row,
      prevGapPts,
      trend,
      causes,
      weekRate: row.periodQty / weekWorkdays,
    };
  });

  // Tendencia de las últimas semanas
  const nWeeks = opts.trendWeeks ?? 8;
  const trend: WeekTrendPoint[] = [];
  for (let k = nWeeks - 1; k >= 0; k--) {
    const ws = addDays(weekStart, -7 * k);
    const we = k === 0 ? cutoff : addDays(ws, 6);
    if (we < from) continue;
    const snap = k === 0 ? end : reportSnapshot(inp, we, ws, idx);
    const prevA = actualAt(addDays(ws, -1));
    const open = openFindingsAt(input.findings, we);
    trend.push({
      weekStart: ws,
      weekEnd: we,
      actual: snap.actual,
      planned: snap.planned,
      gainPts: (snap.actual - prevA) * 100,
      late: snap.counts.atrasada,
      pending: snap.rows.filter((r) => r.status !== "terminada").length,
      attention: snap.counts.atrasada + snap.counts.sin_avance + snap.counts.sin_registros + snap.counts.en_riesgo,
      findingsOpened: input.findings.filter((f) => f.createdAt >= ws && f.createdAt <= we).length,
      findingsClosed: input.findings.filter((f) => f.closedAt != null && f.closedAt >= ws && f.closedAt <= we).length,
      findingsOpen: open.length,
    });
  }

  const causes = lossPareto(
    inWeek.flatMap(entryLossLines).map((l) => ({ cause: l.cause, lostHours: l.hours })),
    "lost_hours",
  )
    .slice(0, 4)
    .map((r) => ({ cause: r.key, hours: r.value, pct: r.pct }));
  const openEnd = openFindingsAt(input.findings, cutoff);
  const actualStart = start.actual;
  const prevPrevActual = actualAt(addDays(prevStart, -1));
  const finishDelay = curve.projectedFinish && input.project.contractEnd ? diffDays(input.project.contractEnd, curve.projectedFinish) : null;
  const w2: WeeklyAnalysis = {
    weekStart,
    weekEnd,
    cutoff,
    inProgress: cutoff < weekEnd,
    actualStart,
    actualEnd: end.actual,
    plannedStart: start.planned,
    plannedEnd: end.planned,
    deviationStartPts: (start.actual - start.planned) * 100,
    deviationEndPts: (end.actual - end.planned) * 100,
    gainPts: (end.actual - actualStart) * 100,
    plannedGainPts: (end.planned - start.planned) * 100,
    prevGainPts: prevEnd >= from ? (actualStart - prevPrevActual) * 100 : null,
    spi: end.planned > 0 ? end.actual / end.planned : null,
    contractEnd: input.project.contractEnd,
    projectedFinish: curve.projectedFinish,
    finishDelay,
    prevProjectedFinish: prevCurve?.projectedFinish ?? null,
    curve,
    start,
    end,
    completed: end.rows.filter((r) => r.status === "terminada" && startById.get(r.id)?.status !== "terminada"),
    priority,
    days,
    groups,
    production,
    rateVsRequired,
    deviations,
    trend,
    entries: inWeek.length,
    prevEntries: prevWeek.length,
    crewDays: inWeek.reduce((s, e) => s + e.crew, 0),
    lostHours: inWeek.flatMap(entryLossLines).reduce((s, l) => s + l.hours, 0),
    prevLostHours: prevWeek.flatMap(entryLossLines).reduce((s, l) => s + l.hours, 0),
    causes,
    findings: {
      opened: input.findings.filter((f) => f.createdAt >= weekStart && f.createdAt <= cutoff).length,
      closed: input.findings.filter((f) => f.closedAt != null && f.closedAt >= weekStart && f.closedAt <= cutoff).length,
      open: openEnd.length,
      overdue: openEnd.filter((f) => f.overdue).length,
      impeditive: openEnd.filter((f) => f.impeditive).length,
      prevOpened: input.findings.filter((f) => f.createdAt >= prevStart && f.createdAt <= prevEnd).length,
      prevClosed: input.findings.filter((f) => f.closedAt != null && f.closedAt >= prevStart && f.closedAt <= prevEnd).length,
    },
    situations: [],
    observations: dataObservations(input, cutoff, end),
  };
  w2.situations = weeklySituations(w2, labels);
  return w2;
}

function weeklySituations(w: WeeklyAnalysis, labels: { loss: Record<string, string> }): Situation[] {
  const s: Situation[] = [];
  if (w.finishDelay != null && w.finishDelay > 0)
    s.push({
      tone: "critical",
      title: `Terminación proyectada ${w.finishDelay} días después de la fecha contractual`,
      evidence: `Fin proyectado ${dmy(w.projectedFinish)} frente a ${dmy(w.contractEnd)}${w.prevProjectedFinish ? ` (la semana anterior: ${dmy(w.prevProjectedFinish)})` : ""}.`,
      action: "Definir el plan de recuperación con las actividades de mayor desviación o evaluar escenarios en el simulador.",
    });
  const dDev = w.deviationEndPts - w.deviationStartPts;
  if (w.plannedEnd > 0 && w.deviationEndPts <= -5)
    s.push({
      tone: w.deviationEndPts <= -15 ? "critical" : "warning",
      title: `Desviación de ${fmtPts(w.deviationEndPts)} al cierre (${dDev < -0.05 ? "empeoró" : dDev > 0.05 ? "mejoró" : "sin cambio"} ${fmt(Math.abs(dDev))} pts en la semana)`,
      evidence: `Avanzó ${fmt(w.gainPts)} pts frente a ${fmt(w.plannedGainPts)} pts programados en la semana.`,
      action: dDev < 0 ? "La producción no alcanza el ritmo programado: reforzar las actividades de la tabla de desviaciones." : null,
    });
  if (w.prevGainPts != null && w.prevGainPts > 0 && w.gainPts < w.prevGainPts * 0.8)
    s.push({
      tone: "warning",
      title: `La producción bajó frente a la semana anterior`,
      evidence: `${fmt(w.gainPts)} pts de avance esta semana frente a ${fmt(w.prevGainPts)} pts la anterior.`,
      action: w.causes[0]
        ? `Revisar la causa principal registrada: ${labels.loss[w.causes[0].cause] ?? w.causes[0].cause}.`
        : "Revisar con los frentes la causa (no hay pérdidas registradas).",
    });
  else if (w.prevGainPts != null && w.gainPts > w.prevGainPts * 1.2 && w.gainPts > 0)
    s.push({
      tone: "good",
      title: "La producción subió frente a la semana anterior",
      evidence: `${fmt(w.gainPts)} pts frente a ${fmt(w.prevGainPts)} pts.`,
      action: null,
    });
  const worse = w.deviations.filter((d) => d.trend === "empeora");
  if (worse.length)
    s.push({
      tone: "warning",
      title: `${worse.length} actividad(es) aumentaron su desviación`,
      evidence: worse
        .slice(0, 3)
        .map((d) => `${d.row.code}: ${fmtPts(d.prevGapPts ?? 0)} → ${fmtPts(d.row.gapPts)}`)
        .join(", "),
      action: worse[0]!.row.action ? `${worse[0]!.row.code}: ${worse[0]!.row.action}` : null,
    });
  if (w.findings.overdue || w.findings.impeditive)
    s.push({
      tone: w.findings.impeditive ? "critical" : "warning",
      title: `${w.findings.open} hallazgo(s) abierto(s) al cierre: ${w.findings.overdue} vencido(s)${w.findings.impeditive ? `, ${w.findings.impeditive} impeditivo(s)` : ""}`,
      evidence: `En la semana se abrieron ${w.findings.opened} y se cerraron ${w.findings.closed}.`,
      action: "Cerrar o reprogramar los hallazgos vencidos con su responsable.",
    });
  if (w.completed.length)
    s.push({
      tone: "good",
      title: `${w.completed.length} actividad(es) terminadas en la semana`,
      evidence: w.completed
        .slice(0, 4)
        .map((r) => r.code)
        .join(", "),
      action: null,
    });
  return s.sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]).slice(0, 5);
}
