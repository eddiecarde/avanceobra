import { describe, expect, it } from "vitest";
import {
  activityDailyOutput,
  compareScenarios,
  describePlan,
  evaluatePlan,
  optimizeCriticalPath,
  projectSensitivity,
  type ProjectSim,
  type SimActivity,
} from "../src/index.js";
import { case16Input, REAL_PER_UNIT_DAILY } from "./fixtures.js";

const excavacion: SimActivity = {
  id: "exc",
  name: "Excavación",
  unit: "m³",
  pendingQty: 30_000,
  predecessors: [],
  perUnitDaily: REAL_PER_UNIT_DAILY,
  rateSource: "real",
  currentUnits: 3,
  resourceName: "excavadoras",
  maxUnits: 6,
  saturation: case16Input.saturation,
  unitCost: case16Input.unitCost,
  maxShifts: 1,
};

const case16: ProjectSim = {
  availableDays: 40,
  activities: [excavacion],
  contract: { penaltyPerDay: 5_000_000, penaltyCap: null, dailyIndirectCost: 4_000_000, claimableDays: 5 },
  quality: { expectedReworkPct: 0.02 },
};

describe("simulador de proyecto — coincide con el caso 16", () => {
  it("base: 60 días, 20 de retraso, $799 M", () => {
    const r = evaluatePlan(case16, {});
    expect(r.projectDuration).toBe(60);
    expect(r.delayDays).toBe(20);
    expect(Math.round(r.total)).toBe(799_000_000);
  });

  it("mixto encuentra +2 excavadoras y la misma curva de costo que el análisis de una actividad", () => {
    const o = optimizeCriticalPath(case16);
    expect(o.best.plan.exc).toEqual({ extraUnits: 2, shifts: 1 });
    expect(Math.round(o.best.total)).toBe(647_516_000);
    expect(o.curve.map((p) => Math.round(p.total))).toEqual([799_000_000, 669_865_000, 647_516_000]);
    expect(o.curve.map((p) => p.delayDays)).toEqual([20, 5, 0]);
  });

  it("los 4 escenarios y la recomendación", () => {
    const c = compareScenarios(case16);
    expect(c.best).toBe("optimal");
    expect(Math.round(c.scenarios.claim.penalty)).toBe(75_000_000); // 20 − 5 días reclamables
    expect(Math.round(c.scenarios.uniform.total)).toBe(647_516_000);
    expect(c.actions).toEqual(["Excavación: +2 excavadoras"]);
    expect(c.recommendation).toContain("ahorro neto $151,5 M frente a seguir igual");
    expect(c.breakEven).toMatchObject({ delayDays: 0 });
  });
});

describe("ruta crítica con varias actividades", () => {
  const unitCost = { rentalPerHour: 200_000, paidHoursPerDay: 10, mobilization: 2_000_000 };
  const sim: ProjectSim = {
    availableDays: 30,
    activities: [
      { id: "hin", name: "Hincado", unit: "pilotes", pendingQty: 2000, predecessors: [], perUnitDaily: 100, rateSource: "real", currentUnits: 1, resourceName: "hincadoras", maxUnits: 3, unitCost },
      { id: "mon", name: "Montaje", unit: "trackers", pendingQty: 200, predecessors: ["hin"], perUnitDaily: 20, rateSource: "reference", currentUnits: 1, resourceName: "cuadrillas", maxUnits: 3, unitCost },
      { id: "zan", name: "Zanjas", unit: "m", pendingQty: 500, predecessors: [], perUnitDaily: 50, rateSource: "real", currentUnits: 1, resourceName: "retros", maxUnits: 3, unitCost },
    ],
    contract: { penaltyPerDay: 20_000_000, dailyIndirectCost: 5_000_000 },
  };

  it("la ruta crítica es hincado → montaje; zanjas tiene holgura", () => {
    const r = evaluatePlan(sim, {});
    expect(r.projectDuration).toBe(30); // 20 + 10
    expect(r.criticalPath).toEqual(["hin", "mon"]);
    expect(r.activities.find((a) => a.id === "zan")!.totalFloat).toBe(20);
  });

  it("con plazo más corto acelera solo lo crítico, nunca las zanjas", () => {
    const tight = { ...sim, availableDays: 20 };
    const c = compareScenarios(tight);
    expect(c.scenarios.optimal.plan.zan).toEqual({ extraUnits: 0, shifts: 1 });
    expect(c.scenarios.optimal.delayDays).toBe(0);
    expect(c.scenarios.optimal.total).toBeLessThan(c.scenarios.base.total);
    // Calculado a mano: hincado 3 hincadoras (7 d) + montaje 2 cuadrillas (5 d) = 12 días;
    // 46 + 22 + 20 (zanjas sin tocar) + 60 de indirectos = $148 M. Seguir acelerando ya no ahorra.
    expect(c.scenarios.optimal.projectDuration).toBe(12);
    expect(Math.round(c.scenarios.optimal.total)).toBe(148_000_000);
    // la aceleración general también toca las zanjas (gasta de más)
    expect(c.scenarios.uniform.total).toBeGreaterThan(c.scenarios.optimal.total);
  });
});

