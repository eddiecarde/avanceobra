"use client";

import { entryLossLines, type DailyQuantity, type LossLine, type LossRecord, type ScheduleActivity, type SubfieldPlan, type WorkCalendar } from "@avanceobra/engine";
import { DEFAULT_WORKDAY, effectiveDaily, type Resource } from "./library";
import { projectLogo } from "./logo";
import { supabase } from "./supabase";

export const LOSS_LABEL: Record<string, string> = {
  weather: "Clima",
  material: "Material",
  equipment: "Equipo",
  permits: "Permisos",
  labor: "Personal",
  design_client: "Diseño/Cliente",
  other: "Otra",
};
export const FINDING_TYPE_LABEL: Record<string, string> = { quality: "Calidad", safety: "Seguridad (SST)", environment: "Ambiental", operation: "Operación" };
export const SEVERITY_LABEL: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
export const FINDING_STATUS_LABEL: Record<string, string> = { open: "Abierto", in_correction: "En corrección", to_review: "Por revisar", closed: "Cerrado" };
export const WEATHER_LABEL: Record<string, string> = { sunny: "Soleado", cloudy: "Nublado", light_rain: "Llovizna", heavy_rain: "Lluvia", storm: "Tormenta" };
export const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface ReportHeader {
  /** Logo de la obra o de la empresa (URL pública), para informes y actas. */
  logoUrl?: string | null;
  clientName: string | null;
  contractorName: string | null;
  contractCode: string | null;
  reportCode: string | null;
  signers: string[];
}

export interface DashActivity extends ScheduleActivity {
  frontId: string;
  /** Empresa responsable (contratista o subcontratista), si se asignó. */
  companyId: string | null;
  /** Subcampo y circuito (planta solar), si se asignaron. */
  subfield: string | null;
  circuit: string | null;
  /** Grupo de trabajo del planning (Hincas, Módulos…), si se importó. */
  workGroup: string | null;
  frontCode: string;
  frontName: string;
}

export interface DashEntry {
  id: string;
  activityId: string;
  workDate: string;
  quantity: number;
  effectiveHours: number;
  lostHours: number;
  lossCause: string;
  /** Pérdidas por causa (un registro puede tener varias); siempre al menos la de lostHours/lossCause. */
  losses: LossLine[];
  weather: string | null;
  crewSize: number;
  notes: string;
  status: string;
  createdBy: string;
}

export interface DashFinding {
  id: string;
  frontId: string | null;
  type: string;
  severity: string;
  status: string;
  description: string;
  lat: number | null;
  lon: number | null;
  dueDate: string | null;
  /** Fechas locales (YYYY-MM-DD). */
  createdAt: string;
  closedAt: string | null;
  /** Observación, no conformidad o punch; impeditivo = no deja avanzar o entregar. */
  category: string;
  impeditive: boolean;
  activityId: string | null;
  companyId: string | null;
}

export interface DashElement {
  id: string;
  code: string;
  kind: string;
  qty: number;
  activityId: string | null;
  geometry: GeoJSON.Geometry;
}

export interface DashCompany {
  id: string;
  name: string;
  kind: "contratista" | "subcontratista";
}

export interface DashData {
  project: {
    id: string;
    name: string;
    startDate: string | null;
    contractEnd: string | null;
    /** Municipio o sitio de la obra (vacío en el enlace compartido). */
    locationName: string | null;
    /** Cómo se llaman las zonas (Subcampo, Tramo, Bloque…); null = "Zona" o "Frente". */
    zoneLabel: string | null;
    calendar: WorkCalendar;
    header: ReportHeader;
    /** Catálogos del parte diario (orden de presentación en el informe semanal). */
    personnelRoles: string[];
    equipmentTypes: string[];
  };
  activities: DashActivity[];
  /** Contratista y subcontratistas del proyecto (vacío en el enlace compartido). */
  companies: DashCompany[];
  daily: DailyQuantity[];
  entries: DashEntry[];
  /** Pérdidas con rendimiento y costo horario del recurso parado (para el Pareto por cantidad o costo). */
  losses: (LossRecord & { activityId: string; date: string })[];
  findings: DashFinding[];
  elements: DashElement[];
  /** Vínculos registro → elemento ejecutado. */
  elementLinks: { elementId: string; activityId: string; date: string }[];
  areas: { id: string; activityId: string; date: string; approved: boolean; areaM2: number; geometry: GeoJSON.Geometry }[];
  plan: { url: string; corners: [number, number][] } | null;
  /** Subcampos con circuito, posición y energización planeada (vacío si no es una planta por subcampos). */
  subfields: SubfieldPlan[];
  /** Líneas base guardadas (p. ej. contractual): fechas por actividad. */
  baselines: { name: string; dates: Record<string, { start: string | null; finish: string | null }> }[];
}

