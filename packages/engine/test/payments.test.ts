import { describe, expect, it } from "vitest";
import { paymentCertificate } from "../src/index.js";

const item = (id: string, contractQty: number, unitPrice: number | null, previousQty: number, cumulativeQty: number) => ({ id, code: id, name: id, unit: "Ud", contractQty, unitPrice, previousQty, cumulativeQty });

describe("acta de corte y cobro", () => {
  it("cobra lo aprobado desde la última acta, con retención y anticipo", () => {
    const r = paymentCertificate([item("hincas", 1000, 50_000, 200, 500), item("modulos", 100, 20_000, 0, 10)], { retentionPct: 0.05, advancePct: 0.1 });
    const [h, m] = r.lines;
    expect(h).toMatchObject({ periodQty: 300, periodAmount: 15_000_000, cumulativeAmount: 25_000_000, balanceAmount: 25_000_000, exceeds: false });
    expect(m!.periodAmount).toBe(200_000);
    expect(r.totals).toMatchObject({
      contractAmount: 52_000_000,
      previousAmount: 10_000_000,
      periodAmount: 15_200_000,
      cumulativeAmount: 25_200_000,
      retentionAmount: 760_000,
      advanceAmount: 1_520_000,
      netAmount: 12_920_000,
    });
    expect(r.totals.financialProgress).toBeCloseTo(25.2 / 52);
  });
  it("una corrección a la baja se descuenta y lo que pasa del contrato se marca", () => {
    const r = paymentCertificate([item("a", 10, 1000, 8, 6), item("b", 10, 1000, 10, 12)]);
    expect(r.lines[0]!.periodAmount).toBe(-2000);
    expect(r.lines[1]!.exceeds).toBe(true);
  });
  it("los ítems sin precio no entran y se avisan", () => {
    const r = paymentCertificate([item("a", 10, null, 0, 5), item("b", 10, 100, 0, 5)]);
    expect(r.missingPrice).toEqual(["a"]);
    expect(r.lines.map((l) => l.id)).toEqual(["b"]);
  });
});

describe("acta con AIU e IVA", () => {
  const items = [item("hincas", 1000, 100_000, 0, 100)]; // costo directo del periodo: 10.000.000
  it("AIU sobre el costo directo e IVA solo sobre la utilidad; retención y anticipo antes de IVA", () => {
    const t = paymentCertificate(items, { adminPct: 0.1, contingencyPct: 0.05, utilityPct: 0.05, vatMode: "utility", vatPct: 0.19, retentionPct: 0.05, advancePct: 0.1 }).totals;
    expect(t).toMatchObject({
      periodAmount: 10_000_000,
      adminAmount: 1_000_000,
      contingencyAmount: 500_000,
      utilityAmount: 500_000,
      subtotalAmount: 12_000_000,
      vatAmount: 95_000,
      grossAmount: 12_095_000,
      retentionAmount: 600_000,
      advanceAmount: 1_200_000,
      netAmount: 10_295_000,
    });
  });
  it("IVA pleno sobre el total y, sin AIU ni IVA, el acta vale el costo directo", () => {
    expect(paymentCertificate(items, { vatMode: "full", vatPct: 0.19 }).totals.grossAmount).toBe(11_900_000);
    const plain = paymentCertificate(items).totals;
    expect([plain.subtotalAmount, plain.vatAmount, plain.grossAmount, plain.netAmount]).toEqual([10_000_000, 0, 10_000_000, 10_000_000]);
  });
});
