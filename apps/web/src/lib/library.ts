import { compareRates, historicalRate, referenceDailyRate, unitDailyCost, type RateStats } from "@avanceobra/engine";

export interface Resource {
  id: string;
  org_id: string;
  name: string;
  kind: "equipment" | "crew";
  unit: string;
  ref_rate: number;
  rate_basis: "hour" | "day";
  mechanical_availability: number;
  factors: Record<string, number>;
  ownership: "own" | "rented";
  cost_per_hour: number;
  operator_cost_per_hour: number;
  fuel_cost_per_hour: number;
  maintenance_cost_per_hour: number;
  mobilization_cost: number;
  min_rental_days: number;
  notes: string | null;
  archived: boolean;
}

/** Supuestos de jornada, visibles y editables (no se esconden en el cálculo). */
export interface WorkdayAssumptions {
  effectiveHours: number;
  paidHours: number;
  shifts: number;
}

export const DEFAULT_WORKDAY: WorkdayAssumptions = { effectiveHours: 8, paidHours: 10, shifts: 1 };

/** Rendimiento diario de referencia de UNA unidad (equipo o cuadrilla) con sus factores. */
export function effectiveDaily(r: Resource, w: WorkdayAssumptions): number {
  const factors = Object.fromEntries(Object.entries(r.factors ?? {}).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
  if (r.rate_basis === "day") {
    const f = Object.values(factors).reduce((a, b) => a * b, 1);
    return Number(r.ref_rate) * Number(r.mechanical_availability) * f * w.shifts;
  }
  return referenceDailyRate({
    name: r.name,
    unit: r.unit,
    refRatePerHour: Number(r.ref_rate),
    effectiveHoursPerDay: w.effectiveHours,
    availability: Number(r.mechanical_availability),
    shifts: w.shifts,
    factors,
  });
}

export function dailyCost(r: Resource, w: WorkdayAssumptions): number {
  return unitDailyCost({
    rentalPerHour: Number(r.cost_per_hour),
    operatorPerHour: Number(r.operator_cost_per_hour),
    fuelPerHour: Number(r.fuel_cost_per_hour),
    maintenancePerHour: Number(r.maintenance_cost_per_hour),
    paidHoursPerDay: w.paidHours * w.shifts,
  });
}

/** Costo por unidad producida (p. ej. COP por pilote) con la referencia. */
export const unitCost = (r: Resource, w: WorkdayAssumptions) => {
  const d = effectiveDaily(r, w);
  return d > 0 ? dailyCost(r, w) / d : NaN;
};

export interface ActivityComparison {
  referenceDaily: number;
  real: RateStats;
  realDaily: number;
  ratio: number;
  warnings: string[];
}

/**
 * Real vs. referencia para una actividad: la referencia es la suma de sus recursos asignados;
 * el real sale de los últimos N días con avance (cantidad por día de la actividad completa).
 */
export function compareActivity(
  assigned: { resource: Resource; units: number }[],
  daily: { work_date: string; quantity: number }[],
  w: WorkdayAssumptions,
  lastNDays = 14,
): ActivityComparison {
  const referenceDaily = assigned.reduce((s, a) => s + effectiveDaily(a.resource, w) * a.units, 0);
  const real = historicalRate(
    daily.map((d) => ({ date: d.work_date, quantity: Number(d.quantity), units: 1 })),
    lastNDays,
  );
  const cmp = compareRates(referenceDaily, real.meanPerUnit, "la actividad");
  return { referenceDaily, real, realDaily: real.meanPerUnit, ratio: cmp.ratio, warnings: [...real.warnings, ...cmp.warnings] };
}

export const money = (n: number, currency = "COP") =>
  Number.isFinite(n) ? new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(n) : "—";
export const qty = (n: number, d = 1) => (Number.isFinite(n) ? n.toLocaleString("es-CO", { maximumFractionDigits: d }) : "—");