const parseGeo = (s: string | null): GeoJSON.Geometry | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as GeoJSON.Geometry;
  } catch {
    return null;
  }
};

/**
 * Lee todas las filas de una consulta en páginas de 1.000 (el servidor no devuelve más por consulta):
 * una obra grande tiene miles de actividades y registros.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  // Páginas de 4 en 4 en paralelo: con miles de registros, pedirlas una tras otra suma segundos
  const out: T[] = [];
  for (let from = 0; ; from += size * PARALLEL) {
    const pages = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => page(from + i * size, from + (i + 1) * size - 1)));
    for (const { data, error } of pages) {
      if (error) return { data: out, error };
      out.push(...(data ?? []));
      if (!data || data.length < size) return { data: out, error: null };
    }
  }
}
const PARALLEL = 4;

/** Todo lo que necesita el dashboard de un proyecto, en una sola carga (lecturas en paralelo, con RLS). */
export async function loadDashboard(projectId: string): Promise<DashData> {
  const [p, acts, entries, ar, fnd, els, links, areas, plans, cos, sfs, bls] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, location_name, zone_label, start_date, contract_end_date, workdays, holidays, colombian_holidays, client_name, contractor_name, contract_code, report_code, report_signers, personnel_roles, equipment_types, logo_path, org:organizations(logo_path)",
      )
      .eq("id", projectId)
      .single(),
    fetchAll((a, b) =>
      supabase
        .from("activities")
        .select("id, code, name, unit, contract_qty, planned_start, planned_finish, weight, company_id, subfield, circuit, work_group, front_id, front:fronts(code, name)")
        .eq("project_id", projectId)
        .order("code")
        .order("id")
        .range(a, b),
    ),
    fetchAll((a, b) =>
      supabase
        .from("progress_entries")
        .select("id, activity_id, work_date, quantity, effective_hours, lost_hours, loss_cause, losses, weather, crew_size, notes, status, created_by")
        .eq("project_id", projectId)
        .in("status", ["submitted", "approved"])
        .order("work_date")
        .order("id")
        .range(a, b),
    ),
    supabase.from("activity_resources").select("activity_id, units, resource:resource_catalog(*)").eq("project_id", projectId),
    supabase
      .from("findings")
      .select("id, front_id, type, severity, status, description, lat, lon, due_date, created_at, closed_at, category, impeditive, activity_id, company_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase.from("elements").select("id, code, kind, qty, activity_id, geojson").eq("project_id", projectId).not("geojson", "is", null),
    supabase.from("entry_elements").select("element_id, entry:progress_entries!inner(activity_id, work_date, status)").eq("project_id", projectId),
    supabase.from("progress_areas").select("id, geojson, area_m2, entry:progress_entries!inner(activity_id, work_date, status)").eq("project_id", projectId),
    supabase.from("site_plans").select("storage_path, corners").eq("project_id", projectId).not("corners", "is", null).order("version", { ascending: false }).limit(1),
    supabase.from("project_companies").select("id, name, kind").eq("project_id", projectId).order("kind").order("name"),
    supabase
      .from("project_subfields")
      .select("code, name, circuit, position, energization_order, planned_energization, baseline_energization")
      .eq("project_id", projectId)
      .order("code"),
    fetchAll((a, b) =>
      supabase.from("activity_baselines").select("activity_id, baseline, start, finish").eq("project_id", projectId).order("activity_id").order("baseline").range(a, b),
    ),
  ]);
  if (p.error) throw new Error(p.error.message);

  let plan: DashData["plan"] = null;
  const sp = plans.data?.[0];
  if (sp?.corners) {
    const signed = await supabase.storage.from("plans").createSignedUrl(sp.storage_path, 3600);
    if (signed.data?.signedUrl && /\.(png|jpe?g)$/i.test(sp.storage_path)) plan = { url: signed.data.signedUrl, corners: sp.corners as [number, number][] };
  }
  return buildDashData(
    {
      project: p.data,
      activities: acts.data ?? [],
      entries: entries.data ?? [],
      resources: (ar.data ?? []) as unknown as RawDash["resources"],
      findings: fnd.data ?? [],
      elements: els.data ?? [],
      element_links: (links.data ?? []) as unknown as RawDash["element_links"],
      areas: (areas.data ?? []) as unknown as RawDash["areas"],
      companies: (cos.data ?? []) as DashCompany[],
      subfields: sfs.data ?? [],
      baselines: bls.data ?? [],
    },
    plan,
  );
}

