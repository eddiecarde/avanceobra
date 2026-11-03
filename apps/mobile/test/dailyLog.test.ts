import { describe, expect, it } from "vitest";
import { emptyDraft, normalizeTime, nowColombia, rainMinutes, toDailyLogRow, validateDraft } from "../src/core/dailyLog";
import { toServerCall } from "../src/core/mapping";

describe("horas de lluvia", () => {
  it("acepta formatos rápidos de campo", () => {
    expect(normalizeTime("7")).toBe("07:00");
    expect(normalizeTime("7:5")).toBe("07:05");
    expect(normalizeTime("1015")).toBe("10:15");
    expect(normalizeTime("10.30")).toBe("10:30");
    expect(normalizeTime("25:00")).toBeNull();
    expect(normalizeTime("x")).toBeNull();
  });
  it("hora de Colombia y duración", () => {
    expect(nowColombia(new Date("2026-10-21T20:05:00Z"))).toBe("15:05");
    expect(rainMinutes({ start: "10:15", end: "11:40" })).toBe(85);
  });
});

describe("validación del parte", () => {
  it("vacío, lluvia invertida y cantidades", () => {
    expect(validateDraft(emptyDraft())).toEqual(["El parte está vacío: registra al menos el personal."]);
    const d = { ...emptyDraft(), personnel: { Oficial: 4 }, rain: [{ start: "11:00", end: "10:00" }] };
    expect(validateDraft(d)).toEqual(["Lluvia 1: la hora de fin debe ser después del inicio."]);
    expect(validateDraft({ ...emptyDraft(), personnel: { Oficial: 1.5 } })).toEqual(["Oficial: la cantidad debe ser un número entero."]);
  });
});

describe("envío", () => {
  it("arma la fila sin cantidades en cero y la sube como JSON", () => {
    const row = toDailyLogRow(
      { personnel: { Oficial: 4, Soldador: 0 }, equipment: { Retro: 1 }, rain: [{ start: "10", end: "1130" }], observations: " Lluvia " },
      { id: "l1", projectId: "p1", frontId: null, date: "2026-10-21", now: "2026-10-21T20:00:00Z" },
    );
    expect(JSON.parse(row.personnel)).toEqual([{ role: "Oficial", qty: 4 }]);
    expect(JSON.parse(row.rain)).toEqual([{ start: "10:00", end: "11:30" }]);
    expect(row.observations).toBe("Lluvia");
    const call = toServerCall("daily_logs", "PUT", "l1", row);
    expect(call).toMatchObject({ kind: "upsert", table: "daily_logs", row: { id: "l1", personnel: [{ role: "Oficial", qty: 4 }], equipment: [{ name: "Retro", qty: 1 }] } });
  });
  it("cada equipo puede llevar la actividad en la que trabajó", () => {
    const row = toDailyLogRow(
      { personnel: { Oficial: 2 }, equipment: { Hincadora: 2, Retro: 1 }, equipmentActivity: { Hincadora: "act-hin" }, rain: [], observations: "" },
      { id: "l2", projectId: "p1", frontId: null, date: "2026-10-21", now: "2026-10-21T20:00:00Z" },
    );
    expect(JSON.parse(row.equipment)).toEqual([{ name: "Hincadora", qty: 2, activity_id: "act-hin" }, { name: "Retro", qty: 1 }]);
  });
});
