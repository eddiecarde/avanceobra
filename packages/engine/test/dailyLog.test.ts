import { describe, expect, it } from "vitest";
import { mergeRain, rainInWindow, summarizeDailyLogs, weatherClaim } from "../src/index.js";

describe("lluvia", () => {
  it("une intervalos solapados y contiguos de varios supervisores", () => {
    const r = mergeRain([
      { start: "10:15", end: "11:00" },
      { start: "10:45", end: "11:30" },
      { start: "11:30", end: "11:45" },
      { start: "14:00", end: "14:20" },
    ]);
    expect(r.intervals).toEqual([
      { start: "10:15", end: "11:45" },
      { start: "14:00", end: "14:20" },
    ]);
    expect(r.minutes).toBe(110);
  });
  it("ignora intervalos vacíos", () => {
    expect(mergeRain([{ start: "09:00", end: "09:00" }]).minutes).toBe(0);
  });
});

describe("resumen del parte diario", () => {
  it("suma personal y equipos de los frentes y junta observaciones", () => {
    const s = summarizeDailyLogs([
      { date: "2026-10-20", personnel: [{ role: "Oficial", qty: 4 }, { role: "Auxiliar", qty: 6 }], equipment: [{ name: "Retro", qty: 1 }], rain: [{ start: "10:00", end: "11:00" }], observations: "Frente A" },
      { date: "2026-10-20", personnel: [{ role: "Oficial", qty: 2 }, { role: "Soldador", qty: 0 }], equipment: [{ name: "Retro", qty: 1 }, { name: "Canguro", qty: 2 }], rain: [{ start: "10:30", end: "11:15" }], observations: " " },
      { date: "2026-10-21", personnel: [{ role: "Oficial", qty: 3 }], equipment: [], rain: [] },
    ]);
    const d = s.get("2026-10-20")!;
    expect(d.personnel).toEqual({ Oficial: 6, Auxiliar: 6 });
    expect(d.totalPersonnel).toBe(12);
    expect(d.equipment).toEqual({ Retro: 2, Canguro: 2 });
    expect(d.rainMinutes).toBe(75);
    expect(d.observations).toEqual(["Frente A"]);
    expect(d.reports).toBe(2);
    expect(s.get("2026-10-21")!.totalPersonnel).toBe(3);
  });
});

describe("días reclamables por lluvia", () => {
  const window = { start: "07:00", end: "17:00" };
  it("cuenta solo la lluvia dentro de la jornada", () => {
    expect(rainInWindow([{ start: "05:00", end: "08:30" }, { start: "16:00", end: "19:00" }], window)).toBe(150);
  });

  it("toma la mayor fuente por día sin sumar cuadrillas ni pasar de la jornada", () => {
    const logs = summarizeDailyLogs([
      { date: "2026-10-01", personnel: [], equipment: [], rain: [{ start: "07:00", end: "11:00" }] },
      { date: "2026-10-01", personnel: [], equipment: [], rain: [{ start: "10:00", end: "12:00" }] },
      { date: "2026-10-02", personnel: [], equipment: [], rain: [{ start: "06:00", end: "20:00" }] },
    ]);
    const claim = weatherClaim(logs.values(), new Map([["2026-10-01", 3], ["2026-10-03", 4]]), { window, effectiveHours: 8 });
    expect(claim.days.map((d) => [d.date, d.hours])).toEqual([
      ["2026-10-01", 5],
      ["2026-10-02", 8],
      ["2026-10-03", 4],
    ]);
    expect(claim.hours).toBe(17);
    expect(claim.claimableDays).toBe(2);
  });
});

describe("máquinas por actividad del parte diario", () => {
  it("suma por actividad y día e ignora los equipos sin actividad", async () => {
    const { equipmentUnitsByActivity } = await import("../src/dailyLog.js");
    const m = equipmentUnitsByActivity([
      { date: "2026-10-20", equipment: [{ name: "Hincadora", qty: 2, activity_id: "hin" }, { name: "Retro", qty: 1 }] },
      { date: "2026-10-20", equipment: [{ name: "Hincadora", qty: 1, activity_id: "hin" }] },
      { date: "2026-10-21", equipment: [{ name: "Hincadora", qty: 1, activity_id: "hin" }, { name: "Volqueta", qty: 0, activity_id: "zan" }] },
    ]);
    expect([...m.get("hin")!.entries()]).toEqual([["2026-10-20", 3], ["2026-10-21", 1]]);
    expect(m.has("zan")).toBe(false);
  });
});
