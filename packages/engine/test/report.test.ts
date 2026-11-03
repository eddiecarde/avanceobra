import { describe, expect, it } from "vitest";
import { buildDailyAnalysis, buildWeeklyAnalysis, priorityRows, reportSnapshot, type ReportActivityInput, type ReportEntryInput, type ReportInput } from "../src/report.js";

// Calendario de 7 días sin festivos: aritmética simple
const cal = {
  workdays: [1, 2, 3, 4, 5, 6, 7],
  holidays: [],
  colombianHolidays: false,
};
const act = (over: Partial<ReportActivityInput> & { id: string }): ReportActivityInput => ({
  code: over.id.toUpperCase(),
  name: `Actividad ${over.id}`,
  unit: "u",
  contractQty: 100,
  plannedStart: "2026-10-01",
  plannedFinish: "2026-10-20",
  front: "F1",
  frontName: "Frente 1",
  group: null,
  responsible: null,
  ...over,
});
const entry = (activityId: string, date: string, quantity: number, over: Partial<ReportEntryInput> = {}): ReportEntryInput => ({
  activityId,
  date,
  quantity,
  crew: 5,
  effectiveHours: 8,
  lostHours: 0,
  lossCause: "none",
  weather: "sunny",
  notes: "",
  ...over,
});
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  project: {
    id: "p",
    name: "Obra",
    startDate: "2026-10-01",
    contractEnd: "2026-10-31",
  },
  calendar: cal,
  activities: [
    // Al día: 5/día durante 20 días = 100 el 20
    act({ id: "ok" }),
    // Atrasada: 2/día
    act({ id: "late" }),
    // Avanzó al inicio y se detuvo (sin avance en 14 días) pero sin brecha grande: programada larga
    act({
      id: "stop",
      plannedStart: "2026-09-01",
      plannedFinish: "2027-06-30",
      contractQty: 1000,
    }),
    // Inicio programado ya pasó, nunca reportó, brecha pequeña
    act({
      id: "nada",
      plannedStart: "2026-10-14",
      plannedFinish: "2027-03-31",
    }),
    // Por iniciar y sin programa
    act({ id: "fut", plannedStart: "2026-11-01", plannedFinish: "2026-11-10" }),
    act({ id: "np", plannedStart: null, plannedFinish: null }),
  ],
  entries: [
    ...days(1, 15).map((d) => entry("ok", d, 5)),
    ...days(1, 15).map((d) => entry("late", d, 2, d === "2026-10-15" ? { lostHours: 3, lossCause: "weather", notes: "Lluvia" } : {})),
    entry("stop", "2026-09-20", 40),
  ],
  findings: [
    {
      id: "f1",
      type: "safety",
      severity: "critical",
      status: "open",
      description: "Zanja sin señalizar",
      createdAt: "2026-10-10",
      closedAt: null,
      dueDate: "2026-10-12",
      impeditive: true,
    },
    {
      id: "f2",
      type: "quality",
      severity: "low",
      status: "closed",
      description: "Rotulado",
      createdAt: "2026-10-14",
      closedAt: "2026-10-15",
      dueDate: null,
      impeditive: false,
    },
  ],
  ...over,
});

describe("estados del informe", () => {
  const snap = reportSnapshot(input(), "2026-10-15");
  const st = (id: string) => snap.rows.find((r) => r.id === id)!;

  it("distingue atrasada, sin avance, sin registros, por iniciar y sin programa", () => {
    expect(st("ok").status).toBe("al_dia");
    expect(st("late").status).toBe("atrasada");
    expect(st("stop").status).toBe("sin_avance");
    expect(st("nada").status).toBe("sin_registros");
    expect(st("fut").status).toBe("por_iniciar");
    expect(st("np").status).toBe("sin_programa");
  });

  it("cantidades pendientes, última actualización y recomendación", () => {
    expect(st("late").executedQty).toBe(30);
    expect(st("late").pendingQty).toBe(70);
    expect(st("late").lastUpdate).toBe("2026-10-15");
    expect(st("stop").lastUpdate).toBe("2026-09-20");
    expect(st("late").action).toMatch(/Subir el ritmo de 2 a 14 u\/día/);
    expect(st("ok").action).toBeNull();
  });

  it("prioriza lo atrasado y deja fuera lo que no requiere atención", () => {
    expect(priorityRows(snap.rows).map((r) => r.id)).toEqual(["late", "stop", "nada"]);
  });

  it("una actividad sin avance no se declara atrasada si no cumple el criterio", () => {
    expect(st("stop").gapPts).toBeGreaterThan(-15);
  });
});

