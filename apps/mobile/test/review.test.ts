import { describe, expect, it } from "vitest";
import { reviewFlags, reviewOrder } from "../src/core/review";

const base = { id: "e", work_date: "2026-10-28", quantity: 10, contract_qty: 100, executed_before: 50, elements: 0, photos: 2, has_gps: true, unit: "pilotes" };

describe("bandeja de aprobación", () => {
  it("un registro normal no tiene señales", () => {
    expect(reviewFlags(base, "2026-10-28", [9, 10, 11])).toEqual([]);
  });
  it("señala lo que conviene mirar antes de aprobar", () => {
    const f = reviewFlags({ ...base, photos: 0, has_gps: false, quantity: 60, elements: 40, work_date: "2026-10-20" }, "2026-10-28", [9, 10, 11]);
    expect(f).toEqual([
      "Sin foto",
      "Sin ubicación GPS",
      "Supera el saldo del contrato (quedaban 50 pilotes)",
      "No cuadra con lo marcado en el plano (40)",
      "Muy por encima de lo usual (normalmente 10 pilotes)",
      "Registro de hace 8 días",
    ]);
  });
  it("con pocos registros previos no juzga lo usual", () => {
    expect(reviewFlags({ ...base, quantity: 40 }, "2026-10-28", [5])).toEqual([]);
  });
  it("primero los que tienen señales, luego los más antiguos", () => {
    const xs = [
      { id: "a", work_date: "2026-10-27", flags: [] },
      { id: "b", work_date: "2026-10-28", flags: ["Sin foto"] },
      { id: "c", work_date: "2026-10-25", flags: [] },
    ];
    expect(reviewOrder(xs).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});
