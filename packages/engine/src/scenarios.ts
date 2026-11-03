/**
 * Simulador de escenarios a nivel de proyecto: varias actividades con dependencias (ruta
 * crítica), equipos/cuadrillas adicionales, turnos extra, saturación del frente y costos.
 *
 * Escenarios comparables lado a lado:
 *  1. base      → continuar con los recursos actuales (multa completa)
 *  2. uniform   → aceleración general: todas las actividades se aceleran en la misma proporción
 *  3. optimal   → mixto: solo la ruta crítica, buscando el menor costo total (paso a paso)
 *  4. claim     → aceptar el retraso, pagar la multa y reclamar los días justificables
 */
import { criticalPath } from "./cpm.js";
import { crewOutput, type Saturation } from "./equipment.js";
import { formatMillions, penaltyCost, presentValue, unitDailyCost, type ContractTerms, type UnitCost } from "./costs.js";

export interface SimActivity {
  id: string;
  name: string;
  unit: string;
  pendingQty: number;
  predecessors: string[];
  /** Rendimiento por unidad de recurso y por turno diurno (cantidad/día). */
  perUnitDaily: number;
  rateSource: "real" | "reference" | "manual";
  currentUnits: number;
  /** Nombre del recurso (excavadora, cuadrilla…) para los textos. */
  resourceName?: string;
  /** Máximo de unidades que caben en el frente. */
  maxUnits?: number;
  saturation?: Saturation;
  /** Sin costo no se puede acelerar (no se sabe cuánto cuesta una unidad más). */
  unitCost?: UnitCost | null;
  maxShifts?: 1 | 2 | 3;
}

export interface ShiftRules {
  /** Productividad de cada turno respecto al diurno (1.º, 2.º, 3.º). */
  productivity: [number, number, number];
  /** Recargo sobre la mano de obra en cada turno (nocturno CST: 35 %). */
  laborSurcharge: [number, number, number];
  /** Supervisión, iluminación y SST adicionales por cada turno extra y día. */
  extraShiftOverheadPerDay: number;
}

export const DEFAULT_SHIFT_RULES: ShiftRules = {
  productivity: [1, 0.85, 0.75],
  laborSurcharge: [0, 0.35, 0.35],
  extraShiftOverheadPerDay: 0,
};

export interface ProjectSim {
  /** Días laborables disponibles hasta la fecha contractual (ya sin festivos ni lluvia). */
  availableDays: number;
  activities: SimActivity[];
  contract: ContractTerms;
  quality?: { expectedReworkPct?: number; extraInspectionPerDay?: number };
  shifts?: ShiftRules;
  /** Tasa efectiva anual para el valor del dinero en el tiempo (opcional). */
  annualDiscountRate?: number | null;
  /** Incluir el costo de los recursos actuales (cambia con la duración). Por defecto true. */
  includeCurrentUnitsCost?: boolean;
}

export interface ActivityPlan {
  extraUnits: number;
  shifts: 1 | 2 | 3;
}
export type Plan = Record<string, ActivityPlan>;

export interface ActivityResult {
  id: string;
  name: string;
  plan: ActivityPlan;
  dailyOutput: number;
  duration: number;
  critical: boolean;
  totalFloat: number;
  currentCost: number;
  accelerationCost: number;
  qualityCost: number;
}

export interface PlanResult {
  plan: Plan;
  projectDuration: number;
  delayDays: number;
  earlyDays: number;
  criticalPath: string[];
  activities: ActivityResult[];
  currentResources: number;
  acceleration: number;
  quality: number;
  penalty: number;
  indirect: number;
  bonus: number;
  total: number;
  /** Total en valor presente (si hay tasa de descuento). */
  totalPV: number | null;
}

const ceilDays = (q: number, rate: number) => (q <= 0 ? 0 : rate > 0 ? Math.ceil(q / rate - 1e-9) : Infinity);
const rulesOf = (sim: ProjectSim) => sim.shifts ?? DEFAULT_SHIFT_RULES;

export function activityDailyOutput(a: SimActivity, p: ActivityPlan, rules: ShiftRules = DEFAULT_SHIFT_RULES): number {
  const base = crewOutput(a.currentUnits + p.extraUnits, a.perUnitDaily, a.saturation);
  let factor = 0;
  for (let k = 0; k < p.shifts; k++) factor += rules.productivity[k] ?? 0;
  return base * factor;
}

function shiftDayCost(c: UnitCost, k: number, rules: ShiftRules) {
  return unitDailyCost({ ...c, laborSurcharge: (c.laborSurcharge ?? 0) + (rules.laborSurcharge[k] ?? 0) });
}

