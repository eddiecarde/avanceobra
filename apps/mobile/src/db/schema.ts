import { column, Schema, Table } from "@powersync/react-native";

/**
 * Esquema local (SQLite). Las tablas sincronizadas reflejan las columnas que entregan
 * las reglas de powersync/sync-rules.yaml; las `localOnly` nunca salen del dispositivo.
 * PowerSync agrega la columna `id` automáticamente.
 */

const projects = new Table({
  org_id: column.text,
  code: column.text,
  name: column.text,
  project_type: column.text,
  currency: column.text,
  start_date: column.text,
  contract_end_date: column.text,
  logo_path: column.text,
});

const memberships = new Table(
  // ai_enabled: el administrador le activó el asistente con IA en esa obra (1 = sí)
  { user_id: column.text, project_id: column.text, role: column.text, member_name: column.text, ai_enabled: column.integer },
  { indexes: { by_project: ["project_id"] } },
);

const profiles = new Table({ full_name: column.text, locale: column.text });

const fronts = new Table(
  { project_id: column.text, code: column.text, name: column.text, max_parallel_resources: column.integer },
  { indexes: { by_project: ["project_id"] } },
);

const activities = new Table(
  {
    project_id: column.text,
    front_id: column.text,
    code: column.text,
    name: column.text,
    unit: column.text,
    contract_qty: column.real,
    planned_start: column.text,
    planned_finish: column.text,
    template_id: column.text,
  },
  { indexes: { by_front: ["front_id"] } },
);

const elements = new Table(
  {
    project_id: column.text,
    front_id: column.text,
    activity_id: column.text,
    kind: column.text,
    code: column.text,
    qr_code: column.text,
    qty: column.real,
    geojson: column.text,
  },
  { indexes: { by_qr: ["qr_code"], by_project: ["project_id"] } },
);

/** Formatos editables de la empresa y sus versiones publicadas (JSON inmutable). */
const form_templates = new Table({
  org_id: column.text,
  name: column.text,
  category: column.text,
  work_type: column.text,
  current_version: column.integer,
  archived: column.integer,
});

const form_template_versions = new Table(
  { org_id: column.text, template_id: column.text, version: column.integer, schema: column.text },
  { indexes: { by_template: ["template_id", "version"] } },
);

const site_plans = new Table({
  project_id: column.text,
  front_id: column.text,
  name: column.text,
  version: column.integer,
  storage_path: column.text,
  source_format: column.text,
  corners: column.text, // JSON [[lon,lat] x4]
});

const progress_entries = new Table(
  {
    project_id: column.text,
    front_id: column.text,
    activity_id: column.text,
    template_version_id: column.text,
    work_date: column.text,
    quantity: column.real,
    effective_hours: column.real,
    lost_hours: column.real,
    loss_cause: column.text,
    // [{"cause":"weather","hours":2},{"cause":"material","hours":1}]
    losses: column.text,
    weather: column.text,
    crew_size: column.integer,
    notes: column.text,
    lat: column.real,
    lon: column.real,
    gps_accuracy_m: column.real,
    values: column.text, // JSON
    status: column.text,
    signature_path: column.text,
    created_by: column.text,
    approved_by: column.text,
    approved_at: column.text,
    rejection_reason: column.text,
    device_id: column.text,
    client_created_at: column.text,
    version: column.integer,
  },
  { indexes: { by_activity: ["activity_id", "work_date"], by_status: ["project_id", "status"] } },
);

const progress_areas = new Table(
  { project_id: column.text, entry_id: column.text, geojson: column.text, area_m2: column.real, is_approximate: column.integer },
  { indexes: { by_entry: ["entry_id"] } },
);

const entry_elements = new Table(
  { project_id: column.text, entry_id: column.text, element_id: column.text },
  { indexes: { by_element: ["element_id"] } },
);

const photos = new Table(
  {
    project_id: column.text,
    entry_id: column.text,
    finding_id: column.text,
    storage_path: column.text,
    taken_at: column.text,
    annotation: column.text,
    uploaded: column.integer, // el archivo local vive en documents/photos/{id}.jpg
    purpose: column.text, // avance, hallazgo (el "antes") o cierre (el "después")
  },
  { indexes: { by_entry: ["entry_id"], by_finding: ["finding_id"] } },
);

const findings = new Table(
  {
    project_id: column.text,
    front_id: column.text,
    type: column.text,
    severity: column.text,
    status: column.text,
    description: column.text,
    lat: column.real,
    lon: column.real,
    responsible_user_id: column.text,
    due_date: column.text,
    created_by: column.text,
    created_at: column.text,
    updated_at: column.text,
    closed_at: column.text,
    version: column.integer,
    base_version: column.integer, // solo local: versión leída antes de editar (detección de conflictos)
    verification_note: column.text, // nota de verificación del cierre
    // Calidad sin señal: clase (observación, NC, punch), impeditivo, actividad y empresa responsable
    category: column.text,
    impeditive: column.integer,
    activity_id: column.text,
    company_id: column.text,
    corrective_action: column.text,
    verified_at: column.text,
  },
  { indexes: { by_project: ["project_id", "status"] } },
);

/** Empresas del proyecto (responsable de cada NC o punch). Solo se descargan. */
const project_companies = new Table({ project_id: column.text, name: column.text, kind: column.text });

/** Listas de chequeo activas: items es el JSON [{id, text}]. Solo se descargan. */
const checklists = new Table({ project_id: column.text, name: column.text, activity_id: column.text, items: column.text, active: column.integer });

