"use client";

import {
  addDays,
  diffDays,
  lossPareto,
  summarizeDailyLogs,
  weeklyProgress,
  workingDaysBetween,
  type DailyLogSummary,
  type WeekColumn,
  type WeeklyProgress,
} from "@avanceobra/engine";
import { FINDING_TYPE_LABEL, LOSS_LABEL, SEVERITY_LABEL, WEATHER_LABEL, type DashData } from "./dashboard";
import { supabase } from "./supabase";

export const TEST_STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  enviado: "Enviado al laboratorio",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  no_aplica: "No aplica",
};

export interface LabTestRow {
  name: string;
  standard: string | null;
  sample_date: string | null;
  sent_date: string | null;
  lab: string | null;
  status: string;
  result: string | null;
  observation: string | null;
}

export interface ConstraintRow {
  description: string;
  responsible: string | null;
  need_by: string | null;
  status: string;
  released_at: string | null;
  created_at: string;
}

/** Parte diario, ensayos y restricciones de la semana (lo que no sale de los registros de avance). */
export interface WeekExtras {
  logs: Map<string, DailyLogSummary>;
  tests: LabTestRow[];
  constraints: ConstraintRow[];
}

export const emptyExtras = (): WeekExtras => ({ logs: new Map(), tests: [], constraints: [] });

export async function loadWeekExtras(projectId: string, week: WeekColumn): Promise<WeekExtras> {
  const [l, t, c] = await Promise.all([
    supabase
      .from("daily_log_latest")
      .select("log_date, personnel, equipment, rain, observations")
      .eq("project_id", projectId)
      .gte("log_date", week.start)
      .lte("log_date", week.end),
    supabase.from("lab_tests").select("name, standard, sample_date, sent_date, lab, status, result, observation, updated_at").eq("project_id", projectId),
    supabase.from("project_constraints").select("description, responsible, need_by, status, released_at, created_at").eq("project_id", projectId),
  ]);
  const logs = summarizeDailyLogs(
    ((l.data ?? []) as { log_date: string; personnel: { role: string; qty: number }[]; equipment: { name: string; qty: number }[]; rain: { start: string; end: string }[]; observations: string }[]).map(
      (x) => ({ date: x.log_date, personnel: x.personnel, equipment: x.equipment, rain: x.rain, observations: x.observations }),
    ),
  );
  // Ensayos de la semana: los tomados o enviados hasta su cierre que siguen abiertos o cambiaron en la semana
  const tests = ((t.data ?? []) as (LabTestRow & { updated_at: string })[]).filter((x) => {
    const started = (x.sample_date ?? x.sent_date ?? x.updated_at.slice(0, 10)) <= week.end;
    const open = x.status === "pendiente" || x.status === "enviado";
    return started && (open || x.updated_at.slice(0, 10) >= week.start);
  });
  // Restricciones: abiertas al cierre de la semana o liberadas durante ella
  const constraints = ((c.data ?? []) as ConstraintRow[]).filter(
    (x) => x.created_at.slice(0, 10) <= week.end && (x.status === "abierta" || (x.released_at != null && x.released_at >= week.start)),
  );
  return { logs, tests, constraints };
}

export interface WeeklyReport {
  data: DashData;
  progress: WeeklyProgress;
  /** Semana del informe (su índice es el número de informe). */
  week: WeekColumn;
  weekPos: number;
  days: string[];
  /** Cantidad por actividad y día de la semana. */
  dailyQty: Map<string, number[]>;
  dayInfo: { date: string; crew: number; entries: number; weather: string | null; rainHours: number; lostHours: number }[];
  alerts: string[];
  photos: { url: string; caption: string; date: string }[];
  /** Parte diario resumido por día de la semana (null si nadie lo envió). */
  logs: (DailyLogSummary | null)[];
  roles: string[];
  equipment: string[];
  tests: LabTestRow[];
  constraints: ConstraintRow[];
}

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const weekLabel = (w: WeekColumn) => `${dmy(w.start)} – ${dmy(w.lastWorkday)}/${w.lastWorkday.slice(2, 4)}`;