function activityCosts(sim: ProjectSim, a: SimActivity, p: ActivityPlan, d: number) {
  const rules = rulesOf(sim);
  if (!a.unitCost || d === 0 || !Number.isFinite(d)) return { currentCost: 0, accelerationCost: 0, qualityCost: 0 };
  const c = a.unitCost;
  const billable = Math.max(d, c.minRentalDays ?? 0);
  const firstShift = shiftDayCost(c, 0, rules);
  let allShifts = 0;
  for (let k = 0; k < p.shifts; k++) allShifts += shiftDayCost(c, k, rules);
  const currentCost = sim.includeCurrentUnitsCost === false ? 0 : a.currentUnits * firstShift * billable;
  const extraShifts = a.currentUnits * (allShifts - firstShift) * billable;
  const extraUnits = p.extraUnits * (allShifts * billable + (c.mobilization ?? 0));
  const overhead = (p.shifts - 1) * rules.extraShiftOverheadPerDay * d;
  const accelerationCost = extraShifts + extraUnits + overhead;
  const qualityCost =
    accelerationCost > 0 ? accelerationCost * (sim.quality?.expectedReworkPct ?? 0) + (sim.quality?.extraInspectionPerDay ?? 0) * d : 0;
  return { currentCost, accelerationCost, qualityCost };
}

/** Evalúa un plan: duraciones, ruta crítica, retraso y todos los costos. */
export function evaluatePlan(sim: ProjectSim, plan: Plan, opts: { claim?: boolean } = {}): PlanResult {
  const rules = rulesOf(sim);
  const acts = sim.activities;
  const pOf = (a: SimActivity): ActivityPlan => plan[a.id] ?? { extraUnits: 0, shifts: 1 };
  const durations = new Map(acts.map((a) => [a.id, ceilDays(a.pendingQty, activityDailyOutput(a, pOf(a), rules))]));
  const ids = new Set(acts.map((a) => a.id));
  const cpm = criticalPath(
    acts.map((a) => ({
      id: a.id,
      // Sin rendimiento la duración es infinita: se excluye de la ruta crítica (compareScenarios lo advierte)
      duration: Number.isFinite(durations.get(a.id)!) ? durations.get(a.id)! : 0,
      predecessors: a.predecessors.filter((p) => ids.has(p)),
    })),
  );
  const projectDuration = cpm.projectDuration;
  const delayDays = Math.max(0, projectDuration - sim.availableDays);
  const earlyDays = Math.max(0, sim.availableDays - projectDuration);

  const activities: ActivityResult[] = acts.map((a) => {
    const d = durations.get(a.id)!;
    const node = cpm.nodes[a.id]!;
    return {
      id: a.id,
      name: a.name,
      plan: pOf(a),
      dailyOutput: activityDailyOutput(a, pOf(a), rules),
      duration: d,
      critical: node.critical && d > 0,
      totalFloat: node.totalFloat,
      ...activityCosts(sim, a, pOf(a), d),
    };
  });
  const sum = (k: "currentCost" | "accelerationCost" | "qualityCost") => activities.reduce((s, x) => s + x[k], 0);
  const penalty = penaltyCost(delayDays, { ...sim.contract, claimableDays: opts.claim ? sim.contract.claimableDays ?? 0 : 0 });
  const indirect = sim.contract.dailyIndirectCost * projectDuration;
  const bonus = (sim.contract.earlyBonusPerDay ?? 0) * earlyDays;
  const currentResources = sum("currentCost");
  const acceleration = sum("accelerationCost");
  const quality = sum("qualityCost");
  const total = currentResources + acceleration + quality + penalty + indirect - bonus;

  let totalPV: number | null = null;
  const r = sim.annualDiscountRate;
  if (r && r > 0) {
    // Recursos e indirectos se pagan a lo largo de la obra (≈ mitad); multa y bono al final.
    const mid = projectDuration / 2;
    totalPV =
      presentValue(currentResources + acceleration + quality + indirect, mid * (365 / 300), r) +
      presentValue(penalty - bonus, projectDuration * (365 / 300), r);
  }

  return {
    plan: Object.fromEntries(acts.map((a) => [a.id, pOf(a)])),
    projectDuration,
    delayDays,
    earlyDays,
    criticalPath: cpm.criticalPath.filter((id) => durations.get(id)! > 0 && Number.isFinite(durations.get(id)!)),
    activities,
    currentResources,
    acceleration,
    quality,
    penalty,
    indirect,
    bonus,
    total,
    totalPV,
  };
}

