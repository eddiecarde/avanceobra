import { describe, expect, it } from "vitest";
import { activityStatus, plannedQtyAt, recentDailyRate, reportWeeks, sCurve, weeklyProgress, weighting, type DailyQuantity, type ScheduleActivity } from "../src/index.js";

// Calendario de 7 días sin festivos: aritmética simple
const cal = { workdays: [1, 2, 3, 4, 5, 6, 7], colombianHolidays: false };

const A: ScheduleActivity = { id: "a", code: "A", name: "Hincado", unit: "pilotes", contractQty: 100, plannedStart: "2026-10-01", plannedFinish: "2026-10-10" };
const B: ScheduleActivity = { id: "b", code: "B", name: "Montaje", unit: "trackers", contractQty: 10, plannedStart: "2026-10-06", plannedFinish: "2026-10-15" };

const daily = (id: string, from: string, days: number, q: number): DailyQuantity[] =>
  Array.from({ length: days }, (_, i) => ({ activityId: id, date: `2026-10-${String(Number(from.slice(8)) + i).padStart(2, "0")}`, quantity: q }));

describe("programado lineal", () => {
  it("reparte la cantidad en días laborables", () => {
    expect(plannedQtyAt(A, "2026-09-30", cal)).toBe(0);
    expect(plannedQtyAt(A, "2026-10-01", cal)).toBe(10);
    expect(plannedQtyAt(A, "2026-10-05", cal)).toBe(50);
    expect(plannedQtyAt(A, "2026-10-10", cal)).toBe(100);
    expect(plannedQtyAt(A, "2026-11-01", cal)).toBe(100);
  });
  it("sin fechas no hay programado", () => {
    expect(plannedQtyAt({ ...A, plannedStart: null }, "2026-10-05", cal)).toBe(0);
  });
});

describe("rendimiento reciente", () => {
  it("cuenta los días sin reporte como cero", () => {
    const d = daily("a", "2026-10-01", 5, 10); // 1..5 oct
    expect(recentDailyRate(d, "a", "2026-10-10", 10, cal)).toBeCloseTo(5);
  });
});

describe("semáforo", () => {
  it("verde cuando va según programa", () => {
    const s = activityStatus(A, 50, 10, "2026-10-05", cal);
    expect(s.light).toBe("green");
    expect(s.projectedFinish).toBe("2026-10-10");
    expect(s.delayDays).toBe(0);
  });
  it("rojo con retraso proyectado y explica el rendimiento necesario", () => {
    const s = activityStatus(A, 30, 5, "2026-10-05", cal); // faltan 70 a 5/día = 14 días → 19 oct
    expect(s.light).toBe("red");
    expect(s.delayDays).toBe(9);
    expect(s.requiredRate).toBeCloseTo(14);
    expect(s.reason).toContain("Se necesitan 14 pilotes/día y van 5");
  });
  it("ámbar con poco retraso", () => {
    const s = activityStatus(A, 48, 9, "2026-10-05", cal); // faltan 52 a 9/día = 6 días → 11 oct
    expect(s.light).toBe("amber");
    expect(s.delayDays).toBe(1);
  });
  it("rojo sin avance reciente", () => {
    expect(activityStatus(A, 20, 0, "2026-10-05", cal).light).toBe("red");
  });
  it("por iniciar, terminada y sin programa", () => {
    expect(activityStatus(B, 0, 0, "2026-10-03", cal).light).toBe("not_started");
    expect(activityStatus(A, 100, 0, "2026-10-05", cal).light).toBe("done");
    expect(activityStatus({ ...A, plannedFinish: null }, 10, 1, "2026-10-05", cal).light).toBe("no_plan");
  });
});

