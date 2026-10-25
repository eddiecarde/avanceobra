import { describe, expect, it } from "vitest";
import { backoffDelayMs, BACKOFF_MAX_MS, isDue, nextAttemptAt } from "../src/core/backoff";
import { closeRing, polygonFromTaps, quantityFromArea, rectangleFromTaps } from "../src/core/drawing";
import { allowedTransitions, closeNoteError, filterFindings, isOverdue, type FindingLike } from "../src/core/findings";
import { isPermanentError, pointEwkt, polygonEwkt, toServerCall } from "../src/core/mapping";
import { bboxOf, buildElementsGeoJSON, latestPlans, summarize } from "../src/core/planStatus";
import { cumulativePct, rankActivities, suggestValues, type RecentEntry } from "../src/core/recent";
import { formatCoord, formatLocalDateTime, watermarkLines } from "../src/core/watermark";

describe("mapeo de la cola CRUD a Supabase", () => {
  it("convierte lat/lon a EWKT, parsea JSON y quita columnas locales en un registro nuevo", () => {
    const call = toServerCall("progress_entries", "PUT", "e1", {
      quantity: 12,
      lat: 4.6,
      lon: -74.08,
      values: '{"slump":4}',
      version: 1,
    });
    expect(call).toEqual({
      kind: "upsert",
      table: "progress_entries",
      row: { id: "e1", quantity: 12, location: "SRID=4326;POINT(-74.08 4.6)", values: { slump: 4 } },
    });
  });

  it("sin GPS la ubicación queda nula", () => {
    expect(pointEwkt(null, null)).toBeNull();
  });

  it("el área dibujada viaja como POLYGON EWKT, sin el área calculada", () => {
    const geojson = JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    expect(polygonEwkt(geojson)).toBe("SRID=4326;POLYGON((0 0, 1 0, 1 1, 0 0))");
    const call = toServerCall("progress_areas", "PUT", "a1", { geojson, area_m2: 10, is_approximate: 1, entry_id: "e1" });
    expect(call).toMatchObject({ kind: "upsert", row: { id: "a1", entry_id: "e1", is_approximate: true, geom: expect.stringMatching(/^SRID=4326;POLYGON/) } });
    expect((call as { row: Record<string, unknown> }).row).not.toHaveProperty("area_m2");
  });

  it("una NC creada sin señal sube su clase, actividad e impeditivo como booleano", () => {
    const call = toServerCall("findings", "PUT", "f2", { project_id: "p", category: "no_conformidad", impeditive: 1, activity_id: "a1", version: 1, lat: null, lon: null });
    expect(call).toMatchObject({ kind: "upsert", table: "findings", row: { id: "f2", category: "no_conformidad", impeditive: true, activity_id: "a1" } });
  });

  it("una inspección hecha sin señal se registra con la RPC, con su propio id", () => {
    const payload = JSON.stringify({ id: "i1", project_id: "p", checklist_id: "c", answers: [] });
    expect(toServerCall("inspection_submissions", "PUT", "i1", { project_id: "p", payload })).toEqual({
      kind: "rpc",
      fn: "submit_inspection",
      args: { p: { id: "i1", project_id: "p", checklist_id: "c", answers: [] } },
    });
    // Empresas y listas de chequeo solo se descargan
    expect(toServerCall("checklists", "PUT", "c", { name: "x" }).kind).toBe("skip");
    expect(toServerCall("project_companies", "PATCH", "e", { name: "x" }).kind).toBe("skip");
  });

  it("el cierre sube la nota de verificación junto con el estado", () => {
    const call = toServerCall("findings", "PATCH", "f1", { status: "closed", verification_note: "Pilote a plomo", base_version: 2 }, 2);
    expect(call).toEqual({
      kind: "rpc",
      fn: "update_finding_synced",
      args: { p_id: "f1", p_patch: { status: "closed", verification_note: "Pilote a plomo" }, p_base_version: 2 },
    });
  });

  it("el cambio de estado de un hallazgo va por RPC con la versión base", () => {
    const call = toServerCall("findings", "PATCH", "f1", { status: "in_correction", base_version: 3, updated_at: "x" }, 3);
    expect(call).toEqual({
      kind: "rpc",
      fn: "update_finding_synced",
      args: { p_id: "f1", p_patch: { status: "in_correction" }, p_base_version: 3 },
    });
  });

  it("proyectos y elementos no se suben; frentes y actividades del admin sí", () => {
    expect(toServerCall("elements", "PATCH", "x", { qty: 2 }).kind).toBe("skip");
    expect(toServerCall("activities", "PUT", "a1", { name: "Hincado", contract_qty: 1000 })).toEqual({
      kind: "upsert", table: "activities", row: { id: "a1", name: "Hincado", contract_qty: 1000 },
    });
  });

  it("errores definitivos vs. transitorios", () => {
    expect(isPermanentError({ code: "P0001" })).toBe(true); // registro aprobado
    expect(isPermanentError({ code: "42501" })).toBe(true); // RLS
    expect(isPermanentError({ code: "23505" })).toBe(true);
    expect(isPermanentError({ code: "PGRST116", status: 406 })).toBe(true);
    expect(isPermanentError({ code: "", status: 503 })).toBe(false);
    expect(isPermanentError({ code: "PGRST000", status: 429 })).toBe(false);
    expect(isPermanentError(null)).toBe(false);
  });
});

