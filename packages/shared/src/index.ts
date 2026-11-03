import { z } from "zod";

// ---------- Enumeraciones de dominio (espejo de los enums de Postgres) ----------

export const Role = z.enum(["field", "resident", "director", "admin"]);
export type Role = z.infer<typeof Role>;

export const EntryStatus = z.enum(["draft", "submitted", "approved", "rejected"]);
export type EntryStatus = z.infer<typeof EntryStatus>;

export const LossCause = z.enum([
  "none",
  "weather",
  "material",
  "equipment",
  "permits",
  "labor",
  "design_client",
  "other",
]);
export type LossCause = z.infer<typeof LossCause>;

/** Causas imputables al cliente o fuerza mayor: alimentan los días reclamables. */
export const CLAIMABLE_CAUSES: readonly LossCause[] = ["weather", "permits", "design_client"];

export const Weather = z.enum(["sunny", "cloudy", "light_rain", "heavy_rain", "storm"]);
export type Weather = z.infer<typeof Weather>;

export const FindingType = z.enum(["quality", "safety", "environment", "operation"]);
export const Severity = z.enum(["low", "medium", "high", "critical"]);
export const FindingStatus = z.enum(["open", "in_correction", "to_review", "closed"]);
export type FindingType = z.infer<typeof FindingType>;
export type Severity = z.infer<typeof Severity>;
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Transiciones válidas del ciclo de vida de un hallazgo. */
export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  open: ["in_correction"],
  in_correction: ["to_review"],
  to_review: ["closed", "in_correction"],
  closed: [],
};

export const ElementKind = z.enum(["tracker", "pile", "table", "segment", "axis", "slab", "trench", "other"]);
export type ElementKind = z.infer<typeof ElementKind>;

// ---------- Geometría (GeoJSON mínimo, lon/lat WGS84) ----------

export const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const PolygonGeom = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(Position).min(4)),
});
export const PointGeom = z.object({ type: z.literal("Point"), coordinates: Position });
export type PolygonGeom = z.infer<typeof PolygonGeom>;

// ---------- Registros de campo ----------

const uuid = z.string().uuid();

export const ProgressEntryInput = z.object({
  id: uuid, // generado en el dispositivo (UUID v7) para que el registro exista offline
  project_id: uuid,
  front_id: uuid,
  activity_id: uuid,
  template_version_id: uuid.nullable(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().nonnegative(),
  effective_hours: z.number().min(0).max(24),
  lost_hours: z.number().min(0).max(24).default(0),
  loss_cause: LossCause.default("none"),
  // Varias causas en un registro; lost_hours es su suma y loss_cause la de más horas
  losses: z.array(z.object({ cause: LossCause.exclude(["none"]), hours: z.number().positive().max(24) })).default([]),
  weather: Weather.nullable(),
  crew_size: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).default(""),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  gps_accuracy_m: z.number().nullable(),
  values: z.record(z.unknown()).default({}), // respuestas del formato dinámico
  element_ids: z.array(uuid).default([]), // elementos tocados en el plano
  area: PolygonGeom.nullable().default(null), // área trabajada dibujada en el plano
  device_id: z.string(),
  client_created_at: z.string(),
});
export type ProgressEntryInput = z.infer<typeof ProgressEntryInput>;

export const FindingInput = z.object({
  id: uuid,
  project_id: uuid,
  front_id: uuid.nullable(),
  type: FindingType,
  severity: Severity,
  description: z.string().min(3).max(2000),
  responsible_user_id: uuid.nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
});
export type FindingInput = z.infer<typeof FindingInput>;

// ---------- Estado de sincronización (indicador visible) ----------

export type SyncState = "offline" | "syncing" | "synced";

export function syncLabel(state: SyncState, pending: number): string {
  switch (state) {
    case "offline":
      return pending > 0 ? `Sin conexión · ${pending} pendientes` : "Sin conexión";
    case "syncing":
      return `Sincronizando · ${pending} pendientes`;
    case "synced":
      return "Sincronizado";
  }
}
