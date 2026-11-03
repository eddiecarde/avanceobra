/**
 * Informe diario: a partir de los datos del dashboard (dashboard_json) calcula lo del día, igual
 * que la página /informe de la web, y arma el texto para Telegram. Sin Deno ni red: se prueba con Vitest.
 * El motor de cálculo llega empaquetado en engine.js (npm run build:functions).
 */
import { buildDailyAnalysis, diffDays, type DailyAnalysis, type ReportInput } from "./engine.js";

export interface RawDashboard {
  project: {
    id: string;
    name: string;
    start_date: string | null;
    contract_end_date: string | null;
    workdays: number[] | null;
    holidays: string[] | null;
    colombian_holidays?: boolean | null;
  };
  activities: {
    id: string;
    code: string;
    name: string;
    unit: string;
    contract_qty: number;
    planned_start: string | null;
    planned_finish: string | null;
    weight?: number | null;
    work_group?: string | null;
    subfield?: string | null;
    front: { code: string; name: string } | null;
  }[];
  entries: {
    id: string;
    activity_id: string;
    work_date: string;
    quantity: number;
    effective_hours: number;
    lost_hours: number;
    loss_cause: string;
    /** Varias causas en un registro: [{ cause, hours }]; vacío = una con lost_hours y loss_cause. */
    losses?: { cause: string; hours: number }[] | null;
    weather: string | null;
    crew_size: number;
    notes?: string | null;
  }[];
  findings: {
    id: string;
    type: string;
    severity: string;
    status: string;
    description: string;
    due_date: string | null;
    created_at: string;
    closed_at: string | null;
    category?: string | null;
    impeditive?: boolean | null;
  }[];
}

export type Light = "green" | "amber" | "red" | "done" | "not_started" | "no_plan";

export interface ReportRow {
  code: string;
  /** Grupo de trabajo (planta por grupos), o null. */
  group: string | null;
  name: string;
  unit: string;
  dayQty: number;
  actualPct: number;
  plannedPct: number;
  dailyRate: number;
  requiredRate: number | null;
  light: Light;
  reason: string;
}

export interface DailyReport {
  projectId: string;
  projectName: string;
  day: string;
  contractEnd: string | null;
  actualPct: number;
  plannedPct: number;
  spi: number | null;
  projectedFinish: string | null;
  finishDelay: number | null;
  stalled: string[];
  entries: number;
  crew: number;
  effectiveHours: number;
  lostHours: number;
  weather: string | null;
  rows: ReportRow[];
  lossesToday: { cause: string; hours: number }[];
  weekCauses: { cause: string; hours: number; pct: number }[];
  findingsOpened: number;
  findingsClosed: number;
  openFindings: {
    severity: string;
    type: string;
    description: string;
    dueDate: string | null;
    overdue: boolean;
  }[];
  notes: { code: string; text: string }[];
  /** Análisis del informe (estados con criterio, prioridades, situaciones, observaciones). */
  analysis: DailyAnalysis;
  /** Parte diario del día (personal y equipos), si alguien lo envió; lo carga la Edge Function. */
  dayLog?: { personnel: number; equipment: number } | null;
}

