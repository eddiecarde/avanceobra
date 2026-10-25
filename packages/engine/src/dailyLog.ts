/**
 * Parte diario: suma lo reportado por varios supervisores (cada uno su frente o cuadrilla) y une
 * los intervalos de lluvia que se solapan, para no contar dos veces la misma lluvia.
 */

export interface RainInterval {
  /** "HH:MM" en hora de Colombia. */
  start: string;
  end: string;
}

export interface DailyLogInput {
  date: string;
  personnel: { role: string; qty: number }[];
  equipment: { name: string; qty: number }[];
  rain: RainInterval[];
  observations?: string;
}

export interface DailyLogSummary {
  date: string;
  personnel: Record<string, number>;
  equipment: Record<string, number>;
  totalPersonnel: number;
  rain: RainInterval[];
  rainMinutes: number;
  observations: string[];
  reports: number;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Une intervalos solapados o contiguos y devuelve la lista ordenada y los minutos totales. */
export function mergeRain(intervals: RainInterval[]): { intervals: RainInterval[]; minutes: number } {
  const sorted = intervals
    .map((i) => [toMin(i.start), toMin(i.end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return { intervals: merged.map(([a, b]) => ({ start: toHHMM(a), end: toHHMM(b) })), minutes: merged.reduce((s, [a, b]) => s + b - a, 0) };
}

/** Resumen por día de los partes (ya filtrados al último envío de cada persona y frente). */
export function summarizeDailyLogs(logs: DailyLogInput[]): Map<string, DailyLogSummary> {
  const byDate = new Map<string, DailyLogInput[]>();
  for (const l of logs) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const out = new Map<string, DailyLogSummary>();
  for (const [date, ls] of byDate) {
    const personnel: Record<string, number> = {};
    const equipment: Record<string, number> = {};
    for (const l of ls) {
      for (const p of l.personnel) if (p.qty > 0) personnel[p.role] = (personnel[p.role] ?? 0) + p.qty;
      for (const e of l.equipment) if (e.qty > 0) equipment[e.name] = (equipment[e.name] ?? 0) + e.qty;
    }
    const rain = mergeRain(ls.flatMap((l) => l.rain));
    out.set(date, {
      date,
      personnel,
      equipment,
      totalPersonnel: Object.values(personnel).reduce((s, n) => s + n, 0),
      rain: rain.intervals,
      rainMinutes: rain.minutes,
      observations: ls.map((l) => l.observations?.trim() ?? "").filter(Boolean),
      reports: ls.length,
    });
  }
  return out;
}

export interface WeatherClaimDay {
  date: string;
  /** Lluvia del parte (intervalos unidos) y la parte que cayó dentro de la jornada. */
  rain: RainInterval[];
  rainHours: number;
  /** Mayor número de horas perdidas por clima en un registro de avance de ese día. */
  entryHours: number;
  /** Horas reclamables del día: la mayor de las dos fuentes, sin pasar de la jornada. */
  hours: number;
}

export interface WeatherClaim {
  days: WeatherClaimDay[];
  hours: number;
  /** Días completos de jornada (horas ÷ horas efectivas, hacia abajo). */
  claimableDays: number;
}

/** Minutos de lluvia dentro de la jornada de trabajo. */
export function rainInWindow(intervals: RainInterval[], window: RainInterval): number {
  const [ws, we] = [toMin(window.start), toMin(window.end)];
  return mergeRain(intervals).intervals.reduce((s, i) => s + Math.max(0, Math.min(we, toMin(i.end)) - Math.max(ws, toMin(i.start))), 0);
}

/**
 * Días reclamables por lluvia: por cada día se toma la lluvia del parte dentro de la jornada y las
 * horas perdidas por clima de los registros de avance. Las cuadrillas paran a la vez, así que no se
 * suman entre registros (se toma la mayor) ni se suman las dos fuentes (se toma la mayor).
 */
export function weatherClaim(
  logs: Iterable<DailyLogSummary>,
  entryHours: Map<string, number>,
  opts: { window: RainInterval; effectiveHours: number },
): WeatherClaim {
  const rain = new Map([...logs].map((l) => [l.date, l.rain]));
  const dates = [...new Set([...rain.keys(), ...entryHours.keys()])].sort();
  const days: WeatherClaimDay[] = [];
  for (const date of dates) {
    const intervals = rain.get(date) ?? [];
    const rainHours = rainInWindow(intervals, opts.window) / 60;
    const fromEntries = entryHours.get(date) ?? 0;
    const hours = Math.min(opts.effectiveHours, Math.max(rainHours, fromEntries));
    if (hours > 0) days.push({ date, rain: intervals, rainHours, entryHours: fromEntries, hours });
  }
  const hours = days.reduce((s, d) => s + d.hours, 0);
  return { days, hours, claimableDays: opts.effectiveHours > 0 ? Math.floor(hours / opts.effectiveHours + 1e-9) : 0 };
}