/** Filas tal como llegan de Supabase (consultas con sesión o función del enlace compartido). */
export interface RawDash {
  project: {
    id: string;
    name: string;
    start_date: string | null;
    contract_end_date: string | null;
    workdays: number[] | null;
    holidays: string[] | null;
    colombian_holidays?: boolean | null;
    client_name?: string | null;
    location_name?: string | null;
    zone_label?: string | null;
    contractor_name?: string | null;
    contract_code?: string | null;
    report_code?: string | null;
    report_signers?: string[] | null;
    personnel_roles?: string[] | null;
    equipment_types?: string[] | null;
    logo_path?: string | null;
    org?: unknown;
  };
  activities: {
    id: string;
    code: string;
    name: string;
    unit: string;
    contract_qty: number;
    planned_start: string | null;
    planned_finish: string | null;
    weight?: number | null;
    company_id?: string | null;
    subfield?: string | null;
    circuit?: string | null;
    work_group?: string | null;
    front_id: string;
    front: unknown;
  }[];
  subfields?: { code: string; name: string; circuit: string | null; position: string | null; energization_order: number | null; planned_energization: string | null; baseline_energization: string | null }[];
  baselines?: { activity_id: string; baseline: string; start: string | null; finish: string | null }[];
  companies?: DashCompany[];
  entries: {
    id: string;
    activity_id: string;
    work_date: string;
    quantity: number;
    effective_hours: number;
    lost_hours: number;
    loss_cause: string;
    weather: string | null;
    crew_size: number;
    status: string;
    notes?: string | null;
    losses?: LossLine[] | null;
    created_by?: string | null;
  }[];
  resources: { activity_id: string; units: number; resource: Resource | null }[];
  findings: {
    id: string;
    front_id: string | null;
    type: string;
    severity: string;
    status: string;
    description: string;
    lat: number | null;
    lon: number | null;
    due_date: string | null;
    created_at: string;
    closed_at: string | null;
    category?: string | null;
    impeditive?: boolean | null;
    activity_id?: string | null;
    company_id?: string | null;
  }[];
  elements: { id: string; code: string; kind: string; qty: number; activity_id: string | null; geojson: string | null }[];
  element_links: { element_id: string; entry: { activity_id: string; work_date: string; status: string } }[];
  areas: { id: string; geojson: string; area_m2: number; entry: { activity_id: string; work_date: string; status: string } }[];
}

export interface SharedLinkInfo {
  label: string;
  expiresAt: string;
  includeFindings: boolean;
}

/** Dashboard de solo lectura por enlace: sin sesión, sin costos, sin notas ni fotos, sin plano de fondo. */
export async function loadSharedDashboard(token: string): Promise<{ data: DashData; link: SharedLinkInfo }> {
  const { data, error } = await supabase.rpc("shared_dashboard", { p_token: token });
  if (error) throw new Error(/no válido|vencido|revocado/i.test(error.message) ? "Este enlace no es válido, venció o fue revocado." : error.message);
  const raw = data as Omit<RawDash, "resources"> & { link: { label: string; expires_at: string; include_findings: boolean } };
  return {
    data: buildDashData({ ...raw, resources: [] }, null),
    link: { label: raw.link.label, expiresAt: raw.link.expires_at, includeFindings: raw.link.include_findings },
  };
}

/** Calendario laboral del proyecto: días de la semana, festivos propios y (opcional) los de Colombia. */
export function projectCalendar(p: Pick<RawDash["project"], "workdays" | "holidays" | "colombian_holidays">): WorkCalendar {
  return { workdays: p.workdays ?? undefined, holidays: p.holidays ?? [], colombianHolidays: p.colombian_holidays !== false };
}

