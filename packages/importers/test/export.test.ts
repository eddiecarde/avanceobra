import { describe, expect, it } from "vitest";
import { fromMsProjectXml, progressSnapshot, toMsProjectXml, toP6Rows, type ExportActivity } from "../src/index.js";

const base = (over: Partial<ExportActivity>): ExportActivity => ({
  code: "X",
  name: "X",
  unit: "und",
  contractQty: 100,
  frontCode: "BA",
  frontName: "Bloque A",
  plannedStart: "2026-10-01",
  plannedFinish: "2026-10-10",
  plannedDays: 9,
  predecessors: [],
  externalRef: null,
  ...over,
});

const acts = [
  base({ code: "BA-HIN", name: "Hincado de pilotes", unit: "pilotes", contractQty: 20, externalRef: "msp:2" }),
  base({ code: "BA-MON", name: "Montaje <trackers> & más", unit: "trackers", contractQty: 10, predecessors: ["BA-HIN"], externalRef: "msp:3" }),
  base({ code: "CS-TMT", name: "Tendido MT", unit: "m", contractQty: 500, frontCode: "CS", frontName: "Subestación" }),
];
const progress = new Map([
  ["BA-HIN", [{ date: "2026-10-02", quantity: 12 }, { date: "2026-10-05", quantity: 10 }, { date: "2026-10-08", quantity: 5 }]],
  ["BA-MON", [{ date: "2026-10-06", quantity: 4 }, { date: "2026-10-30", quantity: 4 }]],
]);

describe("avance a la fecha de corte", () => {
  const s = progressSnapshot(acts, progress, "2026-10-21");
  it("terminada, en curso y sin iniciar con fechas reales", () => {
    expect(s.map((a) => [a.code, a.status, a.actualStart, a.actualFinish, a.pct])).toEqual([
      ["BA-HIN", "completed", "2026-10-02", "2026-10-05", 1], // se completó el 5 (12 + 10 ≥ 20)
      ["BA-MON", "in_progress", "2026-10-06", null, 0.4], // lo del 30 es posterior al corte
      ["CS-TMT", "not_started", null, null, 0],
    ]);
    expect(s[0]!.executedQty).toBe(27);
  });
});

describe("MS Project XML", () => {
  const s = progressSnapshot(acts, progress, "2026-10-21");
  const xml = toMsProjectXml({ projectName: "Parque Solar Demo", cutoff: "2026-10-21", activities: s });
  it("% completado, fechas reales, fecha de estado y notas", () => {
    expect(xml).toContain("<StatusDate>2026-10-21T17:00:00</StatusDate>");
    expect(xml).toMatch(/<UID>2<\/UID>.*<PercentComplete>100<\/PercentComplete>.*<ActualStart>2026-10-02T08:00:00<\/ActualStart><ActualFinish>2026-10-05T17:00:00<\/ActualFinish>/);
    expect(xml).toMatch(/<UID>3<\/UID>.*<PercentComplete>40<\/PercentComplete>/);
    expect(xml).toContain("BA-MON: ejecutado 4 de 10 trackers al 2026-10-21");
    expect(xml).toContain("Montaje &lt;trackers&gt; &amp; más");
    expect(xml).toContain("<Duration>PT72H0M0S</Duration>");
  });
  it("ida y vuelta: nuestro importador lo lee igual (UIDs, frentes y predecesoras)", () => {
    const plan = fromMsProjectXml(xml);
    expect(plan.errors).toEqual([]);
    expect(plan.fronts.map((f) => f.name)).toEqual(["Bloque A", "Subestación"]);
    expect(plan.activities.map((a) => [a.name, a.externalRef, a.predecessors.length])).toEqual([
      ["Hincado de pilotes", "msp:2", 0],
      ["Montaje <trackers> & más", "msp:3", 1],
      ["Tendido MT", "msp:4", 0],
    ]);
  });
});

describe("Primavera P6", () => {
  it("hoja TASK con campos de P6, estado y % físico", () => {
    const t = toP6Rows(progressSnapshot(acts, progress, "2026-10-21"));
    expect(t.fields).toEqual(["task_code", "task_name", "status_code", "act_start_date", "act_end_date", "phys_complete_pct"]);
    expect(t.rows).toEqual([
      ["BA-HIN", "Hincado de pilotes", "TK_Complete", "2026-10-02", "2026-10-05", 100],
      ["BA-MON", "Montaje <trackers> & más", "TK_Active", "2026-10-06", null, 40],
      ["CS-TMT", "Tendido MT", "TK_NotStart", null, null, 0],
    ]);
  });
});
