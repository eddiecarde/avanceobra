/**
 * Calendario laboral: días hábiles, festivos de Colombia (Ley 51 de 1983, "Ley Emiliani")
 * y descuento por lluvia estimada. Todas las fechas se manejan como 'YYYY-MM-DD' en UTC
 * para que el resultado no dependa de la zona horaria del dispositivo.
 */

export type ISODate = string;

export interface WorkCalendar {
  /** Días ISO laborables: 1 = lunes … 7 = domingo. Por defecto lunes a sábado. */
  workdays?: number[];
  /** Festivos adicionales o personalizados. */
  holidays?: ISODate[];
  /** Incluir automáticamente los festivos nacionales de Colombia. Por defecto true. */
  colombianHolidays?: boolean;
}

const DAY_MS = 86_400_000;

export function parseDate(d: ISODate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

export function formatDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return formatDate(new Date(parseDate(d).getTime() + n * DAY_MS));
}

/** Diferencia en días calendario (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}

function isoWeekday(d: Date): number {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
}

function nextMonday(d: ISODate): ISODate {
  const wd = isoWeekday(parseDate(d));
  return wd === 1 ? d : addDays(d, 8 - wd);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Festivos nacionales de Colombia para un año. */
export function colombianHolidays(year: number): ISODate[] {
  const ymd = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;
  const fixed = [ymd(1, 1), ymd(5, 1), ymd(7, 20), ymd(8, 7), ymd(12, 8), ymd(12, 25)];
  const emiliani = [ymd(1, 6), ymd(3, 19), ymd(6, 29), ymd(8, 15), ymd(10, 12), ymd(11, 1), ymd(11, 11)].map(
    nextMonday,
  );
  const easter = easterSunday(year);
  const easterBased = [
    addDays(easter, -3), // Jueves Santo
    addDays(easter, -2), // Viernes Santo
    nextMonday(addDays(easter, 39)), // Ascensión
    nextMonday(addDays(easter, 60)), // Corpus Christi
    nextMonday(addDays(easter, 68)), // Sagrado Corazón
  ];
  return [...fixed, ...emiliani, ...easterBased].sort();
}

function buildHolidaySet(cal: WorkCalendar, fromYear: number, toYear: number): Set<ISODate> {
  const set = new Set(cal.holidays ?? []);
  if (cal.colombianHolidays !== false) {
    for (let y = fromYear; y <= toYear; y++) colombianHolidays(y).forEach((h) => set.add(h));
  }
  return set;
}

export function isWorkingDay(d: ISODate, cal: WorkCalendar = {}, holidays?: Set<ISODate>): boolean {
  const workdays = cal.workdays ?? [1, 2, 3, 4, 5, 6];
  const date = parseDate(d);
  if (!workdays.includes(isoWeekday(date))) return false;
  const set = holidays ?? buildHolidaySet(cal, date.getUTCFullYear(), date.getUTCFullYear());
  return !set.has(d);
}

/** Días laborables en el intervalo [from, to], ambos inclusive. */
export function workingDaysBetween(from: ISODate, to: ISODate, cal: WorkCalendar = {}): number {
  if (diffDays(from, to) < 0) return 0;
  // Calendarios con nombre (los de un proyecto): tabla acumulada en memoria, O(1) por consulta.
  // Los informes cuentan días para miles de actividades y varias fechas de corte.
  if (Object.keys(cal).length && diffDays(from, to) > 31) {
    let c = tables.get(cal);
    if (!c || from < c.from || to > c.to) {
      const lo = c && c.from < from ? c.from : addDays(from, -366);
      const hi = c && c.to > to ? c.to : addDays(to, 366);
      c = { from: lo, to: hi, count: countTable(cal, lo, hi) };
      tables.set(cal, c);
    }
    return c.count(from, to);
  }
  return countLoop(from, to, cal);
}

function countLoop(from: ISODate, to: ISODate, cal: WorkCalendar): number {
  const set = buildHolidaySet(cal, parseDate(from).getUTCFullYear(), parseDate(to).getUTCFullYear());
  let n = 0;
  for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) if (isWorkingDay(d, cal, set)) n++;
  return n;
}

const tables = new WeakMap<WorkCalendar, { from: ISODate; to: ISODate; count: (a: ISODate, b: ISODate) => number }>();

function countTable(cal: WorkCalendar, from: ISODate, to: ISODate) {
  const n = diffDays(from, to) + 1;
  const set = buildHolidaySet(cal, parseDate(from).getUTCFullYear(), parseDate(to).getUTCFullYear());
  const cum = new Int32Array(n + 1);
  let d = from;
  for (let i = 0; i < n; i++, d = addDays(d, 1)) cum[i + 1] = cum[i]! + (isWorkingDay(d, cal, set) ? 1 : 0);
  return (a: ISODate, b: ISODate) => cum[diffDays(from, b) + 1]! - cum[diffDays(from, a)]!;
}

/**
 * Contador de días laborables con tabla acumulada: cada consulta dentro de [from, to] cuesta O(1).
 * Lo usan los cálculos que cuentan días para miles de actividades y fechas (curva S de una planta).
 */
export function workdayCounter(cal: WorkCalendar, from: ISODate, to: ISODate): (a: ISODate, b: ISODate) => number {
  const n = Math.max(0, diffDays(from, to) + 1);
  const set = buildHolidaySet(cal, parseDate(from).getUTCFullYear(), parseDate(to).getUTCFullYear());
  const cum = new Int32Array(n + 1);
  let d = from;
  for (let i = 0; i < n; i++, d = addDays(d, 1)) cum[i + 1] = cum[i]! + (isWorkingDay(d, cal, set) ? 1 : 0);
  return (a, b) => {
    if (b < a) return 0;
    const ia = diffDays(from, a);
    const ib = diffDays(from, b);
    if (ia < 0 || ib >= n) return workingDaysBetween(a, b, cal);
    return cum[ib + 1]! - cum[ia]!;
  };
}

/**
 * Fecha en la que se completa el n-ésimo día laborable contado desde `start` (inclusive).
 * n = 1 y start laborable devuelve start.
 */
export function addWorkingDays(start: ISODate, n: number, cal: WorkCalendar = {}): ISODate {
  if (n <= 0) return start;
  const startYear = parseDate(start).getUTCFullYear();
  const set = buildHolidaySet(cal, startYear, startYear + Math.ceil(n / 200) + 1);
  let count = 0;
  let d = start;
  for (;;) {
    if (isWorkingDay(d, cal, set)) count++;
    if (count >= n) return d;
    d = addDays(d, 1);
  }
}

/**
 * Días disponibles efectivos = días laborables − días perdidos por lluvia estimada.
 * `rainLossRatio` es la fracción de días laborables que se espera perder (p. ej. 0.15).
 */
export function availableDays(from: ISODate, to: ISODate, cal: WorkCalendar = {}, rainLossRatio = 0) {
  const working = workingDaysBetween(from, to, cal);
  const rainDays = Math.round(working * rainLossRatio);
  return { workingDays: working, rainDays, available: Math.max(0, working - rainDays) };
}