/** Semanas del proyecto: desde el inicio hasta la fecha contractual (o hasta hoy si ya pasó). */
export function projectSpan(data: DashData, today: string) {
  const starts = data.activities.map((a) => a.plannedStart).filter(Boolean) as string[];
  const ends = data.activities.map((a) => a.plannedFinish).filter(Boolean) as string[];
  const from = data.project.startDate ?? starts.sort()[0] ?? data.daily[0]?.date ?? today;
  const end = [data.project.contractEnd, ends.sort().at(-1), today].filter(Boolean).sort().at(-1)!;
  return { from, to: end };
}

export function buildWeeklyReport(data: DashData, weekIndex: number, today: string, photos: WeeklyReport["photos"] = [], extras: WeekExtras = emptyExtras()): WeeklyReport {
  const cal = data.project.calendar;
  const { from, to } = projectSpan(data, today);
  // El formato del cliente lista las actividades por nombre; si hay nombres repetidos (mismo trabajo en
  // varios frentes) se antepone el código para distinguirlas.
  const names = data.activities.map((a) => a.name);
  const repeated = new Set(names.filter((n, i) => names.indexOf(n) !== i));
  const activities = data.activities.map((a) => (repeated.has(a.name) ? { ...a, name: `${a.code} · ${a.name}` } : a));
  const progress = weeklyProgress({ activities, daily: data.daily, from, to, today, calendar: cal });
  const weekPos = Math.max(0, Math.min(progress.weeks.length - 1, progress.weeks.findIndex((w) => w.index === weekIndex)));
  const week = progress.weeks[weekPos]!;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.start, i));
  // Cantidad por actividad y día de la semana (un solo recorrido de los registros)
  const dailyQty = new Map(data.activities.map((a) => [a.id, days.map(() => 0)]));
  for (const x of data.daily) {
    const i = days.indexOf(x.date);
    if (i >= 0 && dailyQty.has(x.activityId)) dailyQty.get(x.activityId)![i]! += x.quantity;
  }
  const logs = days.map((d) => extras.logs.get(d) ?? null);
  const dayInfo = days.map((date, i) => {
    const es = data.entries.filter((e) => e.workDate === date);
    const weather = new Map<string, number>();
    es.forEach((e) => e.weather && weather.set(e.weather, (weather.get(e.weather) ?? 0) + 1));
    return {
      date,
      entries: es.length,
      // Con parte diario, el personal es el del parte; si no, la suma de las cuadrillas de los registros
      crew: logs[i]?.totalPersonnel ?? es.reduce((s, e) => s + e.crewSize, 0),
      weather: [...weather.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      rainHours: es.filter((e) => e.lossCause === "weather").reduce((s, e) => s + e.lostHours, 0),
      lostHours: es.filter((e) => e.lossCause !== "none").reduce((s, e) => s + e.lostHours, 0),
    };
  });

  // Alertas y restricciones: atrasos, causas de pérdida y hallazgos de la semana
  const alerts: string[] = [];
  const pos = weekPos;
  progress.rows
    .filter((r) => r.actual[pos] != null && r.planned[pos]! - (r.actual[pos] ?? 0) > 0.1)
    .sort((a, b) => b.planned[pos]! - (b.actual[pos] ?? 0) - (a.planned[pos]! - (a.actual[pos] ?? 0)))
    .slice(0, 4)
    .forEach((r) =>
      alerts.push(
        `${r.name.startsWith(r.code) ? r.name : `${r.code} ${r.name}`}: ${pct(r.actual[pos])} ejecutado contra ${pct(r.planned[pos])} programado (desviación ${pct((r.actual[pos] ?? 0) - r.planned[pos]!)}).`,
      ),
    );
  const causes = lossPareto(
    data.losses.filter((l) => l.date >= week.start && l.date <= week.end),
    "lost_hours",
  ).slice(0, 3);
  if (causes.length) alerts.push(`Horas perdidas en la semana: ${causes.map((c) => `${LOSS_LABEL[c.key] ?? c.key} ${num(c.value)} h`).join(", ")}.`);
  // "Vencido" se mide al cierre de la semana o a hoy, lo que ocurra primero
  const cutoff = week.end < today ? week.end : today;
  data.findings
    .filter((f) => (f.createdAt >= week.start && f.createdAt <= week.end) || (f.status !== "closed" && f.dueDate != null && f.dueDate < cutoff && f.createdAt <= week.end))
    .slice(0, 6)
    .forEach((f) =>
      alerts.push(
        `Hallazgo (${FINDING_TYPE_LABEL[f.type] ?? f.type}, severidad ${SEVERITY_LABEL[f.severity]?.toLowerCase()}): ${f.description}${
          f.dueDate && f.dueDate < cutoff && f.status !== "closed" ? ` · vencido desde ${f.dueDate}` : f.dueDate && f.status !== "closed" ? ` · vence el ${f.dueDate}` : ""
        }.`,
      ),
    );

  for (const c of extras.constraints.filter((x) => x.status === "abierta"))
    alerts.push(
      `Restricción abierta: ${c.description}${c.responsible ? ` (responsable: ${c.responsible})` : ""}${c.need_by ? `, necesaria para el ${c.need_by}${c.need_by < cutoff ? " · vencida" : ""}` : ""}.`,
    );

  const order = (names: string[], catalog: string[]) => [...catalog.filter((n) => names.includes(n)), ...names.filter((n) => !catalog.includes(n)).sort()];
  const roles = order([...new Set(logs.flatMap((l) => Object.keys(l?.personnel ?? {})))], data.project.personnelRoles);
  const equipment = order([...new Set(logs.flatMap((l) => Object.keys(l?.equipment ?? {})))], data.project.equipmentTypes);

  return { data, progress, week, weekPos, days, dailyQty, dayInfo, alerts, photos, logs, roles, equipment, tests: extras.tests, constraints: extras.constraints };
}

