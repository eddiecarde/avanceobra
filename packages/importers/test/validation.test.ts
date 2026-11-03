import { describe, expect, it } from "vitest";
import { diffImport, validatePlan, type ExistingActivity, type ImportPlan } from "../src/index.js";

const plan = (activities: Partial<ImportPlan["activities"][number]>[]): ImportPlan =>
  validatePlan({
    source: "excel",
    projectName: null,
    fronts: [{ code: "BA", name: "Bloque A" }],
    activities: activities.map((a, i) => ({
      code: `A-${i}`,
      name: `Actividad ${i}`,
      frontCode: "BA",
      unit: "m",
      quantity: 10,
      start: null,
      finish: null,
      predecessors: [],
      externalRef: null,
      ...a,
    })) as ImportPlan["activities"],
    errors: [],
    warnings: [],
  });

describe("validación de la programación", () => {
  it("rechaza códigos inválidos y los que solo difieren en mayúsculas", () => {
    const p = plan([{ code: "BA HIN" }, { code: "ba-mon" }, { code: "BA-MON" }]);
    expect(p.errors.map((e) => e.message)).toEqual([
      "Los códigos ba-mon y BA-MON solo difieren en mayúsculas: en la obra serían el mismo.",
      "El código «BA HIN» no es válido: usa letras, números, punto, guion o barra, sin espacios (máximo 40).",
    ]);
  });

  it("avisa unidades raras, cantidad cero y posibles duplicados por nombre", () => {
    const p = plan([{ code: "Z1", unit: "mts3x" }, { code: "Z2", quantity: 0 }, { code: "Z3", name: "Zanja DC" }, { code: "Z4", name: " zanja dc" }]);
    expect(p.errors).toEqual([]);
    expect(p.warnings.map((w) => [w.where, w.message])).toEqual([
      ["Z1", "La unidad «mts3x» no es habitual: revisa que no sea un error de digitación."],
      ["Z2", "La cantidad contractual es 0: la actividad no suma avance."],
      ["Z4", "Posible duplicado: se llama igual que Z3 en el mismo frente."],
    ]);
  });
});

describe("protección de lo que ya tiene avance", () => {
  const ex = (extra: Partial<ExistingActivity>): ExistingActivity => ({
    id: "x1",
    frontId: "f1",
    code: "A-0",
    name: "Actividad 0",
    unit: "m",
    contractQty: 1000,
    plannedStart: null,
    plannedFinish: null,
    predecessorIds: [],
    externalRef: null,
    ...extra,
  });
  const existing = (a: ExistingActivity) => ({ fronts: [{ id: "f1", code: "BA", name: "Bloque A" }], activities: [a] });

  it("no cambia la unidad de una actividad con avance", () => {
    const d = diffImport(existing(ex({ executedQty: 400 })), plan([{ unit: "m3", quantity: 1000 }]));
    expect(d.activities[0]).toMatchObject({ status: "blocked" });
    expect(d.activities[0]!.problems[0]).toMatch(/Cambia la unidad \(m → m3\) y ya tiene 400 m registrados/);
  });

  it("no baja la cantidad por debajo de lo ejecutado", () => {
    const d = diffImport(existing(ex({ executedQty: 400 })), plan([{ quantity: 350 }]));
    expect(d.activities[0]!.problems).toEqual(["La cantidad nueva (350) es menor que lo ya ejecutado (400 m)."]);
    expect(d.summary.blocked).toBe(1);
  });

  it("sin avance sí se puede corregir la unidad", () => {
    const d = diffImport(existing(ex({ executedQty: 0 })), plan([{ unit: "m3" }]));
    expect(d.activities[0]).toMatchObject({ status: "update", problems: [] });
  });
});
