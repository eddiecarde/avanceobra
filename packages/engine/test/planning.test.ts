import { describe, expect, it } from "vitest";
import { energizationReadiness, progressMatrix, weeklyKpi, type GroupedActivity, type SubfieldPlan } from "../src/index.js";

const act = (id: string, group: string, subfield: string | null, qty: number, finish = "2026-03-31", unit = "Ud", weight?: number): GroupedActivity => ({
  id,
  code: id,
  name: id,
  unit,
  contractQty: qty,
  plannedStart: "2026-01-01",
  plannedFinish: finish,
  weight,
  group,
  subfield,
});

describe("matriz subcampo × grupo", () => {
  it("pondera por peso dentro de cada celda y deja vacías las que no tienen actividades", () => {
    const acts = [act("h1", "Hincas", "SC01", 100, undefined, "Ud", 3), act("h2", "Hincas", "SC01", 100, undefined, "Ud", 1), act("m2", "Módulos", "SC02", 10)];
    const m = progressMatrix(acts, { h1: 100, h2: 0, m2: 5 });
    expect(m.groups).toEqual(["Hincas", "Módulos"]);
    expect(m.subfields).toEqual(["SC01", "SC02"]);
    expect(m.cells.SC01!.Hincas).toEqual({ pct: 0.75, count: 2 });
    expect(m.cells.SC01!.Módulos).toBeUndefined();
    expect(m.cells.SC02!.Módulos!.pct).toBe(0.5);
  });
});

describe("energización por circuito", () => {
  const sf = (code: string, position: SubfieldPlan["position"], order: number): SubfieldPlan => ({ code, name: code, circuit: "Circuito 07", position, order, planned: "2026-02-20", baseline: "2026-04-20" });
  it("un circuito queda listo cuando lo están sus subcampos, de cabecera a cola", () => {
    const acts = [act("a", "Hincas", "SC17", 10), act("b", "Hincas", "SC18", 10), act("c", "Módulos", "SC18", 10)];
    const r = energizationReadiness([sf("SC18", "cuerpo", 2), sf("SC17", "cabecera", 1)], acts, { a: 10, b: 10, c: 4 }, { c: "2026-03-01" }, "2026-02-10");
    const [c07] = r.circuits;
    expect(c07!.subfields.map((s) => s.code)).toEqual(["SC17", "SC18"]);
    expect(c07!.subfields[0]).toMatchObject({ ready: true, pending: 0 });
    // SC18 depende de módulos, proyectado al 1/3: 9 días después de la energización planeada
    expect(c07!.subfields[1]).toMatchObject({ ready: false, pending: 1, projectedReady: "2026-03-01", delayDays: 9 });
    expect(c07!.ready).toBe(false);
    expect(c07!.projectedReady).toBe("2026-03-01");
    expect(c07!.sets).toBe("Módulos");
  });
  it("sin ritmo en una actividad pendiente no hay fecha proyectada", () => {
    const r = energizationReadiness([sf("SC17", "cabecera", 1)], [act("a", "Hincas", "SC17", 10)], { a: 2 }, { a: null }, "2026-02-10");
    expect(r.rows[0]!.projectedReady).toBeNull();
    expect(r.rows[0]!.blockers).toEqual(["Hincas"]);
  });
});

describe("KPI semanal por grupo", () => {
  it("compara la última semana con el ritmo requerido y proyecta con el promedio de 3 semanas", () => {
    const acts = [act("h1", "Hincas", "SC01", 1000, "2026-03-31")];
    const daily = [
      { activityId: "h1", date: "2026-02-10", quantity: 100 }, // hace 2 semanas
      { activityId: "h1", date: "2026-02-17", quantity: 100 }, // semana pasada
      { activityId: "h1", date: "2026-02-24", quantity: 100 }, // última semana
    ];
    const [h] = weeklyKpi(acts, daily, "2026-02-28", 4);
    expect(h).toMatchObject({ group: "Hincas", unit: "Ud", executed: 300, remaining: 700, lastWeek: 100, avg3: 100, plannedFinish: "2026-03-31" });
    expect(h!.weeks).toEqual([0, 100, 100, 100]);
    // 700 en 31 días (4,43 semanas) → 158 por semana; la última semana rindió el 63 %
    expect(h!.requiredPerWeek).toBeCloseTo(158.06, 1);
    expect(h!.kpi).toBeCloseTo(0.633, 2);
    // Al ritmo de 100 por semana faltan 7 semanas
    expect(h!.forecastFinish).toBe("2026-04-18");
  });
  it("si el grupo mezcla unidades mide en fracción del grupo", () => {
    const acts = [act("a", "CCTV", null, 10, "2026-03-31", "Ud"), act("b", "CCTV", null, 100, "2026-03-31", "m")];
    const [g] = weeklyKpi(acts, [{ activityId: "b", date: "2026-02-27", quantity: 50 }], "2026-02-28");
    expect(g!.unit).toBeNull();
    expect(g!.executed).toBeCloseTo(0.25);
  });
});