describe("turnos adicionales", () => {
  const sim: ProjectSim = {
    availableDays: 20,
    activities: [
      {
        id: "cab",
        name: "Cableado",
        unit: "m",
        pendingQty: 3000,
        predecessors: [],
        perUnitDaily: 100,
        rateSource: "real",
        currentUnits: 2,
        resourceName: "cuadrillas",
        maxUnits: 2, // el frente no admite más cuadrillas
        maxShifts: 2,
        unitCost: { rentalPerHour: 0, operatorPerHour: 150_000, paidHoursPerDay: 9 },
      },
    ],
    contract: { penaltyPerDay: 30_000_000, dailyIndirectCost: 6_000_000 },
  };

  it("el 2.º turno rinde 85 % y la mano de obra lleva recargo nocturno", () => {
    expect(activityDailyOutput(sim.activities[0]!, { extraUnits: 0, shifts: 2 })).toBeCloseTo(370, 6);
    const one = evaluatePlan(sim, {});
    const two = evaluatePlan(sim, { cab: { extraUnits: 0, shifts: 2 } });
    expect(one.projectDuration).toBe(15);
    expect(two.projectDuration).toBe(9);
    // costo del 2.º turno por cuadrilla y día = 150.000 × 1,35 × 9
    expect(two.acceleration).toBeCloseTo(2 * 150_000 * 1.35 * 9 * 9, 0);
  });

  it("si no caben más cuadrillas, el optimizador usa turnos", () => {
    const late = { ...sim, availableDays: 10 };
    const o = optimizeCriticalPath(late);
    expect(o.best.plan.cab).toEqual({ extraUnits: 0, shifts: 2 });
    expect(describePlan(late, o.best)).toEqual(["Cableado: 2 turnos"]);
  });
});

describe("cuándo conviene aceptar la multa", () => {
  it("multa baja y sin indirectos: aceptar y reclamar", () => {
    const sim: ProjectSim = { ...case16, includeCurrentUnitsCost: false, contract: { penaltyPerDay: 1_000_000, dailyIndirectCost: 0, claimableDays: 6 } };
    const c = compareScenarios(sim);
    expect(c.best).toBe("claim");
    expect(c.recommendation).toMatch(/aceptar 20 días de retraso y reclamar ampliación de plazo por 6 días/);
  });

  it("sin retraso no recomienda acelerar", () => {
    const c = compareScenarios({ ...case16, availableDays: 80 });
    expect(c.recommendation).toMatch(/no se requiere acelerar/);
  });

  it("advierte actividades sin costo o sin rendimiento", () => {
    const c = compareScenarios({
      ...case16,
      activities: [excavacion, { ...excavacion, id: "x", name: "Vallado", unitCost: null }, { ...excavacion, id: "y", name: "Pintura", perUnitDaily: 0 }],
    });
    expect(c.warnings.join(" ")).toMatch(/Vallado: sin recurso con costo/);
    expect(c.warnings.join(" ")).toMatch(/Pintura: sin rendimiento/);
    // la actividad sin rendimiento no alarga la obra al infinito
    expect(c.scenarios.base.projectDuration).toBe(60);
  });
});

describe("sensibilidad y valor del dinero", () => {
  it("una fila por caso", () => {
    const rows = projectSensitivity(case16);
    expect(rows.map((r) => r.name)).toHaveLength(5);
    expect(rows[0]!.baseDelay).toBeGreaterThan(20);
  });
  it("valor presente menor que el total nominal", () => {
    const r = evaluatePlan({ ...case16, annualDiscountRate: 0.12 }, {});
    expect(r.totalPV).toBeLessThan(r.total);
    expect(r.totalPV).toBeGreaterThan(r.total * 0.9);
  });
});
