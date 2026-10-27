import { describe, expect, it } from "vitest";
import { contractSettlement } from "../src/index.js";

describe("acta de liquidación final", () => {
  it("valor final con adicionales, pendiente por facturar, retención a devolver y anticipo por amortizar", () => {
    const t = contractSettlement({
      // 110 pilotes a $100.000 (100 del contrato + 10 adicionales); ejecutados 105
      lines: [
        { contractQty: 110, unitPrice: 100_000, approvedQty: 105 },
        { contractQty: 5, unitPrice: null, approvedQty: 5 },
      ],
      certificates: [
        { number: 1, cumulativeAmount: 5_000_000, retentionAmount: 250_000, advanceAmount: 500_000, netAmount: 4_250_000 },
        { number: 2, cumulativeAmount: 9_000_000, retentionAmount: 200_000, advanceAmount: 400_000, netAmount: 3_400_000 },
      ],
      changeOrdersAmount: 1_000_000,
      advanceGiven: 2_000_000,
    });
    expect(t).toMatchObject({
      initialValue: 10_000_000,
      finalValue: 11_000_000,
      executedValue: 10_500_000,
      notExecuted: 500_000,
      billedDirect: 9_000_000,
      pendingDirect: 1_500_000,
      pendingGross: 1_500_000,
      retentionToReturn: 450_000,
      advanceAmortized: 900_000,
      advancePending: 1_100_000,
      paidNet: 7_650_000,
      balance: 850_000,
      totalPaid: 10_500_000,
    });
  });

  it("lo pendiente lleva el AIU y el IVA del contrato", () => {
    const t = contractSettlement({
      lines: [{ contractQty: 10, unitPrice: 100_000, approvedQty: 10 }],
      certificates: [],
      changeOrdersAmount: 0,
      advanceGiven: 0,
      terms: { adminPct: 0.1, contingencyPct: 0.05, utilityPct: 0.05, vatMode: "utility", vatPct: 0.19 },
    });
    expect(t).toMatchObject({ pendingDirect: 1_000_000, pendingAiu: 200_000, pendingVat: 9_500, pendingGross: 1_209_500, balance: 1_209_500 });
  });
});