describe("informe diario", () => {
  const a = buildDailyAnalysis(input(), "2026-10-15", {
    loss: { weather: "Clima" },
  });

  it("avance, desviación y conteos coherentes con las actividades", () => {
    expect(a.deviationPts).toBeCloseTo((a.actual - a.planned) * 100);
    expect(Object.values(a.snapshot.counts).reduce((s, n) => s + n, 0)).toBe(6);
    expect(a.entries).toBe(2);
    expect(a.crew).toBe(10);
    expect(a.lostHours).toBe(3);
  });

  it("producción del día por frente con el avance aportado", () => {
    expect(a.production).toHaveLength(1);
    expect(a.production[0]!.qtyByUnit).toEqual([{ unit: "u", qty: 7 }]);
    expect(a.production[0]!.gainPts).toBeGreaterThan(0);
  });

  it("situaciones con dato y acción, de la más grave a la menos", () => {
    expect(a.situations.length).toBeGreaterThan(0);
    expect(a.situations.length).toBeLessThanOrEqual(5);
    expect(a.situations[0]!.tone).toBe("critical");
    expect(a.situations.some((s) => s.title.includes("hallazgo"))).toBe(true);
    a.situations.forEach((s) => expect(s.evidence).not.toBe(""));
  });

  it("hallazgos vencidos e impeditivos a la fecha de corte", () => {
    expect(a.findings.open.map((f) => f.id)).toEqual(["f1"]);
    expect(a.findings.overdue).toBe(1);
    expect(a.findings.closed.map((f) => f.id)).toEqual(["f2"]);
  });

  it("informa los vacíos de datos en vez de rellenarlos", () => {
    expect(a.observations.some((o) => o.text.includes("sin fecha de inicio o fin programada"))).toBe(true);
  });

  it("ejecutado mayor que lo contractual se informa", () => {
    const b = buildDailyAnalysis(input({ entries: [entry("ok", "2026-10-02", 150)] }), "2026-10-15");
    expect(b.observations.some((o) => o.text.includes("ejecutado mayor"))).toBe(true);
    expect(b.snapshot.rows.find((r) => r.id === "ok")!.actualPct).toBe(1);
  });

  it("día laborable sin registros", () => {
    const b = buildDailyAnalysis(input(), "2026-10-16");
    expect(b.entries).toBe(0);
    expect(b.situations.some((s) => s.title.includes("sin registros"))).toBe(true);
  });
});

describe("informe semanal", () => {
  // Semana del lunes 12 al domingo 18 de octubre de 2026, con corte el 15 (en curso)
  const w = buildWeeklyAnalysis(input(), "2026-10-12", "2026-10-15", {
    trendWeeks: 3,
  });

  it("corte en curso y avance al inicio y al cierre", () => {
    expect(w.cutoff).toBe("2026-10-15");
    expect(w.inProgress).toBe(true);
    expect(w.gainPts).toBeCloseTo((w.actualEnd - w.actualStart) * 100);
    expect(w.actualEnd).toBeCloseTo(w.end.actual);
  });

  it("los días suman lo ganado en la semana", () => {
    const sum = w.days.filter((d) => !Number.isNaN(d.gainPts)).reduce((s, d) => s + d.gainPts, 0);
    expect(sum).toBeCloseTo(w.gainPts);
    expect(w.days.filter((d) => Number.isNaN(d.actual))).toHaveLength(3);
  });

  it("compara con la semana anterior", () => {
    expect(w.prevEntries).toBe(14);
    expect(w.entries).toBe(8);
    expect(w.prevGainPts).not.toBeNull();
  });

  it("desviaciones con causa registrada y tendencia", () => {
    const late = w.deviations.find((d) => d.row.id === "late")!;
    expect(late.causes).toEqual([{ cause: "weather", hours: 3 }]);
    expect(late.trend).toBe("empeora");
    expect(w.deviations.find((d) => d.row.id === "stop")!.causes).toEqual([]);
  });

  it("ritmo frente al necesario, del peor al mejor", () => {
    expect(w.rateVsRequired[0]!.code).toBe("LATE");
    expect(w.rateVsRequired[0]!.ratio).toBeLessThan(1);
  });

  it("tendencia de las últimas semanas", () => {
    expect(w.trend).toHaveLength(3);
    expect(w.trend.at(-1)!.weekEnd).toBe("2026-10-15");
    expect(w.trend.at(-1)!.late).toBe(w.end.counts.atrasada);
    expect(w.findings.open).toBe(1);
  });
});

describe("varias causas de pérdida en un registro", () => {
  it("el día, la semana y las desviaciones suman cada línea por su causa", () => {
    const inp = input({
      entries: [
        ...days(1, 15).map((d) => entry("ok", d, 5)),
        entry("late", "2026-10-15", 2, { lostHours: 3, lossCause: "weather", losses: [{ cause: "weather", hours: 2 }, { cause: "material", hours: 1 }] }),
      ],
    });
    const a = buildDailyAnalysis(inp, "2026-10-15");
    expect(a.lossesToday).toEqual([{ cause: "weather", hours: 2 }, { cause: "material", hours: 1 }]);
    expect(a.lostHours).toBe(3);
    const w = buildWeeklyAnalysis(inp, "2026-10-12", "2026-10-15");
    expect(w.causes.map((c) => [c.cause, c.hours])).toEqual([["weather", 2], ["material", 1]]);
    expect(w.deviations.find((d) => d.row.id === "late")!.causes).toEqual([{ cause: "weather", hours: 2 }, { cause: "material", hours: 1 }]);
  });
  it("sin detalle, una línea con las horas y la causa del registro", async () => {
    const { entryLossLines } = await import("../src/pareto.js");
    expect(entryLossLines({ lostHours: 2, lossCause: "permits" })).toEqual([{ cause: "permits", hours: 2 }]);
    expect(entryLossLines({ lostHours: 0, lossCause: "none", losses: [] })).toEqual([]);
  });
});