export const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`);
export const num = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** Fotos de la semana (subidas), con su URL firmada. */
export async function loadWeekPhotos(projectId: string, week: WeekColumn, activities: DashData["activities"]): Promise<WeeklyReport["photos"]> {
  const { data } = await supabase
    .from("photos")
    .select("storage_path, annotation, taken_at, entry:progress_entries(work_date, activity_id)")
    .eq("project_id", projectId)
    .eq("uploaded", true)
    .gte("taken_at", `${addDays(week.start, -1)}T00:00:00Z`)
    .lte("taken_at", `${addDays(week.end, 1)}T23:59:59Z`)
    .order("taken_at")
    .limit(60);
  const rows = ((data ?? []) as unknown as { storage_path: string; annotation: string | null; taken_at: string; entry: { work_date: string; activity_id: string } | null }[])
    .map((r) => ({ ...r, date: r.entry?.work_date ?? r.taken_at.slice(0, 10) }))
    .filter((r) => r.date >= week.start && r.date <= week.end)
    .slice(0, 12);
  if (!rows.length) return [];
  const signed = await supabase.storage.from("photos").createSignedUrls(rows.map((r) => r.storage_path), 3600);
  return rows.flatMap((r, i) => {
    const url = signed.data?.[i]?.signedUrl;
    const act = activities.find((a) => a.id === r.entry?.activity_id);
    return url ? [{ url, date: r.date, caption: [r.date, act ? `${act.code} ${act.name}` : "Hallazgo", r.annotation].filter(Boolean).join(" · ") }] : [];
  });
}

/** Días hábiles entre dos fechas del programa (columna "Tiempo de Ejecución" del formato). */
export const executionDays = (r: WeeklyReport, start: string | null, finish: string | null) =>
  start && finish ? workingDaysBetween(start, finish, r.data.project.calendar) : null;

export { diffDays, WEATHER_LABEL };