describe("curva S con grupos de trabajo", () => {
  it("proyecta con el ritmo del grupo aunque el siguiente subcampo no haya empezado", async () => {
    const { sCurve } = await import("../src/index.js");
    const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };
    const acts = [act("sc1", "Hincas", "SC01", 100, "2026-01-10"), act("sc2", "Hincas", "SC02", 100, "2026-01-20")];
    // SC01 terminó en los últimos 10 días (10 por día); SC02 no ha empezado
    const daily = Array.from({ length: 10 }, (_, i) => ({ activityId: "sc1", date: `2026-01-${String(5 + i).padStart(2, "0")}`, quantity: 10 }));
    const base = { activities: acts, daily, from: "2026-01-01", to: "2026-01-31", today: "2026-01-14", calendar: cal };
    // Por actividad: SC02 sin ritmo y la obra no tiene fecha de fin
    expect(sCurve(base).projectedFinish).toBeNull();
    // Por grupo: el grupo avanza 100 de 200 en la ventana de 14 días → le faltan 14 días
    const g = sCurve({ ...base, groupOf: () => "Hincas" });
    expect(g.stalled).toEqual([]);
    expect(g.projectedFinish).toBe("2026-01-28");
  });
});

describe("avance del cronograma a registros diarios", () => {
  it("reparte la diferencia con lo registrado en los días laborables hasta la fecha de estado", async () => {
    const { scheduleProgressRows } = await import("../src/index.js");
    const cal = { workdays: [1, 2, 3, 4, 5], colombianHolidays: false };
    // 40 % de 100 = 40; ya había 10 registrados hasta el martes: faltan 30 de miércoles a viernes
    const rows = scheduleProgressRows(
      [{ activityId: "a", contractQty: 100, pct: 40, actualStart: "2026-02-02", actualFinish: null, executed: 10, lastRecorded: "2026-02-03" }],
      "2026-02-06",
      cal,
    );
    expect(rows).toEqual([
      { activityId: "a", date: "2026-02-04", quantity: 10 },
      { activityId: "a", date: "2026-02-05", quantity: 10 },
      { activityId: "a", date: "2026-02-06", quantity: 10 },
    ]);
    // Lo que ya está registrado (o más) no se duplica
    expect(scheduleProgressRows([{ activityId: "b", contractQty: 50, pct: 20, actualStart: null, actualFinish: null, executed: 10, lastRecorded: null }], "2026-02-06", cal)).toEqual([]);
    // Sin comienzo real: todo en la fecha de estado; terminada antes: hasta su fin real
    const r2 = scheduleProgressRows(
      [
        { activityId: "c", contractQty: 7, pct: 100, actualStart: null, actualFinish: null, executed: 0, lastRecorded: null },
        { activityId: "d", contractQty: 9, pct: 100, actualStart: "2026-02-02", actualFinish: "2026-02-04", executed: 0, lastRecorded: null },
      ],
      "2026-02-06",
      cal,
    );
    expect(r2.filter((r) => r.activityId === "c")).toEqual([{ activityId: "c", date: "2026-02-06", quantity: 7 }]);
    expect(r2.filter((r) => r.activityId === "d").map((r) => [r.date, r.quantity])).toEqual([["2026-02-02", 3], ["2026-02-03", 3], ["2026-02-04", 3]]);
  });
});

describe("plan a 3 semanas y PPC", () => {
  it("sugiere por semana lo que pide el programa y recoge lo atrasado en la primera", async () => {
    const { lookahead, mondayOf, ppc } = await import("../src/index.js");
    const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
    // 100 unidades del 1 al 100 de enero (1 por día); al 4 de enero se llevan 0 → atraso de 3
    const a = { id: "a", code: "A", name: "A", unit: "Ud", contractQty: 100, plannedStart: "2026-01-01", plannedFinish: "2026-04-10" };
    const [r] = lookahead([a], { a: 0 }, "2026-01-05", 3, cal);
    expect(r!.weeks).toEqual([11, 7, 7]);
    // Terminada o sin nada programado en las 3 semanas: no aparece
    expect(lookahead([a], { a: 100 }, "2026-01-05", 3, cal)).toEqual([]);
    expect(ppc([{ done: true }, { done: false }, { done: true }, { done: null }])).toBeCloseTo(2 / 3);
    expect(ppc([])).toBeNull();
  });
});
