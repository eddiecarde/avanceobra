/**
 * Calculadora de equipos necesarios, saturación del frente y cuellos de botella.
 */

export interface Saturation {
  /** Unidades que trabajan a eficiencia plena en el frente. */
  fullEfficiencyUnits?: number;
  /** Factor de eficiencia de cada unidad adicional sobre el umbral (0–1, compuesto). */
  decay?: number;
  /** Máximo físico de unidades que caben en el frente. */
  maxUnits?: number;
}

/** Eficiencia marginal de la unidad i (1-indexada). */
export function unitEfficiency(i: number, s: Saturation = {}): number {
  const full = s.fullEfficiencyUnits ?? Infinity;
  if (i <= full) return 1;
  return (s.decay ?? 1) ** (i - full);
}

/** Producción diaria total de n unidades considerando rendimientos decrecientes. */
export function crewOutput(n: number, perUnitDaily: number, s: Saturation = {}): number {
  let total = 0;
  for (let i = 1; i <= n; i++) total += perUnitDaily * unitEfficiency(i, s);
  return total;
}

export interface RequirementInput {
  pendingQty: number;
  availableDays: number;
  perUnitDaily: number;
  currentUnits: number;
  resourceName?: string;
  unit?: string;
  saturation?: Saturation;
}

export interface RequirementResult {
  requiredDailyRate: number;
  /** Unidades teóricas (sin redondear, sin saturación). */
  theoreticalUnits: number;
  /** Unidades enteras necesarias considerando saturación; null si no es alcanzable. */
  requiredUnits: number | null;
  gap: number | null;
  currentDailyOutput: number;
  message: string;
  warnings: string[];
}

export function requiredEquipment(input: RequirementInput): RequirementResult {
  const { pendingQty, availableDays, perUnitDaily, currentUnits, saturation = {} } = input;
  const name = input.resourceName ?? "unidades";
  const warnings: string[] = [];
  if (availableDays <= 0) {
    return {
      requiredDailyRate: Infinity,
      theoreticalUnits: Infinity,
      requiredUnits: null,
      gap: null,
      currentDailyOutput: crewOutput(currentUnits, perUnitDaily, saturation),
      message: "No quedan días disponibles antes de la fecha límite.",
      warnings: ["La fecha límite ya pasó o no hay días laborables: el retraso es inevitable."],
    };
  }
  const requiredDailyRate = pendingQty / availableDays;
  const theoreticalUnits = requiredDailyRate / perUnitDaily;
  const cap = saturation.maxUnits ?? 1000;
  let requiredUnits: number | null = null;
  for (let n = 0; n <= cap; n++) {
    if (crewOutput(n, perUnitDaily, saturation) >= requiredDailyRate - 1e-9) {
      requiredUnits = n;
      break;
    }
  }
  if (requiredUnits === null)
    warnings.push(
      `Ni con el máximo de ${cap} ${name} que caben en el frente se alcanza el rendimiento requerido: ` +
        `abrir otro frente, agregar turnos o renegociar plazo.`,
    );
  if (saturation.fullEfficiencyUnits !== undefined && requiredUnits !== null && requiredUnits > saturation.fullEfficiencyUnits)
    warnings.push(
      `Por encima de ${saturation.fullEfficiencyUnits} ${name} el frente se satura y cada unidad adicional rinde menos.`,
    );
  const gap = requiredUnits === null ? null : requiredUnits - currentUnits;
  const message =
    requiredUnits === null
      ? `Necesitas ${requiredDailyRate.toFixed(1)} ${input.unit ?? ""}/día y no es alcanzable en este frente.`
      : gap! > 0
        ? `Tienes ${currentUnits} ${name}, necesitas ${requiredUnits} (faltan ${gap}).`
        : `Tienes ${currentUnits} ${name}, bastan ${requiredUnits}${gap! < 0 ? ` (sobran ${-gap!})` : ""}.`;
  return {
    requiredDailyRate,
    theoreticalUnits,
    requiredUnits,
    gap,
    currentDailyOutput: crewOutput(currentUnits, perUnitDaily, saturation),
    message,
    warnings,
  };
}

export interface ChainStage {
  name: string;
  units: number;
  perUnitDaily: number;
  saturation?: Saturation;
}

export interface BottleneckResult {
  throughput: number;
  limiting: string;
  stages: { name: string; capacity: number; utilization: number }[];
  message: string;
}

/**
 * Actividades encadenadas (excavación → acarreo → compactación): la producción del
 * sistema es la del eslabón más lento.
 */
export function bottleneck(stages: ChainStage[]): BottleneckResult {
  const caps = stages.map((s) => ({ name: s.name, capacity: crewOutput(s.units, s.perUnitDaily, s.saturation) }));
  const limiting = caps.reduce((min, c) => (c.capacity < min.capacity ? c : min));
  return {
    throughput: limiting.capacity,
    limiting: limiting.name,
    stages: caps.map((c) => ({ ...c, utilization: c.capacity > 0 ? limiting.capacity / c.capacity : 0 })),
    message: `El recurso limitante es "${limiting.name}" (${limiting.capacity.toFixed(0)}/día). Agregar unidades en otros eslabones no acelera.`,
  };
}
