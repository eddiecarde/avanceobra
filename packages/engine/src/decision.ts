/**
 * ¿Multa o acelerar? Construye la curva costo total vs. unidades adicionales
 * (equivalente a costo total vs. días de retraso), encuentra el mínimo,
 * el punto de equilibrio marginal y redacta la recomendación.
 */
import { crewOutput, type Saturation } from "./equipment.js";
import { durationDays } from "./projection.js";
import { compareRates } from "./productivity.js";
import {
  formatMillions,
  penaltyCost,
  unitCostForDays,
  type ContractTerms,
  type UnitCost,
} from "./costs.js";

export type Origin = "real" | "estimated";

/** Un supuesto visible y editable, marcado como dato real (histórico/contrato) o estimado. */
export interface Assumption<T = number> {
  value: T;
  origin: Origin;
  note?: string;
}

export interface AccelerationInput {
  activityName: string;
  resourceName: string;
  unit: string;
  pendingQty: number;
  /** Días disponibles hasta la fecha límite (ya descontados festivos y lluvia). */
  availableDays: number;
  currentUnits: number;
  /** Rendimiento por unidad y día que se usará para proyectar (real o de referencia). */
  perUnitDaily: number;
  saturation?: Saturation;
  unitCost: UnitCost;
  contract: ContractTerms;
  quality?: {
    /** Costo diario de inspección adicional mientras haya recursos adicionales. */
    extraInspectionPerDay?: number;
    /** Reproceso esperado sobre el costo directo adicional (0.02 = 2 %). */
    expectedReworkPct?: number;
  };
  /** Considerar el costo de las unidades actuales (cambia con la duración). Por defecto true. */
  includeCurrentUnitsCost?: boolean;
  /** Máximo de unidades adicionales a evaluar. */
  maxExtraUnits?: number;
  /** Rendimiento de referencia por unidad y día, para contrastar con `perUnitDaily`. */
  referencePerUnitDaily?: number;
}

export interface ScenarioPoint {
  extraUnits: number;
  totalUnits: number;
  dailyOutput: number;
  duration: number;
  delayDays: number;
  earlyDays: number;
  currentUnitsCost: number;
  /** Costo directo de aceleración: unidades adicionales + movilización + calidad. */
  accelerationCost: number;
  qualityCost: number;
  penalty: number;
  indirect: number;
  bonus: number;
  total: number;
  deltaVsBase: number;
}

export interface AccelerationResult {
  base: ScenarioPoint;
  points: ScenarioPoint[];
  best: ScenarioPoint;
  /** Mayor número de unidades adicionales cuya última unidad todavía ahorra dinero. */
  breakEvenExtraUnits: number;
  recommendation: string;
  breakEvenMessage: string;
  warnings: string[];
}

function evaluate(input: AccelerationInput, extra: number): Omit<ScenarioPoint, "deltaVsBase"> {
  const totalUnits = input.currentUnits + extra;
  const dailyOutput = crewOutput(totalUnits, input.perUnitDaily, input.saturation);
  const duration = durationDays(input.pendingQty, dailyOutput);
  const delayDays = Math.max(0, duration - input.availableDays);
  const earlyDays = Math.max(0, input.availableDays - duration);

  const currentUnitsCost =
    input.includeCurrentUnitsCost === false ? 0 : input.currentUnits * unitCostForDays(input.unitCost, duration, false);
  const extraDirect = extra * unitCostForDays(input.unitCost, duration, true);
  const qualityCost =
    extra > 0
      ? extraDirect * (input.quality?.expectedReworkPct ?? 0) + (input.quality?.extraInspectionPerDay ?? 0) * duration
      : 0;
  const accelerationCost = extraDirect + qualityCost;
  const penalty = penaltyCost(delayDays, input.contract);
  const indirect = input.contract.dailyIndirectCost * duration;
  const bonus = (input.contract.earlyBonusPerDay ?? 0) * earlyDays;
  const total = currentUnitsCost + accelerationCost + penalty + indirect - bonus;
  return {
    extraUnits: extra,
    totalUnits,
    dailyOutput,
    duration,
    delayDays,
    earlyDays,
    currentUnitsCost,
    accelerationCost,
    qualityCost,
    penalty,
    indirect,
    bonus,
    total,
  };
}