describe("backoff exponencial", () => {
  const noJitter = () => 0.5;
  it("duplica la espera y se limita a 30 minutos", () => {
    expect([0, 1, 2, 3].map((a) => backoffDelayMs(a, noJitter))).toEqual([5000, 10000, 20000, 40000]);
    expect(backoffDelayMs(20, noJitter)).toBe(BACKOFF_MAX_MS);
  });
  it("jitter de ±20 %", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(8000);
    expect(backoffDelayMs(1, () => 1)).toBe(12000);
  });
  it("próximo intento y vencimiento", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const next = nextAttemptAt(now, 0, noJitter);
    expect(next).toBe("2026-10-14T12:00:05.000Z");
    expect(isDue(next, now)).toBe(false);
    expect(isDue(next, new Date("2026-10-14T12:00:06Z"))).toBe(true);
    expect(isDue(null, now)).toBe(true);
  });
});

describe("marca de agua", () => {
  it("usa la hora de Colombia sin importar la zona del teléfono", () => {
    expect(formatLocalDateTime(new Date("2026-10-14T03:30:00Z"))).toBe("2026-10-13 22:30:00");
  });
  it("coordenadas con hemisferio y precisión", () => {
    expect(formatCoord(4.60971, -74.08175, 4.2)).toBe("4.609710° N, 74.081750° W ±4 m");
    expect(formatCoord(null, null)).toBe("Sin GPS");
  });
  it("líneas completas", () => {
    expect(
      watermarkLines({ takenAt: new Date("2026-10-14T15:00:00Z"), lat: 4.6, lon: -74.1, project: "PV Sol", front: "F1", activity: "Hincado", user: "Ana" }),
    ).toEqual(["2026-10-14 10:00:00", "4.600000° N, 74.100000° W", "PV Sol · F1 · Hincado", "Ana"]);
  });
});

describe("valores recientes", () => {
  const recent: RecentEntry[] = [
    { activity_id: "hinc", work_date: "2026-10-13", client_created_at: "2026-10-13T20:00:00Z", quantity: 110, effective_hours: 9, crew_size: 6, weather: "sunny" },
    { activity_id: "hinc", work_date: "2026-10-12", client_created_at: "2026-10-12T20:00:00Z", quantity: 95, effective_hours: 8, crew_size: 6, weather: "cloudy" },
    { activity_id: "mont", work_date: "2026-09-01", client_created_at: "2026-09-01T20:00:00Z", quantity: 3, effective_hours: 8, crew_size: 4, weather: null },
  ];
  it("ordena por uso reciente y luego por código", () => {
    const acts = [{ id: "cab", code: "A3" }, { id: "mont", code: "A2" }, { id: "hinc", code: "A1" }];
    expect(rankActivities(acts, recent, "2026-10-14").map((a) => a.id)).toEqual(["hinc", "mont", "cab"]);
  });
  it("propone los valores del último registro", () => {
    expect(suggestValues("hinc", recent)).toEqual({ quantity: 110, effectiveHours: 9, crewSize: 6, weather: "sunny" });
    expect(suggestValues("nueva", recent)).toEqual({ quantity: null, effectiveHours: 8, crewSize: 0, weather: null });
  });
  it("% acumulado", () => {
    expect(cumulativePct(2600, 10400)).toBe(25);
    expect(cumulativePct(11000, 10400)).toBe(100);
    expect(cumulativePct(5, 0)).toBe(0);
  });
});

