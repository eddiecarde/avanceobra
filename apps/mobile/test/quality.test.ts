import { describe, expect, it } from "vitest";
import { correctionDiff, correctionRequest, inspectionErrors } from "../src/core/quality";

describe("inspección en el teléfono", () => {
  const items = [
    { id: "1", text: "Verticalidad" },
    { id: "2", text: "Cota de cabeza" },
  ];
  it("pide responder todo y describir cada no cumple", () => {
    expect(inspectionErrors(items, { "1": { result: "ok", note: "", impeditive: false } })).toEqual(["Falta responder: Cota de cabeza"]);
    expect(inspectionErrors(items, { "1": { result: "ok", note: "", impeditive: false }, "2": { result: "no_ok", note: " ", impeditive: true } })).toEqual([
      "Describe qué no cumple en: Cota de cabeza",
    ]);
    expect(inspectionErrors(items, { "1": { result: "na", note: "", impeditive: false }, "2": { result: "no_ok", note: "4 cm abajo", impeditive: true } })).toEqual([]);
  });
});

describe("corrección de un registro aprobado", () => {
  const entry = { quantity: 10, work_date: "2026-10-20", notes: "" };
  const form = (f: Partial<{ quantity: string; work_date: string; notes: string; reason: string }>) => ({ quantity: "10", work_date: "2026-10-20", notes: "", reason: "", ...f });

  it("envía solo lo que cambia, con coma decimal", () => {
    expect(correctionRequest(entry, form({ quantity: "1,5", reason: "Se digitó 10 en vez de 1,5" }), "2026-10-22")).toEqual({ changes: { quantity: 1.5 }, error: null });
  });
  it("exige motivo, un cambio real y fecha no futura", () => {
    expect(correctionRequest(entry, form({ quantity: "9" }), "2026-10-22").error).toMatch(/motivo/);
    expect(correctionRequest(entry, form({ reason: "Una razón suficiente" }), "2026-10-22").error).toMatch(/no cambia nada/);
    expect(correctionRequest(entry, form({ work_date: "2026-10-30", reason: "Una razón suficiente" }), "2026-10-22").error).toMatch(/futura/);
    expect(correctionRequest(entry, form({ quantity: "abc", reason: "Una razón suficiente" }), "2026-10-22").error).toMatch(/número/);
  });
});

describe("correctionDiff", () => {
  it("muestra solo lo que cambia, en palabras", () => {
    expect(correctionDiff({ quantity: 10, work_date: "2026-10-20", notes: "" }, { quantity: 1, work_date: "2026-10-20", notes: "" })).toEqual(["Cantidad: 10 → 1"]);
    expect(correctionDiff({ notes: null }, { notes: "Fila 3" })).toEqual(["Notas: — → Fila 3"]);
  });
});

describe("avisos personales", () => {
  it("notifica solo lo nuevo y no leído, y sabe a dónde lleva cada aviso", async () => {
    const { noticeRoute, toNotify } = await import("../src/core/notices");
    const n = (id: string, created_at: string, read_at: string | null = null) => ({ id, kind: "finding_assigned", title: "t", body: "b", ref_table: "findings", ref_id: id, created_at, read_at });
    const rows = [n("c", "2026-10-23T12:00:00Z"), n("a", "2026-10-23T10:00:00Z"), n("b", "2026-10-23T11:00:00Z", "2026-10-23T11:05:00Z")];
    expect(toNotify(rows, "2026-10-23T09:00:00Z").map((r) => r.id)).toEqual(["a", "c"]);
    expect(toNotify(rows, "2026-10-23T10:30:00Z").map((r) => r.id)).toEqual(["c"]);
    expect(noticeRoute({ ref_table: "findings", ref_id: "f1" })).toBe("/hallazgo/f1");
    expect(noticeRoute({ ref_table: "entry_corrections", ref_id: "x" })).toBe("/registros");
  });
});
