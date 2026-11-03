import { describe, expect, it } from "vitest";
import { materialStatus } from "../src/index.js";

const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };
const act = (id: string, qty: number) => ({ id, code: id, name: id, unit: "Ud", contractQty: qty, plannedStart: "2026-01-01", plannedFinish: "2026-03-01" });

describe("materiales en obra", () => {
  const mods = { id: "m", name: "Módulos", unit: "Ud", lowDays: 3 };
  // 2 actividades de módulos (1 por unidad) y pilotes (2 por mesa)
  const usage = [
    { materialId: "m", activityId: "a", factor: 1 },
    { materialId: "m", activityId: "b", factor: 1 },
  ];
  const daily = Array.from({ length: 14 }, (_, i) => ({ activityId: "a", date: `2026-02-${String(i + 1).padStart(2, "0")}`, quantity: 10 }));
  it("existencias, consumo diario y días que quedan", () => {
    const [r] = materialStatus([mods], usage, [act("a", 500), act("b", 500)], daily, [{ materialId: "m", date: "2026-01-20", quantity: 160 }], "2026-02-14", cal);
    expect(r).toMatchObject({ required: 1000, delivered: 160, consumed: 140, stock: 20, pendingDelivery: 840, pendingInstall: 860, ratePerDay: 10, daysLeft: 2, status: "low" });
    expect(r!.runOutDate).toBe("2026-02-16");
  });
  it("sin existencias con obra pendiente: agotado; si alcanza para terminar: cubierto", () => {
    const [out] = materialStatus([mods], usage, [act("a", 500), act("b", 500)], daily, [{ materialId: "m", date: "2026-01-20", quantity: 140 }], "2026-02-14", cal);
    expect(out!.status).toBe("out");
    const [cov] = materialStatus([mods], usage, [act("a", 500), act("b", 500)], daily, [{ materialId: "m", date: "2026-01-20", quantity: 1000 }], "2026-02-14", cal);
    expect(cov!.status).toBe("covered");
    expect(cov!.runOutDate).toBeNull();
  });
});