export const LOSS_LABEL: Record<string, string> = {
  weather: "Clima",
  material: "Material",
  equipment: "Equipo",
  permits: "Permisos",
  labor: "Personal",
  design_client: "Diseño/Cliente",
  other: "Otra",
};
export const WEATHER_LABEL: Record<string, string> = {
  sunny: "Soleado",
  cloudy: "Nublado",
  light_rain: "Llovizna",
  heavy_rain: "Lluvia",
  storm: "Tormenta",
};
export const SEVERITY_LABEL: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};
export const FINDING_TYPE_LABEL: Record<string, string> = {
  quality: "Calidad",
  safety: "SST",
  environment: "Ambiental",
  operation: "Operación",
};
export const LIGHT_LABEL: Record<Light, string> = {
  green: "Al día",
  amber: "En riesgo",
  red: "Atrasada",
  done: "Terminada",
  not_started: "Por iniciar",
  no_plan: "Sin programa",
};
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Fecha de Colombia (UTC−5, sin horario de verano) de un instante. */
export const bogotaDate = (t: Date | string) => new Date(new Date(t).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

/** Datos de dashboard_json → entrada del análisis de informes (fechas de hallazgos en hora de Colombia). */
export function reportInputFromRaw(raw: RawDashboard): ReportInput {
  return {
    project: {
      id: raw.project.id,
      name: raw.project.name,
      startDate: raw.project.start_date,
      contractEnd: raw.project.contract_end_date,
    },
    calendar: {
      workdays: raw.project.workdays ?? undefined,
      holidays: raw.project.holidays ?? [],
      colombianHolidays: raw.project.colombian_holidays !== false,
    },
    activities: raw.activities.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      contractQty: Number(a.contract_qty),
      plannedStart: a.planned_start,
      plannedFinish: a.planned_finish,
      weight: a.weight == null ? undefined : Number(a.weight),
      front: a.front?.code ?? null,
      frontName: a.front?.name ?? null,
      group: a.work_group ?? null,
      responsible: null,
    })),
    entries: raw.entries.map((e) => ({
      activityId: e.activity_id,
      date: e.work_date,
      quantity: Number(e.quantity),
      crew: Number(e.crew_size),
      effectiveHours: Number(e.effective_hours),
      lostHours: Number(e.lost_hours),
      lossCause: e.loss_cause,
      losses: e.losses ?? undefined,
      weather: e.weather,
      notes: e.notes ?? "",
    })),
    findings: raw.findings.map((f) => ({
      id: f.id,
      type: f.type,
      severity: f.severity,
      status: f.status,
      description: f.description,
      createdAt: bogotaDate(f.created_at),
      closedAt: f.closed_at ? bogotaDate(f.closed_at) : null,
      dueDate: f.due_date,
      impeditive: !!f.impeditive,
    })),
  };
}

