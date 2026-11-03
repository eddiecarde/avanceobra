/**
 * Valor ganado (EVM) en dinero, a partir de lo que la obra ya registra:
 *  - PV (valor planeado): cantidad programada a la fecha × costo unitario presupuestado.
 *  - EV (valor ganado): cantidad aprobada a la fecha × costo unitario presupuestado.
 *  - AC (costo real): personal y equipos del parte diario × tarifa diaria, entregas de material ×
 *    precio, actas de subcontratistas y costos registrados a mano.
 * Con eso: SPI, CPI, SV, CV, EAC, ETC, VAC y TCPI, y su tendencia semana a semana.
 */
import { addDays, workdayCounter, type ISODate, type WorkCalendar } from "./calendar.js";
import type { DailyLogSummary } from "./dailyLog.js";

export interface EvmActivity {
  id: string;
  contractQty: number;
  /** Costo directo presupuestado por unidad; null = la actividad no entra en el valor ganado. */
  budgetUnitCost: number | null;
  plannedStart: ISODate | null;
  plannedFinish: ISODate | null;
}

export type CostSource = "personal" | "equipos" | "materiales" | "subcontratos" | "otros";

export interface CostItem {
  date: ISODate;
  amount: number;
  source: CostSource;
}

export interface EvmPoint {
  /** Corte de la semana (domingo) o la fecha de corte. */
  date: ISODate;
  pv: number;
  ev: number;
  ac: number;
  spi: number | null;
  cpi: number | null;
}