const basePlan = (sim: ProjectSim): Plan => Object.fromEntries(sim.activities.map((a) => [a.id, { extraUnits: 0, shifts: 1 as const }]));

function canAccelerate(a: SimActivity) {
  return Boolean(a.unitCost) && a.pendingQty > 0 && a.perUnitDaily > 0;
}

/** Movimientos posibles para una actividad: una unidad más o un turno más. */
function moves(a: SimActivity, p: ActivityPlan): ActivityPlan[] {
  const out: ActivityPlan[] = [];
  const maxExtra = (a.maxUnits ?? a.currentUnits + 10) - a.currentUnits;
  if (p.extraUnits < maxExtra) out.push({ ...p, extraUnits: p.extraUnits + 1 });
  if (p.shifts < (a.maxShifts ?? 1)) out.push({ ...p, shifts: (p.shifts + 1) as 2 | 3 });
  return out;
}

export interface CurvePoint {
  delayDays: number;
  projectDuration: number;
  total: number;
  /** Acción que llevó a este punto (texto). */
  step: string;
}

/**
 * Mixto: acelera solo actividades de la ruta crítica, un paso a la vez (la acción que deja
 * el menor costo total). Recorre hasta eliminar el retraso para trazar la curva costo vs.
 * días de retraso, y se queda con el punto de menor costo.
 */
export function optimizeCriticalPath(sim: ProjectSim, maxSteps = 200): { best: PlanResult; curve: CurvePoint[]; steps: PlanResult[] } {
  let plan = basePlan(sim);
  let current = evaluatePlan(sim, plan);
  const steps: PlanResult[] = [current];
  const curve: CurvePoint[] = [{ delayDays: current.delayDays, projectDuration: current.projectDuration, total: current.total, step: "Recursos actuales" }];
  const byId = new Map(sim.activities.map((a) => [a.id, a]));

  for (let i = 0; i < maxSteps; i++) {
    let bestCand: { r: PlanResult; label: string } | null = null;
    for (const id of current.criticalPath) {
      const a = byId.get(id)!;
      if (!canAccelerate(a)) continue;
      for (const m of moves(a, plan[id]!)) {
        const r = evaluatePlan(sim, { ...plan, [id]: m });
        const shorter = r.projectDuration < current.projectDuration;
        const better = !bestCand
          ? true
          : shorter && bestCand.r.projectDuration >= current.projectDuration
            ? true
            : !shorter && bestCand.r.projectDuration < current.projectDuration
              ? false
              : r.total < bestCand.r.total;
        if (better) {
          const what = m.shifts > plan[id]!.shifts ? `${m.shifts}.º turno` : `+1 ${a.resourceName ?? "unidad"}`;
          bestCand = { r, label: `${a.name}: ${what}` };
        }
      }
    }
    if (!bestCand) break;
    // Con retraso se sigue (para trazar la curva hasta eliminarlo). Sin retraso, solo si el
    // costo total baja: terminar antes ahorra indirectos (y puede ganar bono) a veces más de
    // lo que cuesta acelerar.
    if (current.delayDays === 0 && bestCand.r.total >= current.total - 1e-6) break;
    plan = bestCand.r.plan;
    current = bestCand.r;
    steps.push(current);
    if (current.projectDuration < curve[curve.length - 1]!.projectDuration || current.total < curve[curve.length - 1]!.total)
      curve.push({ delayDays: current.delayDays, projectDuration: current.projectDuration, total: current.total, step: bestCand.label });
  }
  let best = steps.reduce((a, b) => (b.total < a.total - 1e-6 ? b : a));
  best = relaxPlan(sim, best);
  return { best, curve, steps };
}

/**
 * Ajuste fino: el método paso a paso puede dejar acelerada una actividad que, tras acelerar
 * otras, quedó con holgura. Se quitan unidades o turnos mientras el costo total baje sin
 * aumentar el retraso.
 */
function relaxPlan(sim: ProjectSim, start: PlanResult): PlanResult {
  let current = start;
  let improved = true;
  while (improved) {
    improved = false;
    for (const a of sim.activities) {
      const p = current.plan[a.id];
      if (!p) continue;
      const options: ActivityPlan[] = [];
      if (p.extraUnits > 0) options.push({ ...p, extraUnits: p.extraUnits - 1 });
      if (p.shifts > 1) options.push({ ...p, shifts: (p.shifts - 1) as 1 | 2 });
      for (const o of options) {
        const r = evaluatePlan(sim, { ...current.plan, [a.id]: o });
        if (r.delayDays <= current.delayDays && r.total < current.total - 1e-6) {
          current = r;
          improved = true;
          break;
        }
      }
    }
  }
  return current;
}

