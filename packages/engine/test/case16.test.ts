import { describe, expect, it } from "vitest";
import {
  analyzeAcceleration,
  compareRates,
  penaltyCost,
  referenceDailyRate,
  requiredEquipment,
  sensitivity,
} from "../src/index.js";
import { CASE16, case16Input, REAL_PER_UNIT_DAILY } from "./fixtures.js";

describe("Caso obligatorio punto 16 — movimiento de tierras", () => {
  const refPerUnit = referenceDailyRate({
    name: "Excavadora",
    unit: "m³",
    refRatePerHour: CASE16.refRatePerHour,
    effectiveHoursPerDay: CASE16.effectiveHours,
    availability: CASE16.availability,
  });

  it("paso 1: rendimiento requerido = 30.000 ÷ 40 = 750 m³/día", () => {
    const r = requiredEquipment({
      pendingQty: CASE16.pendingQty,
      availableDays: CASE16.availableDays,
      perUnitDaily: refPerUnit,
      currentUnits: CASE16.currentUnits,
    });
    expect(r.requiredDailyRate).toBe(750);
  });

  it("paso 2: rendimiento de referencia = 120 × 8 × 0,85 = 816 m³/día por excavadora", () => {
    expect(refPerUnit).toBeCloseTo(816, 6);
  });

  it("paso 3: con referencia bastaría 1 excavadora (sobran 2) → los datos son inconsistentes", () => {
    const r = requiredEquipment({
      pendingQty: CASE16.pendingQty,
      availableDays: CASE16.availableDays,
      perUnitDaily: refPerUnit,
      currentUnits: 3,
      resourceName: "excavadoras",
    });
    expect(r.requiredUnits).toBe(1);
    expect(r.gap).toBe(-2);
    expect(r.message).toBe("Tienes 3 excavadoras, bastan 1 (sobran 2).");
  });

  it("paso 4: el retraso de 20 días implica 500 m³/día reales (166,7 por excavadora, 20 % de la referencia)", () => {
    expect(REAL_PER_UNIT_DAILY * 3).toBeCloseTo(500, 6);
    const cmp = compareRates(refPerUnit, REAL_PER_UNIT_DAILY, "excavadoras");
    expect(cmp.ratio).toBeCloseTo(0.2043, 3);
    expect(cmp.warnings[0]).toMatch(/recurso limitante es otro/);
  });

  it("paso 5: con el rendimiento real se necesitan 5 excavadoras (faltan 2)", () => {
    const r = requiredEquipment({
      pendingQty: CASE16.pendingQty,
      availableDays: CASE16.availableDays,
      perUnitDaily: REAL_PER_UNIT_DAILY,
      currentUnits: 3,
      resourceName: "excavadoras",
      saturation: case16Input.saturation,
    });
    expect(r.theoreticalUnits).toBeCloseTo(4.5, 6);
    expect(r.requiredUnits).toBe(5);
    expect(r.gap).toBe(2);
    expect(r.message).toBe("Tienes 3 excavadoras, necesitas 5 (faltan 2).");
  });

  it("paso 6: multa del escenario base = 20 × $5.000.000 = $100.000.000", () => {
    expect(penaltyCost(20, { penaltyPerDay: 5_000_000, dailyIndirectCost: 0 })).toBe(100_000_000);
    // con tope del 10 % de un contrato de $800 M
    expect(penaltyCost(20, { penaltyPerDay: 5_000_000, penaltyCap: 80_000_000, dailyIndirectCost: 0 })).toBe(80_000_000);
  });

  const result = analyzeAcceleration(case16Input);

  it("paso 7: escenario base = 60 días, 20 de retraso, costo total $799 M", () => {
    expect(result.base.duration).toBe(60);
    expect(result.base.delayDays).toBe(20);
    expect(result.base.penalty).toBe(100_000_000);
    expect(result.base.total).toBeCloseTo(799_000_000, 0);
  });

  it("paso 8: curva de costo total por excavadoras adicionales", () => {
    const totals = result.points.map((p) => Math.round(p.total));
    expect(totals).toEqual([799_000_000, 669_865_000, 647_516_000, 672_112_000]);
    expect(result.points.map((p) => p.delayDays)).toEqual([20, 5, 0, 0]);
  });

  it("paso 9: costo de aceleración y punto de equilibrio en +2 excavadoras", () => {
    expect(result.best.extraUnits).toBe(2);
    expect(result.best.accelerationCost).toBeCloseTo(204_816_000, 0);
    expect(result.breakEvenExtraUnits).toBe(2);
    expect(result.breakEvenMessage).toContain("Conviene acelerar hasta 2 excavadoras adicionales");
    expect(result.breakEvenMessage).toContain("$24,6 M");
  });

  it("paso 10: recomendación final con ahorro neto de $151,5 M", () => {
    expect(-result.best.deltaVsBase).toBeCloseTo(151_484_000, 0);
    expect(result.recommendation).toContain(
      "Acelerar con 2 excavadoras adicionales cuesta $204,8 M y evita $100,0 M en multas y $88,0 M en indirectos, " +
        "además de liberar antes los equipos actuales ($168,3 M): ahorro neto $151,5 M. Recomendado.",
    );
  });

  it("paso 11: la recomendación advierte que el limitante puede no ser la excavadora", () => {
    expect(result.recommendation).toContain("confirme el recurso limitante");
    expect(result.warnings.some((w) => w.includes("20 % del de referencia"))).toBe(true);
  });

  it("formato de montos negativos", async () => {
    const { formatMillions } = await import("../src/index.js");
    expect(formatMillions(-129_135_000)).toBe("−$129,1 M");
  });

  it("si no hay indirectos ni costo de equipos actuales, conviene aceptar la multa", () => {
    const r = analyzeAcceleration({
      ...case16Input,
      includeCurrentUnitsCost: false,
      contract: { penaltyPerDay: 1_000_000, dailyIndirectCost: 0 },
    });
    expect(r.best.extraUnits).toBe(0);
    expect(r.recommendation).toMatch(/conviene aceptar 20 días de retraso/);
  });

  it("análisis de sensibilidad devuelve un resultado por caso", () => {
    const s = sensitivity(case16Input);
    expect(s).toHaveLength(4);
    expect(s[0]!.name).toBe("Rendimiento real 10 % menor");
    expect(s[0]!.baseDelay).toBeGreaterThan(20);
  });
});