export function buildDailyReport(raw: RawDashboard, day: string): DailyReport {
  // Un solo cálculo (el del análisis) para que el mensaje, el PDF y la web digan lo mismo
  const analysis = buildDailyAnalysis(reportInputFromRaw(raw), day, {
    loss: LOSS_LABEL,
  });
  const curve = analysis.curve;
  const todays = raw.entries.filter((e) => e.work_date === day);
  const codeOf = new Map(raw.activities.map((a) => [a.id, a.code]));
  const code = (id: string) => codeOf.get(id) ?? "?";
  const rows: ReportRow[] = analysis.snapshot.rows
    .map((r) => ({
      code: r.code,
      group: r.group,
      name: r.name,
      unit: r.unit,
      dayQty: r.periodQty,
      actualPct: r.actualPct,
      plannedPct: r.plannedPct,
      dailyRate: r.dailyRate,
      requiredRate: r.requiredRate,
      light: r.light as Light,
      reason: r.reason,
    }))
    .filter((r) => r.dayQty > 0 || (r.light !== "done" && r.light !== "not_started"));

  const weather = new Map<string, number>();
  todays.forEach((e) => e.weather && weather.set(e.weather, (weather.get(e.weather) ?? 0) + 1));
  // Pérdidas por causa (un registro puede tener varias): las del análisis
  const lossesToday = new Map(analysis.lossesToday.map((l) => [l.cause, l.hours]));

  const finds = raw.findings.map((f) => ({
    ...f,
    created: bogotaDate(f.created_at),
    closed: f.closed_at ? bogotaDate(f.closed_at) : null,
  }));
  const open = finds
    .filter((f) => f.created <= day && (!f.closed || f.closed > day) && f.status !== "closed")
    .map((f) => ({
      severity: f.severity,
      type: f.type,
      description: f.description,
      dueDate: f.due_date,
      overdue: f.due_date != null && f.due_date < day,
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity]! - SEVERITY_RANK[b.severity]! || Number(b.overdue) - Number(a.overdue));

  return {
    projectId: raw.project.id,
    projectName: raw.project.name,
    day,
    contractEnd: raw.project.contract_end_date,
    actualPct: curve.actualToday,
    plannedPct: curve.plannedToday,
    spi: curve.spi,
    projectedFinish: curve.projectedFinish,
    finishDelay: curve.projectedFinish && raw.project.contract_end_date ? diffDays(raw.project.contract_end_date, curve.projectedFinish) : null,
    stalled: curve.stalled.map(code),
    entries: todays.length,
    crew: todays.reduce((s, e) => s + Number(e.crew_size), 0),
    effectiveHours: todays.reduce((s, e) => s + Number(e.effective_hours), 0),
    lostHours: [...lossesToday.values()].reduce((s, h) => s + h, 0),
    weather: [...weather.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    rows: rows.sort((a, b) => a.code.localeCompare(b.code)),
    lossesToday: [...lossesToday.entries()].map(([cause, hours]) => ({ cause, hours })).sort((a, b) => b.hours - a.hours),
    weekCauses: analysis.weekCauses,
    findingsOpened: finds.filter((f) => f.created === day).length,
    findingsClosed: finds.filter((f) => f.closed === day).length,
    openFindings: open,
    notes: todays.filter((e) => e.notes?.trim()).map((e) => ({ code: code(e.activity_id), text: e.notes!.trim() })),
    analysis,
  };
}

export const pct = (x: number | null) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`);
export const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Mensaje corto para Telegram (HTML). El detalle va en el PDF adjunto. */
/** Atrasadas con el criterio documentado del informe (las mismas que lista el PDF). */
const lateRows = (r: DailyReport) => {
  const late = new Set(r.analysis.snapshot.rows.filter((x) => x.status === "atrasada").map((x) => x.code));
  return r.rows.filter((x) => late.has(x.code));
};

export function reportTelegramHtml(r: DailyReport, webUrl: string): string {
  const late = lateRows(r);
  const produced = r.rows.filter((x) => x.dayQty > 0);
  const lines = [
    `📋 <b>Informe diario · ${esc(r.projectName)}</b>`,
    `${r.day}${r.weather ? ` · ${WEATHER_LABEL[r.weather] ?? r.weather}` : ""}`,
    "",
    `Avance real <b>${pct(r.actualPct)}</b> de ${pct(r.plannedPct)} programado (SPI ${pct(r.spi)})`,
    r.projectedFinish
      ? `Fin proyectado <b>${r.projectedFinish}</b>${r.finishDelay != null ? (r.finishDelay > 0 ? ` (+${r.finishDelay} días)` : ` (${-r.finishDelay} días antes)`) : ""}`
      : "Sin fecha proyectada: ninguna actividad con saldo avanza",
    "",
    r.entries ? `Hoy: ${r.entries} registro(s) · ${r.crew} personas · ${n1(r.effectiveHours)} h efectivas · ${n1(r.lostHours)} h perdidas` : "⚠ Hoy no hubo registros de avance.",
  ];
  if (produced.length) lines.push("", "<b>Producción</b>", ...produced.slice(0, 8).map((x) => `• ${esc(x.code)}: ${n1(x.dayQty)} ${esc(x.unit)}`));
  if (late.length) lines.push("", `<b>Atrasadas (${late.length})</b>`, ...late.slice(0, 5).map((x) => `■ ${esc(x.code)} ${pct(x.actualPct)} de ${pct(x.plannedPct)}`));
  if (r.weekCauses.length) lines.push("", `<b>Causas de la semana</b>: ${r.weekCauses.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h`).join(" · ")}`);
  const overdue = r.openFindings.filter((f) => f.overdue).length;
  lines.push("", `Hallazgos: ${r.findingsOpened} nuevo(s), ${r.findingsClosed} cerrado(s), ${r.openFindings.length} abierto(s)${overdue ? `, <b>${overdue} vencido(s)</b>` : ""}`);
  lines.push("", `<a href="${webUrl}/informe?p=${r.projectId}&d=${r.day}">Ver en la web</a> · PDF adjunto`);
  return lines.join("\n");
}

/** Lo que frena la obra: restricciones abiertas, hallazgos impeditivos y materiales por agotarse. */
export interface Blockers {
  constraints: { description: string; needBy: string | null }[];
  impeditive: string[];
  materials: string[];
}

/**
 * Resumen corto de la noche: lo hecho hoy, lo atrasado y lo que bloquea. En una planta por grupos
 * de trabajo resume por grupo (no por cada subcampo). El detalle va en el PDF adjunto.
 */
export function nightSummaryHtml(r: DailyReport, b: Blockers, webUrl: string): string {
  const produced = r.rows.filter((x) => x.dayQty > 0);
  const late = lateRows(r);
  const byGroup = (rows: ReportRow[]) => {
    const m = new Map<string, ReportRow[]>();
    for (const x of rows) m.set(x.group ?? x.code, [...(m.get(x.group ?? x.code) ?? []), x]);
    return [...m.entries()];
  };
  const grouped = r.rows.some((x) => x.group);
  const lines = [`🌙 <b>Resumen del día · ${esc(r.projectName)}</b>`, r.day, ""];

  lines.push(`✅ <b>Hecho hoy</b>: ${r.entries ? `${r.entries} registro(s) · ${r.crew} personas` : "no hubo registros de avance"}`);
  if (grouped)
    byGroup(produced)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .forEach(([g, xs]) => {
        const units = new Set(xs.map((x) => x.unit));
        lines.push(`• ${esc(g)}: ${units.size === 1 ? `${n1(xs.reduce((t, x) => t + x.dayQty, 0))} ${esc(xs[0]!.unit)}` : `${xs.length} actividad(es)`}`);
      });
  else produced.slice(0, 5).forEach((x) => lines.push(`• ${esc(x.code)}: ${n1(x.dayQty)} ${esc(x.unit)}`));

  lines.push(
    "",
    `⚠️ <b>Atrasado</b>: avance ${pct(r.actualPct)} de ${pct(r.plannedPct)} programado` +
      (r.finishDelay != null && r.finishDelay > 0
        ? ` · fin proyectado ${r.projectedFinish} (+${r.finishDelay} días)`
        : r.projectedFinish
          ? ` · fin proyectado ${r.projectedFinish}`
          : ""),
  );
  if (late.length) {
    const top = grouped
      ? byGroup(late)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 3)
          .map(([g, xs]) => `${esc(g)} (${xs.length})`)
      : late.slice(0, 3).map((x) => esc(x.code));
    lines.push(`${late.length} actividad(es) atrasadas: ${top.join(", ")}${late.length > 3 && !grouped ? "…" : ""}`);
  }

  const blocks = [
    ...b.constraints.slice(0, 2).map((c) => `• Restricción: ${esc(c.description)}${c.needBy ? ` (para ${c.needBy})` : ""}`),
    ...b.impeditive.slice(0, 2).map((d) => `• Impeditivo: ${esc(d)}`),
    ...b.materials.slice(0, 3).map((m) => `• Material por agotarse: ${esc(m)}`),
  ];
  const more = b.constraints.length + b.impeditive.length - Math.min(2, b.constraints.length) - Math.min(2, b.impeditive.length);
  lines.push("", `⛔ <b>Lo que bloquea</b>${blocks.length ? "" : ": nada abierto"}`, ...blocks, ...(more > 0 ? [`y ${more} más en la web`] : []));
  lines.push("", `<a href="${webUrl}/informe?p=${r.projectId}&d=${r.day}">Ver en la web</a> · informe completo en el PDF`);
  return lines.join("\n");
}