export function buildDashData(raw: RawDash, plan: DashData["plan"]): DashData {
  const activities: DashActivity[] = raw.activities.map((a) => {
    const front = a.front as unknown as { code: string; name: string } | null;
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      contractQty: Number(a.contract_qty),
      plannedStart: a.planned_start,
      plannedFinish: a.planned_finish,
      weight: a.weight == null ? undefined : Number(a.weight),
      frontId: a.front_id,
      companyId: a.company_id ?? null,
      subfield: a.subfield ?? null,
      circuit: a.circuit ?? null,
      workGroup: a.work_group ?? null,
      frontCode: front?.code ?? "",
      frontName: front?.name ?? "",
    };
  });

  const ents: DashEntry[] = raw.entries.map((e) => ({
    id: e.id,
    activityId: e.activity_id,
    workDate: e.work_date,
    quantity: Number(e.quantity),
    effectiveHours: Number(e.effective_hours),
    lostHours: Number(e.lost_hours),
    lossCause: e.loss_cause,
    losses: entryLossLines({ lostHours: Number(e.lost_hours), lossCause: e.loss_cause, losses: e.losses }),
    weather: e.weather,
    crewSize: Number(e.crew_size),
    notes: e.notes ?? "",
    status: e.status,
    createdBy: e.created_by ?? "",
  }));

  // Rendimiento horario y costo horario parado del recurso principal de cada actividad
  const perActivity = new Map<string, { hourlyRate: number; idleCostPerHour: number }>();
  for (const x of raw.resources) {
    if (!x.resource) continue;
    const r = x.resource;
    const prev = perActivity.get(x.activity_id) ?? { hourlyRate: 0, idleCostPerHour: 0 };
    const units = Number(x.units) || 1;
    perActivity.set(x.activity_id, {
      hourlyRate: prev.hourlyRate + (effectiveDaily(r, DEFAULT_WORKDAY) / DEFAULT_WORKDAY.effectiveHours) * units,
      // Parado se sigue pagando alquiler y operador (no combustible)
      idleCostPerHour: prev.idleCostPerHour + (Number(r.cost_per_hour) + Number(r.operator_cost_per_hour)) * units,
    });
  }

  const elementLinks = raw.element_links
    .filter((l) => l.entry.status === "submitted" || l.entry.status === "approved")
    .map((l) => ({ elementId: l.element_id, activityId: l.entry.activity_id, date: l.entry.work_date }));

  const prj = raw.project;
  return {
    project: {
      id: prj.id,
      name: prj.name,
      startDate: prj.start_date,
      contractEnd: prj.contract_end_date,
      locationName: prj.location_name ?? null,
      zoneLabel: prj.zone_label ?? null,
      calendar: projectCalendar(prj),
      header: {
        logoUrl: projectLogo(prj),
        clientName: prj.client_name ?? null,
        contractorName: prj.contractor_name ?? null,
        contractCode: prj.contract_code ?? null,
        reportCode: prj.report_code ?? null,
        signers: prj.report_signers ?? ["Residente de obra", "Director de obra", "Interventoría"],
      },
      personnelRoles: prj.personnel_roles ?? [],
      equipmentTypes: prj.equipment_types ?? [],
    },
    activities,
    companies: raw.companies ?? [],
    daily: ents.map((e) => ({ activityId: e.activityId, date: e.workDate, quantity: e.quantity })),
    entries: ents,
    // Una fila por causa: un registro con 2 h de clima y 1 h de material suma a las dos barras del Pareto
    losses: ents.flatMap((e) => e.losses.map((l) => ({ cause: l.cause, lostHours: l.hours, activityId: e.activityId, date: e.workDate, ...perActivity.get(e.activityId) }))),
    findings: raw.findings.map((f) => ({
      id: f.id,
      frontId: f.front_id,
      type: f.type,
      severity: f.severity,
      status: f.status,
      description: f.description,
      lat: f.lat,
      lon: f.lon,
      dueDate: f.due_date,
      createdAt: localDate(f.created_at),
      closedAt: f.closed_at ? localDate(f.closed_at) : null,
      category: f.category ?? "observacion",
      impeditive: f.impeditive ?? false,
      activityId: f.activity_id ?? null,
      companyId: f.company_id ?? null,
    })),
    elements: raw.elements.flatMap((e) => {
      const g = parseGeo(e.geojson);
      return g ? [{ id: e.id, code: e.code, kind: e.kind, qty: Number(e.qty), activityId: e.activity_id, geometry: g }] : [];
    }),
    elementLinks,
    areas: raw.areas.flatMap((a) => {
      const g = parseGeo(a.geojson);
      return g && a.entry.status !== "rejected" && a.entry.status !== "draft"
        ? [{ id: a.id, activityId: a.entry.activity_id, date: a.entry.work_date, approved: a.entry.status === "approved", areaM2: Number(a.area_m2), geometry: g }]
        : [];
    }),
    plan,
    subfields: (raw.subfields ?? []).map((s) => ({
      code: s.code,
      name: s.name,
      circuit: s.circuit,
      position: s.position === "cabecera" || s.position === "cuerpo" || s.position === "cola" ? s.position : null,
      order: s.energization_order,
      planned: s.planned_energization,
      baseline: s.baseline_energization,
    })),
    baselines: [...new Set((raw.baselines ?? []).map((b) => b.baseline))].map((name) => ({
      name,
      dates: Object.fromEntries((raw.baselines ?? []).filter((b) => b.baseline === name).map((b) => [b.activity_id, { start: b.start, finish: b.finish }])),
    })),
  };
}

/** Fecha local (no UTC) en formato YYYY-MM-DD: el corte del día es el de la obra. */
export const localToday = () => localDate(new Date());

/** Fecha local de un instante (timestamptz en UTC → día de la obra). */
export const localDate = (t: string | Date) => {
  const d = typeof t === "string" ? new Date(t) : t;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toLocaleString("es-CO", { maximumFractionDigits: digits })} %`;
