import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  bottleneck,
  claimableDays,
  colombianHolidays,
  criticalPath,
  easterSunday,
  findingAlerts,
  fitAffine,
  historicalRate,
  imageCorners,
  pointResiduals,
  lossPareto,
  pareto,
  pixelToGeo,
  polygonAreaM2,
  projectCompletion,
  rateAlert,
  rectangle,
  staleSyncAlert,
  workingDaysBetween,
  zoneStatus,
} from "../src/index.js";

describe("calendario", () => {
  it("Pascua 2026 es el 5 de abril", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
  });

  it("festivos de Colombia 2026 (18, con Ley Emiliani)", () => {
    expect(colombianHolidays(2026)).toEqual([
      "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01",
      "2026-05-18", "2026-06-08", "2026-06-15", "2026-06-29", "2026-07-20", "2026-08-07",
      "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
    ]);
  });

  it("días laborables lunes–sábado descontando festivos", () => {
    // Octubre 2026: 31 días, 4 domingos, festivo lunes 12
    expect(workingDaysBetween("2026-10-01", "2026-10-31")).toBe(26);
    expect(workingDaysBetween("2026-10-01", "2026-10-31", { colombianHolidays: false })).toBe(27);
  });

  it("sumar días laborables salta domingos y festivos", () => {
    // sáb 10 → (dom 11, festivo lun 12) → mar 13
    expect(addWorkingDays("2026-10-10", 2)).toBe("2026-10-13");
  });
});

describe("rendimiento histórico", () => {
  it("advierte con pocos datos", () => {
    const s = historicalRate([
      { date: "2026-10-01", quantity: 500, units: 3 },
      { date: "2026-10-02", quantity: 0, units: 0 },
      { date: "2026-10-03", quantity: 520, units: 3 },
    ]);
    expect(s.samples).toBe(2);
    expect(s.reliable).toBe(false);
    expect(s.warnings[0]).toMatch(/poco confiable/);
    expect(s.meanPerUnit).toBeCloseTo(170, 6);
  });
});

describe("cuello de botella", () => {
  it("las volquetas limitan la excavación", () => {
    const r = bottleneck([
      { name: "Excavación", units: 3, perUnitDaily: 816 },
      { name: "Acarreo (volquetas)", units: 5, perUnitDaily: 100 },
      { name: "Compactación", units: 1, perUnitDaily: 1200 },
    ]);
    expect(r.limiting).toBe("Acarreo (volquetas)");
    expect(r.throughput).toBe(500);
  });
});

describe("proyección", () => {
  it("mensaje de retraso con calendario", () => {
    const p = projectCompletion({
      activityName: "Hincado de pilotes",
      pendingQty: 2600,
      rates: { optimistic: 130, expected: 100, pessimistic: 80 },
      fromDate: "2026-10-14",
      deadline: "2026-11-07",
      calendar: { colombianHolidays: false },
    });
    expect(p.expected.workingDaysNeeded).toBe(26);
    expect(p.expected.finishDate).toBe("2026-11-12");
    expect(p.expected.delayDays).toBe(5);
    expect(p.message).toBe("Al ritmo actual, la actividad Hincado de pilotes termina el 2026-11-12, con 5 días de retraso.");
  });
});

describe("ruta crítica", () => {
  it("identifica la ruta crítica y la holgura", () => {
    const r = criticalPath([
      { id: "hincado", duration: 20, predecessors: [] },
      { id: "montaje", duration: 15, predecessors: ["hincado"] },
      { id: "zanjas", duration: 10, predecessors: [] },
      { id: "cableado", duration: 12, predecessors: ["montaje", "zanjas"] },
    ]);
    expect(r.projectDuration).toBe(47);
    expect(r.criticalPath).toEqual(["hincado", "montaje", "cableado"]);
    expect(r.nodes.zanjas!.totalFloat).toBe(25);
  });

  it("detecta ciclos", () => {
    expect(() =>
      criticalPath([
        { id: "a", duration: 1, predecessors: ["b"] },
        { id: "b", duration: 1, predecessors: ["a"] },
      ]),
    ).toThrow(/Ciclo/);
  });
});