export interface EvmResult {
  /** Presupuesto a la terminación (solo actividades con costo presupuestado). */
  bac: number;
  /** Actividades con costo presupuestado sobre el total. */
  budgetedActivities: number;
  totalActivities: number;
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number | null;
  cpi: number | null;
  /** Costo estimado a la terminación: BAC ÷ CPI (si el rendimiento del costo se mantiene). */
  eac: number | null;
  /** Lo que falta por gastar: EAC − AC. */
  etc: number | null;
  /** Variación a la terminación: BAC − EAC (negativo = sobrecosto). */
  vac: number | null;
  /** CPI que hace falta en lo que queda para terminar dentro del presupuesto. */
  tcpi: number | null;
  acBySource: Record<CostSource, number>;
  series: EvmPoint[];
  /** Lecturas cruzadas en lenguaje sencillo (un indicador aislado puede engañar). */
  readings: string[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Costo diario del parte: personas por cargo × tarifa y equipos × tarifa (cargo sin tarifa = no se cuenta). */
export function parteCosts(
  days: Iterable<DailyLogSummary>,
  personnelRates: Record<string, number>,
  equipmentRates: Record<string, number>,
): { items: CostItem[]; unpricedRoles: string[]; unpricedEquipment: string[] } {
  const items: CostItem[] = [];
  const roles = new Set<string>();
  const equipment = new Set<string>();
  for (const d of days) {
    let personal = 0;
    let equipos = 0;
    for (const [role, qty] of Object.entries(d.personnel)) {
      const r = personnelRates[role];
      if (r) personal += qty * r;
      else roles.add(role);
    }
    for (const [name, qty] of Object.entries(d.equipment)) {
      const r = equipmentRates[name];
      if (r) equipos += qty * r;
      else equipment.add(name);
    }
    if (personal) items.push({ date: d.date, amount: personal, source: "personal" });
    if (equipos) items.push({ date: d.date, amount: equipos, source: "equipos" });
  }
  return { items, unpricedRoles: [...roles].sort(), unpricedEquipment: [...equipment].sort() };
}

/** Domingo de la semana de `d` (las semanas van de lunes a domingo). */
function sundayOf(d: ISODate): ISODate {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return addDays(d, dow === 0 ? 0 : 7 - dow);
}

export function earnedValue(input: {
  activities: EvmActivity[];
  /** Cantidades aprobadas por actividad y fecha. */
  approved: { activityId: string; date: ISODate; quantity: number }[];
  costs: CostItem[];
  cutoff: ISODate;
  calendar?: WorkCalendar;
  /** Semanas hacia atrás en la serie (por defecto, desde el primer dato). */
  weeks?: number;
}): EvmResult {
  const { activities, cutoff } = input;
  const cal = input.calendar ?? {};
  const budgeted = activities.filter((a) => a.budgetUnitCost != null && a.budgetUnitCost > 0 && a.contractQty > 0);
  const price = new Map(budgeted.map((a) => [a.id, a.budgetUnitCost!]));
  const bac = budgeted.reduce((t, a) => t + a.contractQty * a.budgetUnitCost!, 0);

  // Primer dato para arrancar la serie
  const firstDates = [
    ...budgeted.map((a) => a.plannedStart).filter((d): d is ISODate => !!d),
    ...input.approved.map((e) => e.date),
    ...input.costs.map((c) => c.date),
  ].filter((d) => d <= cutoff);
  const first = firstDates.length ? firstDates.reduce((a, b) => (a < b ? a : b)) : cutoff;
  const lastFinish = budgeted.reduce<ISODate>((m, a) => (a.plannedFinish && a.plannedFinish > m ? a.plannedFinish : m), cutoff);
  const count = workdayCounter(cal, first < cutoff ? first : cutoff, lastFinish);

  const pvAt = (date: ISODate) => {
    let pv = 0;
    for (const a of budgeted) {
      if (!a.plannedStart || !a.plannedFinish || date < a.plannedStart) continue;
      if (date >= a.plannedFinish) {
        pv += a.contractQty * a.budgetUnitCost!;
        continue;
      }
      const total = count(a.plannedStart, a.plannedFinish);
      pv += (total > 0 ? (a.contractQty * count(a.plannedStart, date)) / total : a.contractQty) * a.budgetUnitCost!;
    }
    return pv;
  };

  // Valor ganado y costo real por día, acumulados en orden de fecha
  const evByDate = new Map<ISODate, number>();
  for (const e of input.approved) {
    const p = price.get(e.activityId);
    if (p && e.date <= cutoff) evByDate.set(e.date, (evByDate.get(e.date) ?? 0) + e.quantity * p);
  }
  const acByDate = new Map<ISODate, number>();
  const acBySource: Record<CostSource, number> = { personal: 0, equipos: 0, materiales: 0, subcontratos: 0, otros: 0 };
  for (const c of input.costs) {
    if (c.date > cutoff) continue;
    acByDate.set(c.date, (acByDate.get(c.date) ?? 0) + c.amount);
    acBySource[c.source] += c.amount;
  }
  const cumulative = (m: Map<ISODate, number>) => {
    const dates = [...m.keys()].sort();
    let run = 0;
    const cum = dates.map((d) => (run += m.get(d)!));
    return (date: ISODate) => {
      // Último índice con fecha ≤ date (búsqueda binaria)
      let lo = 0;
      let hi = dates.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid]! <= date) (idx = mid), (lo = mid + 1);
        else hi = mid - 1;
      }
      return idx < 0 ? 0 : cum[idx]!;
    };
  };
  const evAt = cumulative(evByDate);
  const acAt = cumulative(acByDate);

  // Serie semanal (cortes de domingo) hasta la fecha de corte
  const ends: ISODate[] = [];
  for (let d = sundayOf(first); d < cutoff; d = addDays(d, 7)) ends.push(d);
  ends.push(cutoff);
  const series = (input.weeks ? ends.slice(-input.weeks) : ends).map((date) => {
    const pv = pvAt(date);
    const ev = evAt(date);
    const ac = acAt(date);
    return { date, pv, ev, ac, spi: ratio(ev, pv), cpi: ratio(ev, ac) };
  });

  const now = series.at(-1)!;
  const { pv, ev, ac } = now;
  const spi = now.spi;
  const cpi = now.cpi;
  const eac = cpi ? bac / cpi : null;
  const readings: string[] = [];
  const pctTxt = (x: number) => `${Math.round(x * 100)} %`;
  // Índices con coma decimal, como se escriben en Colombia
  const f2 = (x: number) => x.toFixed(2).replace(".", ",");
  if (bac === 0) readings.push("Sin costo presupuestado por actividad no hay valor ganado: cárgalo en Costos y productividad o en el Excel de la programación.");
  else if (budgeted.length < activities.length)
    readings.push(`Solo ${budgeted.length} de ${activities.length} actividades tienen costo presupuestado: el valor ganado no incluye las demás.`);
  if (bac > 0 && ac === 0) readings.push("Aún no hay costo real: pon tarifas al personal y equipos del parte, precios a los materiales o registra los costos.");
  if (spi != null && cpi != null) {
    if (cpi >= 1 && spi < 0.95)
      readings.push(`El costo se ve bien (CPI ${f2(cpi)}) pero el avance va atrasado (SPI ${f2(spi)}): se gastó menos porque se avanzó menos.`);
    else if (cpi < 0.95 && spi >= 1)
      readings.push(`Se va al día o adelantado (SPI ${f2(spi)}) pero gastando de más (CPI ${f2(cpi)}): revisa si se está acelerando a un costo que no compensa.`);
    else if (cpi < 0.95 && spi < 0.95)
      readings.push(`Atrasado (SPI ${f2(spi)}) y con sobrecosto (CPI ${f2(cpi)}): cada $1 gastado produce $${f2(cpi)} de obra.`);
    else if (cpi >= 0.95 && spi >= 0.95) readings.push(`Plazo y costo dentro de lo previsto (SPI ${f2(spi)}, CPI ${f2(cpi)}).`);
  }
  // Tendencia: CPI de las últimas 4 semanas
  const back = series.at(-5);
  if (back?.cpi != null && cpi != null && Math.abs(cpi - back.cpi) >= 0.05)
    readings.push(`El CPI ${cpi > back.cpi ? "mejoró" : "empeoró"} de ${f2(back.cpi)} a ${f2(cpi)} en las últimas 4 semanas.`);
  if (eac != null && bac > 0 && eac > bac * 1.02)
    readings.push(`Al ritmo de costo actual la obra costaría ${pctTxt(eac / bac - 1)} más que el presupuesto.`);

  return {
    bac,
    budgetedActivities: budgeted.length,
    totalActivities: activities.length,
    pv,
    ev,
    ac,
    sv: ev - pv,
    cv: ev - ac,
    spi,
    cpi,
    eac,
    etc: eac != null ? Math.max(0, eac - ac) : null,
    vac: eac != null ? bac - eac : null,
    tcpi: bac - ac > 0 ? (bac - ev) / (bac - ac) : null,
    acBySource,
    series,
    readings,
  };
}
