"use client";

import { summarizeDailyLogs, weatherClaim, type DailyLogSummary, type RainInterval, type WeatherClaim } from "@avanceobra/engine";
import { fetchAll } from "./dashboard";
import { supabase } from "./supabase";

interface LogRow {
  log_date: string;
  personnel: { role: string; qty: number }[];
  equipment: { name: string; qty: number }[];
  rain: RainInterval[];
  observations: string;
}

export interface ParteData {
  /** Resumen por día de los partes (último envío de cada persona y frente), en orden de fecha. */
  days: DailyLogSummary[];
  claim: WeatherClaim;
  window: RainInterval;
}

/** Partes diarios y horas perdidas por clima de un rango (sin rango: toda la obra) con su reclamo por lluvia. */
export async function loadParte(projectId: string, effectiveHours: number, range: { from?: string; to?: string } = {}): Promise<ParteData> {
  const [p, logs, entries] = await Promise.all([
    supabase.from("projects").select("work_start, work_end").eq("id", projectId).single(),
    fetchAll<LogRow>((a, b) => {
      let q = supabase.from("daily_log_latest").select("log_date, personnel, equipment, rain, observations").eq("project_id", projectId);
      if (range.from) q = q.gte("log_date", range.from);
      if (range.to) q = q.lte("log_date", range.to);
      return q.order("log_date").order("id").range(a, b);
    }),
    fetchAll<{ work_date: string; lost_hours: number }>((a, b) => {
      let q = supabase.from("progress_entries").select("work_date, lost_hours").eq("project_id", projectId).eq("loss_cause", "weather").neq("status", "rejected");
      if (range.from) q = q.gte("work_date", range.from);
      if (range.to) q = q.lte("work_date", range.to);
      return q.order("work_date").order("id").range(a, b);
    }),
  ]);
  if (logs.error) throw new Error(logs.error.message);
  if (entries.error) throw new Error(entries.error.message);
  const window = { start: String(p.data?.work_start ?? "07:00").slice(0, 5), end: String(p.data?.work_end ?? "17:00").slice(0, 5) };
  const summaries = summarizeDailyLogs(
    logs.data.map((x) => ({ date: x.log_date, personnel: x.personnel ?? [], equipment: x.equipment ?? [], rain: x.rain ?? [], observations: x.observations })),
  );
  // Las cuadrillas paran a la vez por la misma lluvia: del día se toma el registro con más horas
  const entryHours = new Map<string, number>();
  for (const e of entries.data) entryHours.set(e.work_date, Math.max(entryHours.get(e.work_date) ?? 0, Number(e.lost_hours)));
  return {
    days: [...summaries.values()].sort((a, b) => a.date.localeCompare(b.date)),
    claim: weatherClaim(summaries.values(), entryHours, { window, effectiveHours }),
    window,
  };
}

/** Solo el reclamo por lluvia de toda la obra (para el simulador). */
export async function loadWeatherClaim(projectId: string, effectiveHours: number): Promise<WeatherClaim> {
  return (await loadParte(projectId, effectiveHours)).claim;
}
