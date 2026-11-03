/**
 * Proyección de terminación con tres rendimientos (optimista, esperado, pesimista).
 */
import { addWorkingDays, diffDays, type ISODate, type WorkCalendar } from "./calendar.js";

export interface ProjectionInput {
  activityName: string;
  pendingQty: number;
  /** Rendimientos diarios del frente completo. */
  rates: { optimistic: number; expected: number; pessimistic: number };
  /** Primer día de trabajo pendiente. */
  fromDate: ISODate;
  deadline: ISODate;
  calendar?: WorkCalendar;
  rainLossRatio?: number;
}

export interface ProjectionPoint {
  dailyRate: number;
  workingDaysNeeded: number;
  finishDate: ISODate | null;
  /** Días calendario de retraso frente a la fecha límite (negativo = adelanto). */
  delayDays: number | null;
}

export interface ProjectionResult {
  optimistic: ProjectionPoint;
  expected: ProjectionPoint;
  pessimistic: ProjectionPoint;
  message: string;
}

function project(input: ProjectionInput, rate: number): ProjectionPoint {
  if (rate <= 0) return { dailyRate: rate, workingDaysNeeded: Infinity, finishDate: null, delayDays: null };
  const effectiveRate = rate * (1 - (input.rainLossRatio ?? 0));
  const days = Math.ceil(input.pendingQty / effectiveRate - 1e-9);
  const finish = addWorkingDays(input.fromDate, days, input.calendar);
  return { dailyRate: rate, workingDaysNeeded: days, finishDate: finish, delayDays: diffDays(input.deadline, finish) };
}

export function projectCompletion(input: ProjectionInput): ProjectionResult {
  const optimistic = project(input, input.rates.optimistic);
  const expected = project(input, input.rates.expected);
  const pessimistic = project(input, input.rates.pessimistic);
  let message: string;
  if (expected.finishDate === null) message = `La actividad ${input.activityName} no avanza: sin rendimiento no hay fecha de terminación.`;
  else if (expected.delayDays! > 0)
    message = `Al ritmo actual, la actividad ${input.activityName} termina el ${expected.finishDate}, con ${expected.delayDays} días de retraso.`;
  else
    message = `Al ritmo actual, la actividad ${input.activityName} termina el ${expected.finishDate}, ${-expected.delayDays!} días antes de la fecha límite.`;
  return { optimistic, expected, pessimistic, message };
}

/** Versión en días abstractos (sin calendario), útil para simulación rápida. */
export function durationDays(pendingQty: number, dailyRate: number): number {
  return dailyRate > 0 ? Math.ceil(pendingQty / dailyRate - 1e-9) : Infinity;
}