describe("pendientes y hallazgos", () => {
  const base = { type: "quality", front_id: "f1", responsible_user_id: "u1" };
  const list: FindingLike[] = [
    { ...base, id: "a", severity: "low", status: "open", due_date: "2026-10-20", created_at: "2026-10-01T00:00:00Z" },
    { ...base, id: "b", severity: "critical", status: "in_correction", due_date: "2026-10-15", created_at: "2026-10-13T00:00:00Z" },
    { ...base, id: "c", severity: "high", status: "open", due_date: "2026-10-10", created_at: "2026-10-05T00:00:00Z", responsible_user_id: "u2" },
    { ...base, id: "d", severity: "high", status: "closed", due_date: "2026-10-01", created_at: "2026-09-20T00:00:00Z" },
  ];
  const today = "2026-10-14";
  it("excluye cerrados y ordena por severidad", () => {
    expect(filterFindings(list, {}, today).map((f) => f.id)).toEqual(["b", "c", "a"]);
  });
  it("filtros: vencidos, responsable, antigüedad", () => {
    expect(filterFindings(list, { overdueOnly: true }, today).map((f) => f.id)).toEqual(["c"]);
    expect(filterFindings(list, { responsibleId: "u1" }, today).map((f) => f.id)).toEqual(["b", "a"]);
    expect(filterFindings(list, { minAgeDays: 7 }, today).map((f) => f.id)).toEqual(["c", "a"]);
    expect(isOverdue(list[3]!, today)).toBe(false);
  });
  it("solo residente o admin cierran", () => {
    expect(allowedTransitions("to_review", "field")).toEqual(["in_correction"]);
    expect(allowedTransitions("to_review", "resident")).toEqual(["closed", "in_correction"]);
    expect(allowedTransitions("closed", "admin")).toEqual([]);
    expect(allowedTransitions("to_review", "director")).toEqual(["closed", "in_correction"]);
    expect(closeNoteError("ok")).toMatch(/al menos 5/);
    expect(closeNoteError("  Se reinstaló el pilote y quedó a plomo ")).toBeNull();
  });
});

describe("dibujo en el plano", () => {
  it("cierra el anillo y calcula el área", () => {
    expect(closeRing([[0, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(polygonFromTaps([[0, 0], [1, 0]])).toBeNull();
    const a = rectangleFromTaps([-74.0, 4.0], [-73.999, 4.001]); // ~111 m × 111 m
    expect(a.areaM2).toBeGreaterThan(12_000);
    expect(a.areaM2).toBeLessThan(12_500);
  });
  it("propone cantidad según la unidad", () => {
    expect(quantityFromArea("m²", 1234.567)).toBe(1234.57);
    expect(quantityFromArea("ha", 25_000)).toBe(2.5);
    expect(quantityFromArea("m3", 100)).toBeNull();
  });
});

describe("estado del plano", () => {
  const elements = [
    { id: "p1", code: "P-001", kind: "pile", qty: 1, geojson: '{"type":"Point","coordinates":[-74,4]}' },
    { id: "p2", code: "P-002", kind: "pile", qty: 1, geojson: '{"type":"Point","coordinates":[-74.001,4.001]}' },
    { id: "t1", code: "T-01", kind: "tracker", qty: 4, geojson: '{"type":"Polygon","coordinates":[[[-74,4],[-74.0005,4],[-74.0005,4.0002],[-74,4]]]}' },
    { id: "x", code: "X", kind: "other", qty: 1, geojson: null },
  ];
  it("colorea por estado y marca seleccionados", () => {
    const fc = buildElementsGeoJSON(elements, new Map([["p1", 1], ["t1", 2]]), new Set(["p2"]));
    expect(fc.features).toHaveLength(3);
    const props = Object.fromEntries(fc.features.map((f) => [f.id, f.properties as { status: string; selected: boolean }]));
    expect(props.p1!.status).toBe("done");
    expect(props.t1!.status).toBe("in_progress");
    expect(props.p2).toMatchObject({ status: "not_started", selected: true });
    expect(summarize(fc)).toEqual({ not_started: 1, in_progress: 1, done: 1 });
  });
  it("bbox", () => {
    expect(bboxOf([[-74, 4], [-74.001, 4.001]])).toEqual([-74.001, 4, -74, 4.001]);
    expect(bboxOf([])).toBeNull();
  });
});

describe("planos en el teléfono", () => {
  it("solo dibuja la última versión de cada plano", () => {
    const r = latestPlans([
      { id: "a1", name: "Layout general", version: 1 },
      { id: "h1", name: "Hincas Uno", version: 1 },
      { id: "a2", name: " layout GENERAL ", version: 2 },
      { id: "h0", name: "Hincas Uno", version: null },
    ]);
    expect(r.map((p) => p.id)).toEqual(["h1", "a2"]);
  });
});

describe("entregas de material y plan semanal", () => {
  it("la entrega sube sin la fecha de creación local; el plan y los materiales no se suben", () => {
    expect(toServerCall("material_deliveries", "PUT", "d1", { project_id: "p", material_id: "m", quantity: 5, created_at: "x", created_by: "u" })).toEqual({
      kind: "upsert",
      table: "material_deliveries",
      row: { id: "d1", project_id: "p", material_id: "m", quantity: 5, created_by: "u" },
    });
    for (const t of ["weekly_plans", "weekly_plan_items", "materials"]) expect(toServerCall(t, "PUT", "x", {}).kind).toBe("skip");
  });
});
