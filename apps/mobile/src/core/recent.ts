/**
 * "Valores recientes": ordena actividades por uso reciente del usuario y propone
 * los valores del último registro para no reescribir en campo.
 */

export interface RecentEntry {
  activity_id: string;
  work_date: string;
  client_created_at: string;
  quantity: number;
  effective_hours: number | null;
  crew_size: number | null;
  weather: string | null;
}

export interface Suggestion {
  quantity: number | null;
  effectiveHours: number;
  crewSize: number;
  weather: string | null;
}

/** Puntaje: usos en los últimos 14 días, con más peso a los más recientes. */
export function rankActivities<T extends { id: string; code: string }>(
  activities: T[],
  recent: RecentEntry[],
  today: string,
): T[] {
  const score = new Map<string, number>();
  const todayMs = Date.parse(today);
  for (const e of recent) {
    const ageDays = Math.max(0, (todayMs - Date.parse(e.work_date)) / 86_400_000);
    if (ageDays > 14) continue;
    score.set(e.activity_id, (score.get(e.activity_id) ?? 0) + 1 / (1 + ageDays));
  }
  return [...activities].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || a.code.localeCompare(b.code));
}

export function suggestValues(activityId: string, recent: RecentEntry[], defaultHours = 8): Suggestion {
  const last = recent
    .filter((e) => e.activity_id === activityId)
    .sort((a, b) => b.client_created_at.localeCompare(a.client_created_at))[0];
  return {
    quantity: last ? last.quantity : null,
    effectiveHours: last?.effective_hours ?? defaultHours,
    crewSize: last?.crew_size ?? 0,
    weather: last?.weather ?? null,
  };
}

/** Porcentaje acumulado limitado a 0–100 con un decimal. */
export function cumulativePct(executed: number, contract: number): number {
  if (contract <= 0) return 0;
  return Math.min(100, Math.round((executed / contract) * 1000) / 10);
}
