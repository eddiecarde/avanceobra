import { describe, expect, it } from "vitest";
import { earnedValue, parteCosts, summarizeDailyLogs } from "../src/index.js";

// Calendario de lunes a domingo para que las cuentas sean exactas
const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };

describe("valor ganado (EVM)", () => {
  // 100 pilotes a $10.000 programados del 1 al 10 de octubre (10 días): $1.000.000
  const activities = [
    { id: "hin", contractQty: 100, budgetUnitCost: 10_000, plannedStart: "2026-10-01", plannedFinish: "2026-10-10" },
    { id: "sin", contractQty: 50, budgetUnitCost: null, plannedStart: "2026-10-01", plannedFinish: "2026-10-10" },
  ];
  it("PV, EV, AC e índices al corte", () => {
    const r = earnedValue({
      activities,
      // 40 aprobados al día 5 (debían ser 50)
      approved: [
        { activityId: "hin", date: "2026-10-02", quantity: 20 },
        { activityId: "hin", date: "2026-10-05", quantity: 20 },
        { activityId: "sin", date: "2026-10-05", quantity: 99 },
      ],
      costs: [
        { date: "2026-10-03", amount: 300_000, source: "personal" },
        { date: "2026-10-05", amount: 200_000, source: "materiales" },
        { date: "2026-10-09", amount: 999_999, source: "otros" },
      ],
      cutoff: "2026-10-05",
      calendar: cal,
    });
    expect(r).toMatchObject({ bac: 1_000_000, budgetedActivities: 1, totalActivities: 2, pv: 500_000, ev: 400_000, ac: 500_000, sv: -100_000, cv: -100_000 });
    expect(r.spi).toBeCloseTo(0.8);
    expect(r.cpi).toBeCloseTo(0.8);
    expect(r.eac).toBeCloseTo(1_250_000);
    expect(r.etc).toBeCloseTo(750_000);
    expect(r.vac).toBeCloseTo(-250_000);
    expect(r.tcpi).toBeCloseTo(600_000 / 500_000);
    expect(r.acBySource).toMatchObject({ personal: 300_000, materiales: 200_000, otros: 0 });
    expect(r.series.at(-1)).toMatchObject({ date: "2026-10-05", pv: 500_000 });
    expect(r.readings.join(" ")).toContain("Solo 1 de 2 actividades");
    expect(r.readings.join(" ")).toContain("Atrasado (SPI 0,80) y con sobrecosto (CPI 0,80)");
  });

  it("advierte cuando el costo se ve bien solo porque se avanzó menos", () => {
    const r = earnedValue({
      activities: [activities[0]!],
      approved: [{ activityId: "hin", date: "2026-10-05", quantity: 30 }],
      costs: [{ date: "2026-10-05", amount: 250_000, source: "personal" }],
      cutoff: "2026-10-05",
      calendar: cal,
    });
    expect(r.readings[0]).toContain("se gastó menos porque se avanzó menos");
  });

  it("costo del parte: personas y equipos por su tarifa; lo que no tiene tarifa se lista", () => {
    const days = summarizeDailyLogs([
      { date: "2026-10-01", personnel: [{ role: "Oficial", qty: 4 }, { role: "Subcontratista", qty: 10 }], equipment: [{ name: "Hincadora", qty: 2 }], rain: [] },
    ]);
    const r = parteCosts(days.values(), { Oficial: 120_000 }, { Hincadora: 900_000 });
    expect(r.items).toEqual([
      { date: "2026-10-01", amount: 480_000, source: "personal" },
      { date: "2026-10-01", amount: 1_800_000, source: "equipos" },
    ]);
    expect(r.unpricedRoles).toEqual(["Subcontratista"]);
  });
});