/** Aceleración general: cada actividad se acelera para encoger en la misma proporción. */
export function uniformAcceleration(sim: ProjectSim): PlanResult {
  const base = evaluatePlan(sim, basePlan(sim));
  if (base.delayDays === 0) return base;
  const ratio = sim.availableDays / base.projectDuration;
  const rules = rulesOf(sim);
  const plan: Plan = basePlan(sim);
  for (const a of sim.activities) {
    if (!canAccelerate(a)) continue;
    const d0 = ceilDays(a.pendingQty, activityDailyOutput(a, plan[a.id]!, rules));
    const target = Math.max(1, Math.floor(d0 * ratio));
    let chosen: { p: ActivityPlan; cost: number; d: number } | null = null;
    const maxExtra = (a.maxUnits ?? a.currentUnits + 10) - a.currentUnits;
    for (let s = 1; s <= (a.maxShifts ?? 1); s++) {
      for (let e = 0; e <= maxExtra; e++) {
        const p: ActivityPlan = { extraUnits: e, shifts: s as 1 | 2 | 3 };
        const d = ceilDays(a.pendingQty, activityDailyOutput(a, p, rules));
        const c = activityCosts(sim, a, p, d);
        const cost = c.currentCost + c.accelerationCost + c.qualityCost;
        const ok = d <= target;
        if (!chosen || (ok && (chosen.d > target || cost < chosen.cost)) || (!ok && chosen.d > target && d < chosen.d)) chosen = { p, cost, d };
      }
    }
    if (chosen) plan[a.id] = chosen.p;
  }
  return evaluatePlan(sim, plan);
}

export type ScenarioKey = "base" | "uniform" | "optimal" | "claim";

export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  base: "Base: continuar igual",
  uniform: "Aceleración general",
  optimal: "Mixto: solo ruta crítica",
  claim: "Aceptar multa y reclamar",
};

export interface ScenarioComparison {
  scenarios: Record<ScenarioKey, PlanResult>;
  best: ScenarioKey;
  curve: CurvePoint[];
  breakEven: { delayDays: number; total: number; nextStepExtraCost: number | null } | null;
  recommendation: string;
  actions: string[];
  warnings: string[];
}

/** Acciones concretas de un plan frente al base: "Hincado: +2 hincadoras, 2.º turno". */
export function describePlan(sim: ProjectSim, r: PlanResult): string[] {
  const out: string[] = [];
  for (const a of sim.activities) {
    const p = r.plan[a.id];
    if (!p || (p.extraUnits === 0 && p.shifts === 1)) continue;
    const parts: string[] = [];
    if (p.extraUnits > 0) parts.push(`+${p.extraUnits} ${a.resourceName ?? "unidad(es)"}`);
    if (p.shifts > 1) parts.push(`${p.shifts} turnos`);
    out.push(`${a.name}: ${parts.join(", ")}`);
  }
  return out;
}