/**
 * Inspecciones hechas sin señal: solo se suben (la base de datos crea la inspección y sus NC).
 * payload es el JSON que recibe submit_inspection, con el id propio para no duplicar.
 */
const inspection_submissions = new Table({ project_id: column.text, payload: column.text, created_at: column.text }, { insertOnly: true });

/** Avisos personales (solo los míos): se marcan como leídos en el teléfono. */
const user_notifications = new Table(
  {
    user_id: column.text,
    project_id: column.text,
    kind: column.text,
    title: column.text,
    body: column.text,
    ref_table: column.text,
    ref_id: column.text,
    created_at: column.text,
    read_at: column.text,
  },
  { indexes: { by_user: ["user_id", "created_at"] } },
);

const alerts = new Table({
  project_id: column.text,
  kind: column.text,
  severity: column.text,
  title: column.text,
  body: column.text,
  ref_table: column.text,
  ref_id: column.text,
  created_at: column.text,
});

const sync_conflicts = new Table({
  project_id: column.text,
  table_name: column.text,
  row_id: column.text,
  server_values: column.text,
  client_values: column.text,
  client_user: column.text,
  server_user: column.text,
  resolved: column.integer,
  created_at: column.text,
});

/**
 * Parte diario: "solo inserción". Se escribe en el teléfono y sube con la cola; no se descarga
 * (cada envío es una fila nueva en el servidor y el informe toma el último).
 */
const daily_logs = new Table(
  {
    project_id: column.text,
    front_id: column.text,
    log_date: column.text,
    personnel: column.text, // JSON
    equipment: column.text, // JSON
    rain: column.text, // JSON
    observations: column.text,
    client_created_at: column.text,
  },
  { insertOnly: true },
);

/** Plan semanal comprometido (lo que toca hoy). Solo se descarga: lo arma el residente en la web. */
const weekly_plans = new Table({ project_id: column.text, week_start: column.text, status: column.text });
const weekly_plan_items = new Table(
  { plan_id: column.text, project_id: column.text, activity_id: column.text, planned_qty: column.real, responsible: column.text },
  { indexes: { by_plan: ["plan_id"] } },
);

/** Materiales del proyecto (se descargan) y sus entregas: el almacenista las registra en obra, también sin señal. */
const materials = new Table({ project_id: column.text, name: column.text, unit: column.text });
const material_deliveries = new Table(
  {
    project_id: column.text,
    material_id: column.text,
    delivered_on: column.text,
    quantity: column.real,
    document: column.text,
    supplier: column.text,
    notes: column.text,
    created_by: column.text,
    created_at: column.text,
  },
  { indexes: { by_material: ["material_id", "delivered_on"] } },
);

// ---------- Solo locales ----------

/** Borrador del parte diario por usuario, proyecto, frente y fecha; guarda también cuándo se envió. */
const daily_log_drafts = new Table(
  {
    user_id: column.text,
    project_id: column.text,
    front_id: column.text,
    log_date: column.text,
    data: column.text,
    updated_at: column.text,
    submitted_at: column.text,
  },
  { localOnly: true, indexes: { by_key: ["user_id", "project_id", "log_date"] } },
);

/** Catálogos del proyecto (cargos y equipos) leídos del servidor la última vez que hubo señal. */
const project_catalogs = new Table({ personnel_roles: column.text, equipment_types: column.text, updated_at: column.text }, { localOnly: true });

/** Cola de archivos (fotos, firmas) por subir a Storage con backoff exponencial. */
const file_queue = new Table(
  {
    bucket: column.text,
    storage_path: column.text,
    local_uri: column.text,
    content_type: column.text,
    photo_id: column.text,
    attempts: column.integer,
    next_attempt_at: column.text,
    last_error: column.text,
    created_at: column.text,
  },
  { localOnly: true },
);

/** Operaciones rechazadas definitivamente por el servidor (RLS, validación): se muestran al usuario. */
const upload_errors = new Table(
  { table_name: column.text, row_id: column.text, op: column.text, payload: column.text, error: column.text, created_at: column.text },
  { localOnly: true },
);

/** Borradores de captura (uno por usuario y actividad): se guardan solos mientras se escribe. */
const capture_drafts = new Table(
  { user_id: column.text, activity_id: column.text, front_id: column.text, data: column.text, updated_at: column.text },
  { localOnly: true, indexes: { by_user: ["user_id"] } },
);

/** Planos descargados al dispositivo. */
const plan_files = new Table({ local_uri: column.text, version: column.integer, downloaded_at: column.text }, { localOnly: true });

export const AppSchema = new Schema({
  projects,
  memberships,
  profiles,
  fronts,
  activities,
  elements,
  site_plans,
  form_templates,
  form_template_versions,
  progress_entries,
  progress_areas,
  entry_elements,
  photos,
  findings,
  project_companies,
  checklists,
  inspection_submissions,
  user_notifications,
  alerts,
  sync_conflicts,
  file_queue,
  upload_errors,
  plan_files,
  capture_drafts,
  daily_logs,
  daily_log_drafts,
  weekly_plans,
  weekly_plan_items,
  materials,
  material_deliveries,
  project_catalogs,
});

export type Database = (typeof AppSchema)["types"];
export type ProjectRow = Database["projects"];
export type FrontRow = Database["fronts"];
export type ActivityRow = Database["activities"];
export type ElementRow = Database["elements"];
export type EntryRow = Database["progress_entries"];
export type FindingRow = Database["findings"];
export type PhotoRow = Database["photos"];
export type FileQueueRow = Database["file_queue"];
