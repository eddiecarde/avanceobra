import { describe, expect, it } from "vitest";
import { costControl, type CostEntry } from "../src/index.js";

const day = (d: number, quantity: number, extra: Partial<CostEntry> = {}): CostEntry => ({
  date: `2026-10-${String(d).padStart(2, "0")}`,
  quantity,
  effectiveHours: 8,
  lostHours: 0,
  crewSize: 5,
  status: "approved",
  ...extra,
});

describe("costos y productividad", () => {
  // 1.000 m de zanja a $20.000/m presupuestados; 4 días con 5 personas, $15.000 la hora-hombre,
  // excavadora a $1.200.000/día, $2.000.000 en materiales
  const c = costControl({
    contractQty: 1000,
    budgetUnitCost: 20000,
    entries: [day(1, 100), day(2, 100), day(3, 60, { lostHours: 2 }), day(4, 40, { status: "submitted" }), day(5, 99, { status: "rejected" })],
    laborCostPerHour: 15000,
    equipmentDailyCost: 1_200_000,
    otherCost: 2_000_000,
    refDailyRate: 100,
  });

  it("horas-hombre, productividad y aprovechamiento", () => {
    expect(c).toMatchObject({ reported: 300, approved: 260, hhProductive: 160, hhLost: 10, daysWorked: 4 });
    expect(c.productivity).toBeCloseTo(300 / 160, 6);
    expect(c.utilization).toBeCloseTo(32 / 34, 6);
    expect(c.rateVariance).toBeCloseTo(-0.25, 6);
  });

  it("costo real, por unidad y estimado al terminar", () => {
    expect(c.labor).toBe(170 * 15000);
    expect(c.equipment).toBe(4 * 1_200_000);
    expect(c.actual).toBe(2_550_000 + 4_800_000 + 2_000_000);
    expect(c.realUnitCost).toBeCloseTo(9_350_000 / 300, 6);
    expect(c.atCompletion).toBeCloseTo(9_350_000 + 700 * (9_350_000 / 300), 4);
    expect(c.budget).toBe(20_000_000);
    expect(c.variance).toBeCloseTo(20_000_000 - c.atCompletion, 4);
    expect(c.cpi).toBeCloseTo((20000 * 300) / 9_350_000, 6);
    expect(c.earnedApproved).toBe(260 * 20000);
  });

  it("sin presupuesto ni avance no inventa cifras", () => {
    const z = costControl({ contractQty: 50, budgetUnitCost: null, entries: [], laborCostPerHour: 0, equipmentDailyCost: 0, otherCost: 0, refDailyRate: null });
    expect(z).toMatchObject({ budget: null, variance: null, cpi: null, productivity: null, realUnitCost: null, toComplete: 0 });
  });
});
