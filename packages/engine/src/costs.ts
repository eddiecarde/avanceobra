/**
 * Costos de recursos, multa contractual e indirectos.
 */

export interface ContractTerms {
  /** Multa por día de retraso (monto). */
  penaltyPerDay: number;
  /** Tope total de la multa (monto). null = sin tope. */
  penaltyCap?: number | null;
  /** Bono por cada día de terminación anticipada. */
  earlyBonusPerDay?: number;
  /** Costos indirectos diarios (administración, campamento, supervisión, pólizas, equipos en espera). */
  dailyIndirectCost: number;
  /** Días de ampliación de plazo reclamables (lluvia, cambios de alcance, retrasos del cliente). */
  claimableDays?: number;
}

/** Convierte una multa expresada en % del contrato a monto. */
export function penaltyFromPercent(contractValue: number, percentPerDay: number, capPercent?: number) {
  return {
    penaltyPerDay: contractValue * percentPerDay,
    penaltyCap: capPercent === undefined ? null : contractValue * capPercent,
  };
}

/** Multa = días de retraso no reclamables × multa diaria, respetando el tope. */
export function penaltyCost(delayDays: number, terms: ContractTerms): number {
  const chargeable = Math.max(0, delayDays - (terms.claimableDays ?? 0));
  const raw = chargeable * terms.penaltyPerDay;
  return terms.penaltyCap == null ? raw : Math.min(raw, terms.penaltyCap);
}

export interface UnitCost {
  /** Costo por hora pagada: alquiler (o costo de posesión si es propio). */
  rentalPerHour: number;
  operatorPerHour?: number;
  fuelPerHour?: number;
  maintenancePerHour?: number;
  /** Horas pagadas por día (normalmente > horas efectivas). */
  paidHoursPerDay: number;
  /** Movilización + desmovilización por unidad. */
  mobilization?: number;
  /** Días mínimos de alquiler facturables. */
  minRentalDays?: number;
  /** Recargo sobre mano de obra por horas extra / turno nocturno (0.35 = 35 %). */
  laborSurcharge?: number;
}

export function unitDailyCost(c: UnitCost): number {
  const labor = (c.operatorPerHour ?? 0) * (1 + (c.laborSurcharge ?? 0));
  return (c.rentalPerHour + labor + (c.fuelPerHour ?? 0) + (c.maintenancePerHour ?? 0)) * c.paidHoursPerDay;
}

/** Costo de una unidad que trabaja `days` días (respeta el mínimo de alquiler). */
export function unitCostForDays(c: UnitCost, days: number, includeMobilization: boolean): number {
  const billable = Math.max(days, c.minRentalDays ?? 0);
  return unitDailyCost(c) * billable + (includeMobilization ? (c.mobilization ?? 0) : 0);
}

/** Valor presente de un monto pagado dentro de `days` días con tasa efectiva anual. */
export function presentValue(amount: number, days: number, annualRate: number): number {
  return amount / (1 + annualRate) ** (days / 365);
}

export function formatMoney(amount: number, currency = "COP", locale = "es-CO"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/** Formato compacto para mensajes: $151,5 M. */
export function formatMillions(amount: number): string {
  const m = Math.abs(amount) / 1_000_000;
  const text = `$${m.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
  return amount < -0.05 * 1_000_000 ? `−${text}` : text;
}
