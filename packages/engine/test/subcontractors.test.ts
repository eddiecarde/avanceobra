import { describe, expect, it } from "vitest";
import { subcontractorScores } from "../src/index.js";

const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };

describe("desempeño por subcontratista", () => {
  // Hincas SAS: 100 pilotes a $10.000 del 1 al 10 de octubre (contrato $1.000.000)
  const activities = [
    { id: "a1", companyId: "hin", contractQty: 100, unitPrice: 10_000, plannedStart: "2026-10-01", plannedFinish: "2026-10-10" },
    { id: "a2", companyId: "hin", contractQty: 5, unitPrice: null, plannedStart: "2026-10-01", plannedFinish: "2026-10-10" },
    { id: "a3", companyId: "otra", contractQty: 10, unitPrice: 1_000, plannedStart: "2026-10-01", plannedFinish: "2026-10-02" },
  ];
  const base = {
    companyIds: ["hin", "otra"],
    activities,
    approved: [{ activityId: "a1", date: "2026-10-03", quantity: 30 }, { activityId: "a3", date: "2026-10-02", quantity: 10 }],
    certificates: [
      { companyId: "hin", number: 1, periodEnd: "2026-10-02", cumulativeAmount: 100_000, retentionAmount: 5_000 },
      { companyId: "hin", number: 2, periodEnd: "2026-10-04", cumulativeAmount: 200_000, retentionAmount: 5_000 },
    ],
    findings: [
      { companyId: "hin", category: "no_conformidad", status: "open", dueDate: "2026-10-03", createdAt: "2026-10-01", closedAt: null },
      { companyId: "hin", category: "punch", status: "closed", dueDate: null, createdAt: "2026-10-01", closedAt: "2026-10-05" },
      { companyId: "hin", category: "observacion", status: "open", dueDate: "2026-10-01", createdAt: "2026-10-01", closedAt: null },
    ],
    planItems: [
      { companyId: "hin", weekStart: "2026-09-28", done: true },
      { companyId: "hin", weekStart: "2026-09-28", done: false },
      { companyId: "hin", weekStart: "2026-10-05", done: null },
    ],
    cutoff: "2026-10-05",
    calendar: cal,
  };

  it("plazo, plata, plan semanal y calidad con su semáforo", () => {
    const [hin, otra] = subcontractorScores(base);
    expect(hin).toMatchObject({
      activities: 2,
      priced: 1,
      contractValue: 1_000_000,
      executedValue: 300_000,
      plannedValue: 500_000,
      billed: 200_000,
      toBill: 100_000,
      retained: 10_000,
      lastCertificate: 2,
      ppc: 0.5,
      planItems: 2,
      ncOpen: 1,
      ncOverdue: 1,
      ncCloseDays: 4,
      status: "red",
    });
    expect(hin!.spi).toBeCloseTo(0.6);
    expect(hin!.reasons.join(" ")).toContain("Atrasado: ejecutó 60 %");
    expect(hin!.reasons.join(" ")).toContain("1 actividad(es) sin precio");
    // Todo ejecutado y nada facturado: amarillo por plata, no por plazo ni calidad
    expect(otra).toMatchObject({ executedValue: 10_000, spi: 1, status: "amber", ppc: null, ncOpen: 0, toBill: 10_000 });
    expect(otra!.reasons).toEqual(["Tiene más del 10 % del contrato ejecutado y aprobado sin facturar."]);
  });
});
