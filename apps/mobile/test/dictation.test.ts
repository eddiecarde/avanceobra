import { describe, expect, it } from "vitest";
import { emptyDraft } from "../src/core/dailyLog";
import { applyReport, dictatedProgress, type ParsedReport } from "../src/core/dictation";

const report = (p: Partial<ParsedReport> = {}): ParsedReport => ({
  front_code: null,
  progress: [],
  personnel: [],
  equipment: [],
  rain: [],
  findings: [],
  observations: "",
  unmatched: [],
  ...p,
});

describe("parte por voz", () => {
  it("pone personal, equipos y lluvia en el borrador con los nombres del catálogo", () => {
    const d = { ...emptyDraft(), personnel: { "Oficial de obra": 2, Soldador: 1 }, rain: [{ start: "07:00", end: "07:30" }], observations: "Visita del cliente" };
    const r = report({
      personnel: [{ role: "oficial de obra", qty: 4 }, { role: "Topógrafo", qty: 1 }],
      equipment: [{ name: "hincadora", qty: 2 }],
      rain: [{ start: "10:00", end: "11:00" }, { start: "07:00", end: "07:30" }],
      observations: "Llegó tarde el material",
    });
    const out = applyReport(d, r, { roles: ["Oficial de obra", "Soldador"], equipment: ["Hincadora"] });
    expect(out.personnel).toEqual({ "Oficial de obra": 4, Soldador: 1, Topógrafo: 1 });
    expect(out.equipment).toEqual({ Hincadora: 2 });
    expect(out.rain).toEqual([{ start: "07:00", end: "07:30" }, { start: "10:00", end: "11:00" }]);
    expect(out.observations).toBe("Visita del cliente\nLlegó tarde el material");
    // Aplicar dos veces no duplica
    expect(applyReport(out, r, { roles: [], equipment: [] }).observations).toBe(out.observations);
  });

  it("liga los avances dictados con las actividades del teléfono", () => {
    const acts = [{ id: "a1", code: "FV-03", name: "Hincado", unit: "und", front_id: "f1" }];
    const r = report({ progress: [{ activity_code: "fv-03", quantity: 120, note: "fila 4" }, { activity_code: "FV-99", quantity: 1, note: "" }] });
    expect(dictatedProgress(r, acts)).toEqual([{ activityId: "a1", frontId: "f1", code: "FV-03", name: "Hincado", unit: "und", quantity: 120, note: "fila 4" }]);
  });
});