export function compareScenarios(sim: ProjectSim): ScenarioComparison {
  const warnings: string[] = [];
  for (const a of sim.activities) {
    if (a.pendingQty <= 0) continue;
    if (!(a.perUnitDaily > 0)) warnings.push(`${a.name}: sin rendimiento (ni real ni de referencia); no se puede proyectar.`);
    else if (!a.unitCost) warnings.push(`${a.name}: sin recurso con costo en la biblioteca; no se considera acelerarla.`);
  }
  const base = evaluatePlan(sim, basePlan(sim));
  const claim = evaluatePlan(sim, basePlan(sim), { claim: true });
  const uniform = uniformAcceleration(sim);
  const opt = optimizeCriticalPath(sim);
  const scenarios: Record<ScenarioKey, PlanResult> = { base, uniform, optimal: opt.best, claim };
  const order: ScenarioKey[] = ["optimal", "claim", "uniform", "base"];
  const best = order.reduce((a, b) => (scenarios[b].total < scenarios[a].total - 1e-6 ? b : a));

  // Punto de equilibrio: el mínimo de la curva y cuánto más cuesta el siguiente día ganado
  let breakEven: ScenarioComparison["breakEven"] = null;
  if (opt.curve.length > 1) {
    const minIdx = opt.curve.reduce((bi, p, i, arr) => (p.total < arr[bi]!.total ? i : bi), 0);
    const next = opt.curve[minIdx + 1];
    breakEven = { delayDays: opt.curve[minIdx]!.delayDays, total: opt.curve[minIdx]!.total, nextStepExtraCost: next ? next.total - opt.curve[minIdx]!.total : null };
  }

  const actions = describePlan(sim, opt.best);
  let recommendation: string;
  const claimDays = sim.contract.claimableDays ?? 0;
  if (base.delayDays === 0) {
    recommendation = `Con los recursos actuales la obra termina ${base.earlyDays} día(s) antes de la fecha contractual: no se requiere acelerar.`;
  } else if (best === "optimal" && actions.length) {
    const s = scenarios.optimal;
    recommendation =
      `Acelerar solo la ruta crítica (${actions.join("; ")}) cuesta ${formatMillions(s.acceleration + s.quality)} ` +
      `y evita ${formatMillions(base.penalty - s.penalty)} en multas y ${formatMillions(base.indirect - s.indirect)} en indirectos` +
      (sim.includeCurrentUnitsCost === false ? "" : `, además de liberar antes los recursos actuales`) +
      `: ahorro neto ${formatMillions(base.total - s.total)} frente a seguir igual` +
      (s.delayDays > 0 ? ` (queda un retraso de ${s.delayDays} días).` : ".") +
      " Recomendado.";
  } else if (best === "claim") {
    recommendation =
      `Acelerar cuesta más que la multa: conviene aceptar ${base.delayDays} días de retraso` +
      (claimDays > 0
        ? ` y reclamar ampliación de plazo por ${Math.min(claimDays, base.delayDays)} días justificables (lluvia, permisos o cambios del cliente): multa estimada ${formatMillions(claim.penalty)}.`
        : ` (multa ${formatMillions(base.penalty)}). Documenta las causas imputables al cliente para reclamar.`);
  } else if (best === "uniform") {
    recommendation = `La aceleración general es la opción de menor costo total (${formatMillions(uniform.total)}): ahorro ${formatMillions(base.total - uniform.total)} frente a seguir igual.`;
  } else {
    recommendation = `Ninguna aceleración evaluada mejora el costo total: continuar con los recursos actuales (retraso ${base.delayDays} días, multa ${formatMillions(base.penalty)}).`;
  }
  if (opt.best.delayDays > 0 && base.delayDays > 0 && opt.steps[opt.steps.length - 1]!.delayDays > 0)
    warnings.push("Ni acelerando al máximo (unidades y turnos permitidos) se elimina el retraso: revisa espacio del frente, turnos o un frente adicional.");
  warnings.push("Acelerar no exime los controles de calidad ni SST: el costo de inspección y reproceso ya está incluido.");

  return { scenarios, best, curve: opt.curve, breakEven, recommendation, actions, warnings };
}

export interface ProjectSensitivityRow {
  name: string;
  best: ScenarioKey;
  bestTotal: number;
  baseTotal: number;
  saving: number;
  baseDelay: number;
}

export const PROJECT_SENSITIVITY: { name: string; apply: (s: ProjectSim) => ProjectSim }[] = [
  { name: "Rendimiento real 10 % menor", apply: (s) => ({ ...s, activities: s.activities.map((a) => ({ ...a, perUnitDaily: a.perUnitDaily * 0.9 })) }) },
  { name: "Más lluvia (−15 % de días disponibles)", apply: (s) => ({ ...s, availableDays: Math.floor(s.availableDays * 0.85) }) },
  {
    name: "Alquiler 20 % más caro",
    apply: (s) => ({ ...s, activities: s.activities.map((a) => (a.unitCost ? { ...a, unitCost: { ...a.unitCost, rentalPerHour: a.unitCost.rentalPerHour * 1.2 } } : a)) }),
  },
  { name: "Multa 50 % menor", apply: (s) => ({ ...s, contract: { ...s.contract, penaltyPerDay: s.contract.penaltyPerDay * 0.5 } }) },
  { name: "Multa 50 % mayor", apply: (s) => ({ ...s, contract: { ...s.contract, penaltyPerDay: s.contract.penaltyPerDay * 1.5 } }) },
];

export function projectSensitivity(sim: ProjectSim): ProjectSensitivityRow[] {
  return PROJECT_SENSITIVITY.map((c) => {
    const r = compareScenarios(c.apply(sim));
    const best = r.scenarios[r.best];
    return { name: c.name, best: r.best, bestTotal: best.total, baseTotal: r.scenarios.base.total, saving: r.scenarios.base.total - best.total, baseDelay: r.scenarios.base.delayDays };
  });
}
