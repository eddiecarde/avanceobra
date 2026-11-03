import type { AccelerationInput } from "../src/index.js";

/**
 * Caso obligatorio (punto 16): movimiento de tierras.
 * Datos REALES del enunciado: 30.000 m³, 40 días, 3 excavadoras de 120 m³/h,
 * 8 h efectivas/día, 85 % disponibilidad, multa $5.000.000/día, 20 días de retraso proyectado.
 * Datos ESTIMADOS (a validar por el usuario): costos de alquiler, operador, combustible,
 * movilización, indirectos diarios, reproceso y saturación del frente.
 */
export const CASE16 = {
  pendingQty: 30_000,
  availableDays: 40,
  currentUnits: 3,
  refRatePerHour: 120,
  effectiveHours: 8,
  availability: 0.85,
  penaltyPerDay: 5_000_000,
  projectedDelayDays: 20,
} as const;

/** Rendimiento real implícito en los 20 días de retraso: 30.000 m³ en 60 días con 3 excavadoras. */
export const REAL_PER_UNIT_DAILY =
  CASE16.pendingQty / (CASE16.availableDays + CASE16.projectedDelayDays) / CASE16.currentUnits;

export const case16Input: AccelerationInput = {
  activityName: "Excavación",
  resourceName: "excavadoras",
  unit: "m³",
  pendingQty: CASE16.pendingQty,
  availableDays: CASE16.availableDays,
  currentUnits: CASE16.currentUnits,
  perUnitDaily: REAL_PER_UNIT_DAILY,
  referencePerUnitDaily: 120 * 8 * 0.85,
  saturation: { fullEfficiencyUnits: 4, decay: 0.8, maxUnits: 6 }, // estimado
  unitCost: {
    rentalPerHour: 180_000, // estimado: excavadora 20 t
    operatorPerHour: 25_000, // estimado
    fuelPerHour: 50_000, // estimado: ~4 gal/h ACPM
    paidHoursPerDay: 10, // estimado
    mobilization: 3_500_000, // estimado: cama baja ida y vuelta
  },
  contract: { penaltyPerDay: CASE16.penaltyPerDay, penaltyCap: null, dailyIndirectCost: 4_000_000 }, // indirectos: estimado
  quality: { expectedReworkPct: 0.02 }, // estimado
};
