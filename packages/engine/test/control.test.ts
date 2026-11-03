import { describe, expect, it } from "vitest";
import { activityControl, controlSummary, type ControlEntry, type ScheduleActivity } from "../src/index.js";

const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };
const A: ScheduleActivity = { id: "a", code: "A", name: "Zanja", unit: "m", contractQty: 1000, plannedStart: "2026-10-01", plannedFinish: "2026-10-20" };
const B: ScheduleActivity = { id: "b", code: "B", name: "Hincado", unit: "pilotes", contractQty: 100, plannedStart: "2026-10-01", plannedFinish: "2026-10-10" };

const e = (activityId: string, day: number, quantity: number, status = "approved"): ControlEntry => ({ activityId, date: `2026-10-${String(day).padStart(2, "0")}`, quantity, status });

describe("centro de control", () => {
  // El ejemplo del pedido: 1.000 m contratados, 400 ejecutados, 350 aprobados y 650 de saldo
  const entries = [e("a", 2, 200), e("a", 5, 150), e("a", 9, 50, "submitted"), e("a", 9, 30, "rejected"), e("a", 30, 99)];
  const [za] = activityControl([A], entries, "2026-10-10", cal);

  it("separa lo ejecutado de lo aprobado y calcula el saldo sobre lo aprobado", () => {
    expect(za).toMatchObject({ reported: 400, approved: 350, review: 50, balance: 650 });
    expect(za!.planned).toBe(500);
  });

  it("resume un grupo con avance ponderado, ritmo y fecha realista", () => {
    const rows = activityControl([A, B], [...entries, e("b", 2, 40)], "2026-10-10", cal);
    const s = controlSummary(rows);
    // Sin pesos, cada actividad vale la mitad
    expect(s.plannedPct).toBeCloseTo(0.5 * 0.5 + 0.5 * 1, 6);
    expect(s.executedPct).toBeCloseTo(0.5 * 0.4 + 0.5 * 0.4, 6);
    expect(s.approvedPct).toBeCloseTo(0.5 * 0.35 + 0.5 * 0.4, 6);
    expect(s.plannedFinish).toBe("2026-10-20");
    expect(s.late).toBeGreaterThan(0);
  });

  it("si una actividad con saldo no avanza, no hay fecha realista y queda marcada como parada", () => {
    const rows = activityControl([A, B], [e("a", 9, 100)], "2026-10-10", cal);
    const s = controlSummary(rows);
    expect(s.stalled).toEqual(["b"]);
    expect(s.projectedFinish).toBeNull();
  });
});
