import { describe, expect, it } from "vitest";
import { diffImport, fromExcelRows, type ExistingActivity } from "../src/index.js";

describe("Excel con costo unitario presupuestado", () => {
  const sheet = [
    ["Frente", "Código", "Actividad", "Unidad", "Cantidad", "Costo unitario"],
    ["BA", "BA-HIN", "Hincado", "pilotes", 100, 50000],
    ["BA", "BA-EST", "Estructura", "trackers", 10, "$ 1.200.000"],
    ["BA", "BA-MOD", "Módulos", "módulos", 500, ""],
    ["BA", "BA-CAB", "Cable", "m", 300, "por definir"],
  ];

  it("lee el costo, acepta $ y puntos de miles, y avisa si no es un número", () => {
    const plan = fromExcelRows({ actividades: sheet });
    expect(plan.errors).toEqual([]);
    expect(plan.activities.map((a) => [a.code, a.budgetUnitCost])).toEqual([
      ["BA-HIN", 50000],
      ["BA-EST", 1_200_000],
      ["BA-MOD", null],
      ["BA-CAB", null],
    ]);
    expect(plan.warnings.map((w) => w.message)).toContain('BA-CAB: el costo unitario "por definir" no es un número.');
  });

  it("sin la columna no toca el costo", () => {
    const plan = fromExcelRows({ actividades: [sheet[0]!.slice(0, 5), sheet[1]!.slice(0, 5)] });
    expect("budgetUnitCost" in plan.activities[0]!).toBe(false);
  });

  it("un costo distinto en una actividad existente cuenta como cambio", () => {
    const plan = fromExcelRows({ actividades: sheet.slice(0, 2) });
    const existing: ExistingActivity[] = [
      { id: "a1", frontId: "f1", code: "BA-HIN", name: "Hincado", unit: "pilotes", contractQty: 100, plannedStart: null, plannedFinish: null, predecessorIds: [], externalRef: null, budgetUnitCost: 45000 },
    ];
    const diff = diffImport({ fronts: [{ id: "f1", code: "BA", name: "BA", maxParallel: null }], activities: existing }, plan);
    expect(diff.activities[0]!.changes).toEqual([{ field: "costo unitario", from: "45.000", to: "50.000" }]);
  });
});