describe("Pareto", () => {
  it("ordena, acumula y marca los pocos vitales hasta el 80 %", () => {
    const rows = pareto([
      { key: "clima", value: 40 },
      { key: "material", value: 25 },
      { key: "equipo", value: 15 },
      { key: "permisos", value: 10 },
      { key: "clima", value: 5 },
      { key: "personal", value: 5 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["clima", "material", "equipo", "permisos", "personal"]);
    expect(rows[0]!.value).toBe(45);
    expect(rows.map((r) => Number(r.cumulativePct.toFixed(2)))).toEqual([0.45, 0.7, 0.85, 0.95, 1]);
    expect(rows.map((r) => r.vital)).toEqual([true, true, true, false, false]);
  });

  it("Pareto por costo y días reclamables", () => {
    const recs = [
      { cause: "weather", lostHours: 20, idleCostPerHour: 100 },
      { cause: "equipment", lostHours: 5, idleCostPerHour: 1000 },
      { cause: "none", lostHours: 0 },
    ];
    expect(lossPareto(recs, "lost_cost").map((r) => r.key)).toEqual(["equipment", "weather"]);
    expect(lossPareto(recs, "lost_hours").map((r) => r.key)).toEqual(["weather", "equipment"]);
    expect(claimableDays(recs, ["weather", "permits"], 8)).toBe(2);
  });
});

describe("plano georreferenciado", () => {
  it("área de un cuadrado de 0,01° en el ecuador ≈ 1,239 km²", () => {
    const a = polygonAreaM2(rectangle([0, 0], [0.01, 0.01]));
    expect(a).toBeGreaterThan(1_235_000);
    expect(a).toBeLessThan(1_243_000);
  });

  it("ajuste afín recupera la transformación y calcula las esquinas", () => {
    const truth = { a: 1e-5, b: 2e-7, c: -74.1, d: -1e-7, e: -1e-5, f: 4.7 };
    const pts = [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ].map(([x, y]) => ({ px: [x, y] as [number, number], geo: pixelToGeo(truth, [x!, y!]) }));
    const t = fitAffine(pts);
    expect(t.a).toBeCloseTo(truth.a, 10);
    expect(t.e).toBeCloseTo(truth.e, 10);
    expect(t.rmseMeters).toBeLessThan(0.01);
    expect(imageCorners(t, 4000, 3000)[0][0]).toBeCloseTo(-74.1, 9);
  });

  it("el error por punto delata el punto mal marcado", () => {
    const truth = { a: 1e-5, b: 0, c: -74.1, d: 0, e: -1e-5, f: 4.7 };
    const pts = [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
      [2000, 1500],
      [1000, 2500],
    ].map(([x, y]) => ({ px: [x, y] as [number, number], geo: pixelToGeo(truth, [x!, y!]) }));
    // El cuarto punto se marcó ~50 m al oriente
    pts[3]!.geo = [pts[3]!.geo[0] + 0.00045, pts[3]!.geo[1]];
    const t = fitAffine(pts);
    const r = pointResiduals(t, pts);
    expect(t.rmseMeters).toBeGreaterThan(5);
    expect(r.indexOf(Math.max(...r))).toBe(3);
  });

  it("puntos colineales se rechazan", () => {
    expect(() =>
      fitAffine([
        { px: [0, 0], geo: [0, 0] },
        { px: [1, 1], geo: [1, 1] },
        { px: [2, 2], geo: [2, 2] },
      ]),
    ).toThrow(/colineales/);
  });

  it("estado de zona para colorear", () => {
    expect(zoneStatus(0, 10)).toBe("not_started");
    expect(zoneStatus(4, 10)).toBe("in_progress");
    expect(zoneStatus(10, 10)).toBe("done");
  });
});

describe("alertas", () => {
  it("hallazgo crítico vencido genera dos alertas", () => {
    const a = findingAlerts(
      { id: "f1", severity: "critical", status: "open", description: "Talud inestable", dueDate: "2026-10-10" },
      "2026-10-14",
    );
    expect(a.map((x) => x.kind)).toEqual(["critical_finding", "overdue"]);
  });

  it("rendimiento bajo frente al requerido", () => {
    expect(rateAlert("Montaje trackers", 6, 9, 10)!.body).toBe("Montaje trackers: 6.0/día, 60 % del requerido (10.0/día).");
    expect(rateAlert("Montaje trackers", 9.5, 9, 10)).toBeNull();
  });

  it("registros sin sincronizar por más de 12 h", () => {
    expect(staleSyncAlert("2026-10-13T06:00:00Z", "2026-10-14T06:00:00Z")!.body).toMatch(/24 horas/);
    expect(staleSyncAlert(null, "2026-10-14T06:00:00Z")).toBeNull();
  });
});
