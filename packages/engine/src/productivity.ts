/**
 * Rendimientos: de referencia (catálogo × factores) y real (histórico de la app).
 * Regla de transparencia: cada rendimiento lleva su origen ("reference" o "historical")
 * y una bandera de confiabilidad.
 */

export interface ResourceSpec {
  name: string;
  unit: string;
  /** Rendimiento de referencia por hora efectiva de trabajo (p. ej. m³/h). */
  refRatePerHour: number;
  effectiveHoursPerDay: number;
  /** Disponibilidad mecánica 0–1 (equipos). Para cuadrillas usar 1. */
  availability?: number;
  /** Turnos por día (1, 2 o 3). */
  shifts?: number;
  /** Factores multiplicativos de ajuste (esponjamiento, suelo, clima, curva de aprendizaje…). */
  factors?: Record<string, number>;
}

/** Rendimiento diario de referencia de UNA unidad de recurso. */
export function referenceDailyRate(r: ResourceSpec): number {
  const factor = Object.values(r.factors ?? {}).reduce((acc, f) => acc * f, 1);
  return r.refRatePerHour * r.effectiveHoursPerDay * (r.availability ?? 1) * (r.shifts ?? 1) * factor;
}

export interface DailyRecord {
  date: string;
  quantity: number;
  /** Unidades de recurso que trabajaron ese día (equipos o cuadrillas). */
  units: number;
}

export interface RateStats {
  source: "historical";
  /** Rendimiento medio por unidad de recurso y día. */
  meanPerUnit: number;
  /** Percentil 20 (pesimista) y 80 (optimista) por unidad y día. */
  p20PerUnit: number;
  p80PerUnit: number;
  samples: number;
  coefficientOfVariation: number;
  reliable: boolean;
  warnings: string[];
}

export const MIN_SAMPLES_FOR_RELIABLE = 7;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Rendimiento real a partir de los registros diarios (ignora días sin recursos). */
export function historicalRate(records: DailyRecord[], lastNDays?: number): RateStats {
  const valid = records.filter((r) => r.units > 0).sort((a, b) => a.date.localeCompare(b.date));
  const window = lastNDays ? valid.slice(-lastNDays) : valid;
  const perUnit = window.map((r) => r.quantity / r.units);
  const n = perUnit.length;
  const mean = n ? perUnit.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n > 1 ? perUnit.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const sorted = [...perUnit].sort((a, b) => a - b);
  const warnings: string[] = [];
  if (n < MIN_SAMPLES_FOR_RELIABLE)
    warnings.push(
      `Solo hay ${n} días con datos (mínimo recomendado ${MIN_SAMPLES_FOR_RELIABLE}): la proyección es poco confiable.`,
    );
  if (cv > 0.5) warnings.push("El rendimiento diario es muy variable (CV > 50 %): revise causas de pérdida.");
  return {
    source: "historical",
    meanPerUnit: mean,
    p20PerUnit: percentile(sorted, 0.2),
    p80PerUnit: percentile(sorted, 0.8),
    samples: n,
    coefficientOfVariation: cv,
    reliable: n >= MIN_SAMPLES_FOR_RELIABLE && cv <= 0.5,
    warnings,
  };
}

export interface RateComparison {
  referencePerUnit: number;
  realPerUnit: number;
  ratio: number;
  warnings: string[];
}

/**
 * Contrasta el rendimiento real contra el de referencia. Un real muy por debajo
 * (< 60 %) suele indicar que el recurso limitante es OTRO (acarreo, compactación,
 * permisos) y no conviene comprar más de este recurso sin revisar la cadena.
 */
export function compareRates(referencePerUnit: number, realPerUnit: number, resourceName = "el recurso"): RateComparison {
  const ratio = referencePerUnit > 0 ? realPerUnit / referencePerUnit : 0;
  const warnings: string[] = [];
  if (ratio < 0.6)
    warnings.push(
      `El rendimiento real de ${resourceName} es ${(ratio * 100).toFixed(0)} % del de referencia. ` +
        `Probablemente el recurso limitante es otro (acarreo/volquetas, compactación, frente de trabajo o permisos): ` +
        `revise la cadena antes de agregar más unidades de ${resourceName}.`,
    );
  else if (ratio > 1.3)
    warnings.push(`El rendimiento real supera en ${((ratio - 1) * 100).toFixed(0)} % la referencia: verifique las cantidades reportadas.`);
  return { referencePerUnit, realPerUnit, ratio, warnings };
}
