/**
 * Backoff exponencial con jitter para la cola de archivos:
 * 5 s, 10 s, 20 s, 40 s … hasta 30 min, ±20 % aleatorio para no saturar al reconectar.
 */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const raw = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts), BACKOFF_MAX_MS);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(raw * jitter);
}

export function nextAttemptAt(now: Date, attempts: number, random?: () => number): string {
  return new Date(now.getTime() + backoffDelayMs(attempts, random)).toISOString();
}

export function isDue(nextAttempt: string | null | undefined, now: Date): boolean {
  return !nextAttempt || Date.parse(nextAttempt) <= now.getTime();
}