describe("curva S", () => {
  it("programado, real y proyección ponderados por igual", () => {
    const d = [...daily("a", "2026-10-01", 5, 10)]; // A al 50 % el 5 oct; B sin avance
    const r = sCurve({ activities: [A, B], daily: d, from: "2026-10-01", to: "2026-10-15", today: "2026-10-05", calendar: cal, rateWindowDays: 5 });
    expect(r.plannedToday).toBeCloseTo(0.25); // A 50 %, B 0 %
    expect(r.actualToday).toBeCloseTo(0.25);
    expect(r.spi).toBeCloseTo(1);
    // B no tiene ritmo: la fecha proyectada es la de A y B queda como detenida
    expect(r.projectedFinish).toBe("2026-10-10");
    expect(r.stalled).toEqual(["b"]);
  });
  it("deja por fuera las actividades sin programa", () => {
    const sinFechas = { ...A, id: "c", plannedStart: null, plannedFinish: null };
    const r = sCurve({ activities: [A, sinFechas], daily: [], from: "2026-10-01", to: "2026-10-10", today: "2026-10-05", calendar: cal });
    expect(r.excluded).toEqual(["c"]);
    expect(r.points.at(-1)!.planned).toBeCloseTo(1);
  });
  it("mantiene la serie completa", () => {
    const d = [...daily("a", "2026-10-01", 5, 10)];
    const r = sCurve({ activities: [A, B], daily: d, from: "2026-10-01", to: "2026-10-15", today: "2026-10-05", calendar: cal, rateWindowDays: 5 });
    expect(r.points.at(-1)!.date).toBe("2026-10-15");
    expect(r.points.at(-1)!.planned).toBeCloseTo(1);
    expect(r.points.find((p) => p.date === "2026-10-06")!.actual).toBeNull();
    expect(r.points.find((p) => p.date === "2026-10-10")!.projected).toBeCloseTo(0.5); // A llega al 100 %
  });
  it("extiende el eje hasta la terminación proyectada", () => {
    const d = [...daily("a", "2026-10-01", 5, 10), ...daily("b", "2026-10-05", 1, 0.5)];
    const r = sCurve({ activities: [A, B], daily: d, from: "2026-10-01", to: "2026-10-15", today: "2026-10-05", calendar: cal, rateWindowDays: 5 });
    // B: 9,5 pendientes a 0,1/día → 95 días
    expect(r.projectedFinish).toBe("2027-01-08");
    expect(r.points.at(-1)!.date).toBe("2027-01-08");
    expect(r.points.at(-1)!.projected).toBeCloseTo(1);
  });
});

describe("ponderación", () => {
  it("con pesos, el avance global sigue los pesos; sin pesos, todas iguales", () => {
    const d = [...daily("a", "2026-10-01", 5, 10)]; // A al 50 %
    const conPesos = sCurve({ activities: [{ ...A, weight: 0.8 }, { ...B, weight: 0.2 }], daily: d, from: "2026-10-01", to: "2026-10-15", today: "2026-10-05", calendar: cal });
    expect(conPesos.actualToday).toBeCloseTo(0.4);
    const sinPesos = sCurve({ activities: [A, B], daily: d, from: "2026-10-01", to: "2026-10-15", today: "2026-10-05", calendar: cal });
    expect(sinPesos.actualToday).toBeCloseTo(0.25);
  });
  it("normaliza pesos que no suman exactamente 1 y deja en 0 las que no tienen", () => {
    const { w } = weighting([{ ...A, weight: 0.5 }, { ...B, weight: 0.5000001 }, { ...A, id: "c" }]);
    expect(w({ ...A, weight: 0.5 })).toBeCloseTo(0.5);
    expect(w({ ...A, id: "c" })).toBe(0);
  });
});

describe("seguimiento semanal", () => {
  // Calendario del formato del cliente: lunes a sábado, sin festivos
  const lunSab = { workdays: [1, 2, 3, 4, 5, 6], colombianHolidays: false };
  it("semanas de lunes a domingo, rotuladas hasta el sábado", () => {
    const w = reportWeeks("2026-10-13", "2026-10-26", lunSab);
    expect(w.map((x) => [x.index, x.start, x.end, x.lastWorkday])).toEqual([
      [1, "2026-10-12", "2026-10-18", "2026-10-17"],
      [2, "2026-10-19", "2026-10-25", "2026-10-24"],
      [3, "2026-10-26", "2026-11-01", "2026-10-31"],
    ]);
  });
  it("% programado, ejecutado y avance ponderado por semana", () => {
    // Preparación del terreno: 13 al 19 de oct (6 días hábiles), 600 m2; cerramiento sin avance
    const prep: ScheduleActivity = { id: "p", code: "1", name: "Preparación", unit: "m2", contractQty: 600, plannedStart: "2026-10-13", plannedFinish: "2026-10-19", weight: 0.25 };
    const cerr: ScheduleActivity = { id: "c", code: "2", name: "Cerramiento", unit: "ml", contractQty: 100, plannedStart: "2026-10-13", plannedFinish: "2026-11-23", weight: 0.75 };
    const d: DailyQuantity[] = [
      { activityId: "p", date: "2026-10-13", quantity: 100 },
      { activityId: "p", date: "2026-10-16", quantity: 200 },
      { activityId: "p", date: "2026-10-20", quantity: 150 },
    ];
    const r = weeklyProgress({ activities: [prep, cerr], daily: d, from: "2026-10-13", to: "2026-11-23", today: "2026-10-21", calendar: lunSab });
    const p = r.rows[0]!;
    expect(p.planned[0]).toBeCloseTo(5 / 6); // 13 a 17 de oct: 5 de 6 días
    expect(p.actual[0]).toBeCloseTo(0.5);
    expect(p.executed.slice(0, 2)).toEqual([300, 150]);
    expect(p.actual[1]).toBeCloseTo(0.75);
    expect(p.actual[2]).toBeNull(); // semana futura
    expect(r.totalActual[0]).toBeCloseTo(0.25 * 0.5);
    expect(r.totalPlanned[0]).toBeCloseTo(0.25 * (5 / 6) + 0.75 * (5 / 36));
    expect(r.weighted).toBe(true);
  });
});
