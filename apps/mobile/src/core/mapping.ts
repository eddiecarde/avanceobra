/**
 * Traducción de operaciones locales (cola CRUD de PowerSync) a llamadas a Supabase.
 * Es lógica pura para poder probarla sin dispositivo.
 *
 * - lat/lon locales → `location` en EWKT (PostGIS lo acepta directamente).
 * - geojson local de áreas → `geom` en EWKT.
 * - Columnas solo locales o generadas en el servidor se eliminan.
 * - Los PATCH de hallazgos van por RPC con `base_version` para detectar conflictos.
 */

export type OpKind = "PUT" | "PATCH" | "DELETE";

export type ServerCall =
  | { kind: "upsert"; table: string; row: Record<string, unknown> }
  | { kind: "update"; table: string; id: string; patch: Record<string, unknown> }
  | { kind: "delete"; table: string; id: string }
  | { kind: "rpc"; fn: string; args: Record<string, unknown> }
  | { kind: "skip"; reason: string };

/** Columnas que existen solo en el dispositivo o que el servidor calcula. */
const STRIP: Record<string, string[]> = {
  progress_entries: ["lat", "lon", "version"],
  findings: ["lat", "lon", "version", "base_version", "created_at", "updated_at", "closed_at", "verified_at"],
  // Del aviso solo se sube que se leyó
  user_notifications: ["user_id", "project_id", "kind", "title", "body", "ref_table", "ref_id", "created_at"],
  progress_areas: ["geojson", "area_m2"],
  material_deliveries: ["created_at"],
  memberships: [],
};

/** Tablas que el móvil nunca modifica (se descargan, no se suben). Frentes y actividades sí suben:
 *  el administrador puede crearlos en campo y el servidor lo valida con RLS. */
const READ_ONLY = new Set(["projects", "memberships", "profiles", "elements", "site_plans", "form_templates", "form_template_versions", "project_companies", "checklists", "weekly_plans", "weekly_plan_items", "materials"]);

/** Columnas JSON guardadas como texto en SQLite. */
const JSON_COLUMNS: Record<string, string[]> = { progress_entries: ["values"], daily_logs: ["personnel", "equipment", "rain"] };

export function pointEwkt(lat: unknown, lon: unknown): string | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export function polygonEwkt(geojson: string): string {
  const g = JSON.parse(geojson) as { type: string; coordinates: number[][][] };
  if (g.type !== "Polygon") throw new Error(`Se esperaba Polygon y llegó ${g.type}`);
  const rings = g.coordinates.map((ring) => `(${ring.map(([x, y]) => `${x} ${y}`).join(", ")})`);
  return `SRID=4326;POLYGON(${rings.join(", ")})`;
}

function transform(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if ("lat" in data || "lon" in data) {
    if (table === "progress_entries" || table === "findings") out.location = pointEwkt(data.lat, data.lon);
  }
  if (table === "progress_areas" && typeof data.geojson === "string") out.geom = polygonEwkt(data.geojson);
  if (table === "progress_areas" && "is_approximate" in data) out.is_approximate = Boolean(data.is_approximate);
  if (table === "photos" && "uploaded" in data) out.uploaded = Boolean(data.uploaded);
  if (table === "findings" && "impeditive" in data) out.impeditive = Boolean(data.impeditive);
  for (const c of JSON_COLUMNS[table] ?? []) if (typeof out[c] === "string") out[c] = JSON.parse(out[c] as string);
  for (const c of STRIP[table] ?? []) delete out[c];
  return out;
}

export function toServerCall(
  table: string,
  op: OpKind,
  id: string,
  opData: Record<string, unknown> | undefined,
  /** Versión leída por el dispositivo antes de editar (solo hallazgos). */
  baseVersion?: number | null,
): ServerCall {
  if (READ_ONLY.has(table)) return { kind: "skip", reason: `${table} es de solo lectura en el móvil` };
  const data = opData ?? {};
  // Inspección hecha sin señal: se registra con la RPC (crea la inspección y sus NC en el servidor)
  if (table === "inspection_submissions") {
    if (op !== "PUT" || typeof data.payload !== "string") return { kind: "skip", reason: "inspección sin datos" };
    return { kind: "rpc", fn: "submit_inspection", args: { p: JSON.parse(data.payload) } };
  }
  switch (op) {
    case "PUT":
      return { kind: "upsert", table, row: { ...transform(table, data), id } };
    case "PATCH": {
      const patch = transform(table, data);
      if (Object.keys(patch).length === 0) return { kind: "skip", reason: "sin cambios para el servidor" };
      if (table === "findings")
        return { kind: "rpc", fn: "update_finding_synced", args: { p_id: id, p_patch: patch, p_base_version: baseVersion ?? null } };
      return { kind: "update", table, id, patch };
    }
    case "DELETE":
      return { kind: "delete", table, id };
  }
}

/**
 * Errores de Postgres/PostgREST que no se arreglan reintentando: violaciones de
 * restricciones, datos inválidos, RLS, excepciones de triggers (p. ej. registro aprobado).
 * Se descartan de la cola y se muestran al usuario para que no bloqueen el resto.
 */
export function isPermanentError(err: { code?: string; status?: number } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (/^(22|23)/.test(code)) return true; // datos inválidos / integridad
  if (code === "42501" || code === "P0001" || code === "P0002") return true; // RLS / raise exception
  if (code.startsWith("PGRST") && err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429)
    return true;
  return false;
}
