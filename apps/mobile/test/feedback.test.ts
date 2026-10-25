import { describe, expect, it } from "vitest";
import { draftAgeHours, hasContent, parseDraft, serializeDraft, type CaptureDraft } from "../src/core/captureDraft";
import { normalizeCode, parseQty, suggestActivityCode, validateActivity, validateFront } from "../src/core/catalog";
import { reconcile, saveWarnings } from "../src/core/reconcile";
import { anchorOf, pointInRing, rectangleRing, selectInArea, type SelectableElement } from "../src/core/selection";

/** 1.000 hincas en una grilla de 25 × 40 (cada una a ~1 m) para probar selección masiva. */
function grid(n = 1000, cols = 25): SelectableElement[] {
  return Array.from({ length: n }, (_, i) => {
    const x = -73.65 + (i % cols) * 0.00001;
    const y = 9.95 + Math.floor(i / cols) * 0.00001;
    return { id: `p${i}`, qty: 1, executed: 0, geojson: JSON.stringify({ type: "Point", coordinates: [x, y] }) };
  });
}

describe("selección masiva en el plano", () => {
  const els = grid();
  const all = rectangleRing([-73.65001, 9.94999], [-73.6497, 9.9505]);

  it("un rectángulo marca las 1.000 hincas de una vez", () => {
    const r = selectInArea(els, [], all, "add");
    expect(r.ids).toHaveLength(1000);
    expect(r.changed).toBe(1000);
  });

  it("un rectángulo parcial marca solo las de adentro (10 columnas × 4 filas)", () => {
    const part = rectangleRing([-73.650005, 9.949995], [-73.649905, 9.950035]);
    expect(selectInArea(els, [], part, "add").ids).toHaveLength(40);
  });

  it("no vuelve a marcar las ya ejecutadas y lo informa", () => {
    const done = els.map((e, i) => (i < 100 ? { ...e, executed: 1 } : e));
    const r = selectInArea(done, [], all, "add");
    expect(r.ids).toHaveLength(900);
    expect(r.skippedExecuted).toBe(100);
  });

  it("quitar por área deselecciona solo lo de adentro", () => {
    const sel = selectInArea(els, [], all, "add").ids;
    const firstRow = rectangleRing([-73.650005, 9.949995], [-73.6497, 9.950005]);
    const r = selectInArea(els, sel, firstRow, "remove");
    expect(r.changed).toBe(25);
    expect(r.ids).toHaveLength(975);
  });

  it("polígono irregular (triángulo) y trackers por su centroide", () => {
    const tri: [number, number][] = [[0, 0], [10, 0], [0, 10]];
    expect(pointInRing([2, 2], tri)).toBe(true);
    expect(pointInRing([8, 8], tri)).toBe(false);
    const tracker = JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 60], [0, 60], [0, 0]]] });
    expect(anchorOf(tracker)).toEqual([1, 30]);
    expect(anchorOf("no-json")).toBeNull();
  });
});

describe("cuadre cantidad reportada vs. marcada", () => {
  it("faltan, sobran, coincide", () => {
    expect(reconcile(20, 15, "pilotes")).toMatchObject({ state: "missing", diff: -5 });
    expect(reconcile(20, 15, "pilotes").message).toBe("Reportaste 20 y marcaste 15: faltan 5 pilotes por marcar en el plano.");
    expect(reconcile(20, 25, "pilotes").message).toBe("Reportaste 20 y marcaste 25: marcaste 5 pilotes de más.");
    expect(reconcile(20, 20, "pilotes").state).toBe("match");
    expect(reconcile(null, 12, "pilotes").state).toBe("no_quantity");
    expect(reconcile(20, 0, "pilotes").state).toBe("nothing_marked");
  });

  it("advertencias antes de guardar: contrato, cuadre y registro repetido", () => {
    const w = saveWarnings({
      quantity: 20, unit: "pilotes", contractQty: 192, executedBefore: 180, marked: 15,
      recentSame: [{ quantity: 20, minutesAgo: 3 }],
    });
    expect(w).toHaveLength(3);
    expect(w[0]).toContain("más que lo contratado");
    expect(w[1]).toContain("faltan 5");
    expect(w[2]).toContain("Hace 3 min");
    expect(saveWarnings({ quantity: 10, unit: "m", contractQty: 900, executedBefore: 100, marked: 0, recentSame: [] })).toEqual([]);
  });
});

describe("borrador automático de la captura", () => {
  const base: Omit<CaptureDraft, "v" | "savedAt"> = {
    activityId: "a1", frontId: "f1", workDate: "2026-10-16", quantity: "", hours: null, lostHours: "0", cause: "none",
    weather: null, crew: null, notes: "", photos: [], signatureUri: null, elementIds: [], area: null,
  };
  it("solo guarda si hay algo escrito o marcado", () => {
    expect(hasContent(base)).toBe(false);
    expect(hasContent({ ...base, quantity: "12" })).toBe(true);
    expect(hasContent({ ...base, elementIds: ["e1"] })).toBe(true);
  });
  it("ida y vuelta, versión y antigüedad", () => {
    const json = serializeDraft({ ...base, quantity: "12", photos: [{ id: "p", uri: "file:///p.jpg", takenAt: "x" }] }, new Date("2026-10-16T15:00:00Z"));
    const d = parseDraft(json)!;
    expect(d.quantity).toBe("12");
    expect(d.photos).toHaveLength(1);
    expect(draftAgeHours(d, new Date("2026-10-16T17:00:00Z"))).toBe(2);
    expect(parseDraft("{malo")).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 99, activityId: "a", quantity: "1" }))).toBeNull();
  });
});

describe("catálogo editable por el administrador", () => {
  it("cantidades en formato colombiano o con punto decimal", () => {
    expect(parseQty("1.250")).toBe(1250);
    expect(parseQty("1.250,5")).toBe(1250.5);
    expect(parseQty("12,5")).toBe(12.5);
    expect(parseQty("12.5")).toBe(12.5);
    expect(parseQty("")).toBeNaN();
  });
  it("valida frentes", () => {
    expect(validateFront({ code: "bc", name: "Bloque C" }, ["BA", "BB"]).ok).toBe(true);
    expect(validateFront({ code: "ba", name: "Otro" }, ["BA"]).errors.code).toContain("Ya existe");
    expect(validateFront({ code: "BA", name: "Bloque A" }, ["BA"], "BA").ok).toBe(true); // editar el mismo
    expect(normalizeCode(" bloque c ")).toBe("BLOQUE-C");
  });
  it("valida actividades", () => {
    const ok = { code: "BC-HIN", name: "Hincado", unit: "pilotes", contractQty: "1.000", plannedStart: "2026-10-20", plannedFinish: "2026-11-30" };
    expect(validateActivity(ok, ["BC-MON"]).ok).toBe(true);
    const bad = validateActivity({ ...ok, contractQty: "0", plannedFinish: "2026-10-01", unit: "" }, []);
    expect(Object.keys(bad.errors).sort()).toEqual(["contractQty", "plannedFinish", "unit"]);
    expect(validateActivity({ ...ok, contractQty: "100" }, [], "BC-HIN", 150).errors.contractQty).toContain("150");
  });
  it("sugiere códigos sin repetir", () => {
    expect(suggestActivityCode("bc", "HIN", [])).toBe("BC-HIN");
    expect(suggestActivityCode("BC", "HIN", ["BC-HIN", "BC-HIN2"])).toBe("BC-HIN3");
  });
});