export function analyzeAcceleration(input: AccelerationInput): AccelerationResult {
  const warnings: string[] = [];
  const maxBySpace = input.saturation?.maxUnits !== undefined ? input.saturation.maxUnits - input.currentUnits : Infinity;
  const maxExtra = Math.max(0, Math.min(input.maxExtraUnits ?? 10, maxBySpace));
  if (maxBySpace < (input.maxExtraUnits ?? 10))
    warnings.push(`El frente admite como máximo ${input.saturation!.maxUnits} ${input.resourceName}.`);

  const raw = Array.from({ length: maxExtra + 1 }, (_, n) => evaluate(input, n));
  const baseTotal = raw[0]!.total;
  const points: ScenarioPoint[] = raw.map((p) => ({ ...p, deltaVsBase: p.total - baseTotal }));
  const base = points[0]!;
  const best = points.reduce((a, b) => (b.total < a.total - 1e-6 ? b : a));

  // Punto de equilibrio marginal: se agregan unidades mientras la última ahorre
  let breakEvenExtraUnits = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.total < points[i - 1]!.total) breakEvenExtraUnits = i;
    else break;
  }

  const r = input.resourceName;
  let breakEvenMessage: string;
  if (breakEvenExtraUnits === 0) {
    breakEvenMessage = `Agregar aunque sea 1 ${r} cuesta más que lo que ahorra en multa e indirectos.`;
  } else {
    const p = points[breakEvenExtraUnits]!;
    const next = points[breakEvenExtraUnits + 1];
    breakEvenMessage =
      `Conviene acelerar hasta ${breakEvenExtraUnits} ${r} adicionales ` +
      (p.delayDays > 0 ? `(retraso de ${p.delayDays} días)` : `(sin retraso${p.earlyDays ? `, ${p.earlyDays} días de adelanto` : ""})`) +
      (next ? `; la siguiente unidad cuesta ${formatMillions(next.total - p.total)} más de lo que evita.` : ".");
  }

  let recommendation: string;
  if (best.extraUnits === 0) {
    recommendation =
      base.delayDays > 0
        ? `Acelerar cuesta más que la multa: conviene aceptar ${base.delayDays} días de retraso ` +
          `(multa ${formatMillions(base.penalty)}) y reclamar ampliación de plazo por las causales justificables.`
        : `Con los recursos actuales se cumple el plazo: no se requiere acelerar.`;
  } else {
    const avoided = base.penalty - best.penalty;
    const saving = -best.deltaVsBase;
    recommendation =
      `Acelerar con ${best.extraUnits} ${r} adicionales cuesta ${formatMillions(best.accelerationCost)} ` +
      `y evita ${formatMillions(avoided)} en multas y ${formatMillions(base.indirect - best.indirect)} en indirectos` +
      (input.includeCurrentUnitsCost === false
        ? ""
        : `, además de liberar antes los equipos actuales (${formatMillions(base.currentUnitsCost - best.currentUnitsCost)})`) +
      `: ahorro neto ${formatMillions(saving)}. Recomendado.`;
  }

  if (input.referencePerUnitDaily !== undefined) {
    const cmp = compareRates(input.referencePerUnitDaily, input.perUnitDaily, r);
    warnings.push(...cmp.warnings);
    if (cmp.ratio < 0.6 && best.extraUnits > 0)
      recommendation +=
        ` Antes de movilizar, confirme el recurso limitante: si el problema es el acarreo o la compactación, ` +
        `reforzar ese eslabón puede lograr lo mismo a menor costo.`;
  }
  if (base.delayDays === 0) warnings.push("El escenario base ya cumple el plazo.");
  warnings.push("Acelerar no exime los controles de calidad ni SST: el costo de inspección y reproceso ya está incluido.");

  return { base, points, best, breakEvenExtraUnits, recommendation, breakEvenMessage, warnings };
}

export interface SensitivityCase {
  name: string;
  apply: (i: AccelerationInput) => AccelerationInput;
}

export const DEFAULT_SENSITIVITY: SensitivityCase[] = [
  { name: "Rendimiento real 10 % menor", apply: (i) => ({ ...i, perUnitDaily: i.perUnitDaily * 0.9 }) },
  { name: "Más lluvia (−15 % de días disponibles)", apply: (i) => ({ ...i, availableDays: Math.floor(i.availableDays * 0.85) }) },
  {
    name: "Alquiler 20 % más caro",
    apply: (i) => ({ ...i, unitCost: { ...i.unitCost, rentalPerHour: i.unitCost.rentalPerHour * 1.2 } }),
  },
  {
    name: "Multa 50 % menor",
    apply: (i) => ({ ...i, contract: { ...i.contract, penaltyPerDay: i.contract.penaltyPerDay * 0.5 } }),
  },
];

export function sensitivity(input: AccelerationInput, cases: SensitivityCase[] = DEFAULT_SENSITIVITY) {
  return cases.map((c) => {
    const r = analyzeAcceleration(c.apply(input));
    return {
      name: c.name,
      bestExtraUnits: r.best.extraUnits,
      bestTotal: r.best.total,
      netSaving: -r.best.deltaVsBase,
      baseDelay: r.base.delayDays,
    };
  });
}
