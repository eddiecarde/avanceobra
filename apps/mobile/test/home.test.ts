import { describe, expect, it } from "vitest";
import { homeProgress, pctText, todayTasks } from "../src/core/home";

const act = (id: string, qty: number, start: string | null, finish: string | null) => ({ id, code: id, name: id, unit: "u", contractQty: qty, plannedStart: start, plannedFinish: finish });

describe("avance en la pantalla de inicio", () => {
  it("promedia por igual lo ejecutado y lo programado al día", () => {
    const r = homeProgress([act("a", 100, "2026-10-01", "2026-10-10"), act("b", 10, "2026-10-01", "2026-10-02")], { a: 50, b: 20 }, "2026-12-01")!;
    expect(r.actual).toBeCloseTo(0.75);
    expect(r.planned).toBeCloseTo(1);
    expect(pctText(r.actual)).toBe("75 %");
  });
  it("sin actividades programadas no hay avance que mostrar", () => {
    expect(homeProgress([act("a", 100, null, null)], {}, "2026-10-22")).toBeNull();
  });
});

describe("lo que toca hoy", () => {
  const item = (activityId: string, plannedQty: number) => ({ activityId, code: activityId.toUpperCase(), name: activityId, unit: "Ud", frontId: "f", plannedQty, responsible: null });
  it("reparte lo que falta en los días que quedan y deja lo cumplido al final", () => {
    // Semana del lunes 2026-10-19; hoy jueves 22: quedan jueves, viernes y sábado
    const tasks = todayTasks(
      [item("a", 60), item("b", 10)],
      [
        { activityId: "a", workDate: "2026-10-19", quantity: 15 },
        { activityId: "a", workDate: "2026-10-12", quantity: 99 },
        { activityId: "b", workDate: "2026-10-20", quantity: 12 },
      ],
      "2026-10-19",
      "2026-10-22",
    );
    expect(tasks.map((t) => [t.activityId, t.doneQty, t.remainingQty, t.todayQty, t.done])).toEqual([
      ["a", 15, 45, 15, false],
      ["b", 12, 0, 0, true],
    ]);
  });
  it("el domingo (no hábil) pide todo lo que falta", () => {
    expect(todayTasks([item("a", 10)], [], "2026-10-19", "2026-10-25")[0]!.todayQty).toBe(10);
  });
});
