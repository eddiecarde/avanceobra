/**
 * Costos y productividad de una actividad a partir de los registros de campo: horas-hombre,
 * productividad, aprovechamiento del tiempo, rendimiento real contra el de referencia, costo real
 * estimado, costo por unidad y costo estimado para terminar.
 *
 * Costo real = mano de obra (personal × horas pagadas × costo de la hora-hombre)
 *            + equipos (costo diario asignado × días trabajados)
 *            + costos registrados que el campo no captura (materiales, subcontratos).
 */

export interface CostEntry {
  date: string;
  quantity: number;
  effectiveHours: number;
  lostHours: number;
  crewSize: number;
  status: string;
}

export interface CostInput {
  contractQty: number;
  /** Costo directo presupuestado por unidad; null si no se ha definido. */
  budgetUnitCost: number | null;
  entries: CostEntry[];
  laborCostPerHour: number;
  /** Costo diario de los equipos asignados a la actividad (con operador). */
  equipmentDailyCost: number;
  /** Materiales, subcontratos y otros costos registrados a mano. */
  otherCost: number;
  /** Rendimiento diario de referencia (biblioteca); null si no hay recursos asignados. */
  refDailyRate: number | null;
}

export interface CostControl {
  reported: number;
  approved: number;
  budget: number | null;
  /** Valor presupuestado de lo aprobado. */
  earnedApproved: number | null;
  labor: number;
  equipment: number;
  other: number;
  actual: number;
  hhProductive: number;
  hhLost: number;
  /** Cantidad por hora-hombre productiva. */
  productivity: number | null;
  /** Horas efectivas / (efectivas + perdidas). */
  utilization: number | null;
  daysWorked: number;
  realDailyRate: number | null;
  /** Rendimiento real frente al de referencia: −0,2 = rinde 20 % menos. */
  rateVariance: number | null;
  realUnitCost: number | null;
  remainingQty: number;
  /** Costo para terminar (al costo unitario real; si aún no hay, al presupuestado). */
  toComplete: number;
  /** Costo estimado al terminar. */
  atCompletion: number;
  /** Presupuesto menos costo estimado al terminar (negativo = sobrecosto). */
  variance: number | null;
  /** Índice de desempeño del costo: valor de lo ejecutado / costo real (< 1 = gasta más de lo presupuestado). */
  cpi: number | null;
}

export function costControl(i: CostInput): CostControl {
  const es = i.entries.filter((e) => e.status === "submitted" || e.status === "approved");
  const reported = es.reduce((t, e) => t + e.quantity, 0);
  const approved = es.filter((e) => e.status === "approved").reduce((t, e) => t + e.quantity, 0);
  const hhProductive = es.reduce((t, e) => t + e.crewSize * e.effectiveHours, 0);
  const hhLost = es.reduce((t, e) => t + e.crewSize * e.lostHours, 0);
  const effective = es.reduce((t, e) => t + e.effectiveHours, 0);
  const lost = es.reduce((t, e) => t + e.lostHours, 0);
  const daysWorked = new Set(es.filter((e) => e.quantity > 0 || e.effectiveHours > 0).map((e) => e.date)).size;

  const labor = (hhProductive + hhLost) * i.laborCostPerHour;
  const equipment = i.equipmentDailyCost * daysWorked;
  const actual = labor + equipment + i.otherCost;
  const unit = i.budgetUnitCost;
  const realUnitCost = reported > 0 && actual > 0 ? actual / reported : null;
  const remainingQty = Math.max(0, i.contractQty - reported);
  const toComplete = remainingQty * (realUnitCost ?? unit ?? 0);
  const atCompletion = actual + toComplete;
  const realDailyRate = daysWorked ? reported / daysWorked : null;

  return {
    reported,
    approved,
    budget: unit == null ? null : unit * i.contractQty,
    earnedApproved: unit == null ? null : unit * approved,
    labor,
    equipment,
    other: i.otherCost,
    actual,
    hhProductive,
    hhLost,
    productivity: hhProductive > 0 ? reported / hhProductive : null,
    utilization: effective + lost > 0 ? effective / (effective + lost) : null,
    daysWorked,
    realDailyRate,
    rateVariance: realDailyRate != null && i.refDailyRate ? realDailyRate / i.refDailyRate - 1 : null,
    realUnitCost,
    remainingQty,
    toComplete,
    atCompletion,
    variance: unit == null ? null : unit * i.contractQty - atCompletion,
    cpi: unit != null && actual > 0 ? (unit * reported) / actual : null,
  };
}
