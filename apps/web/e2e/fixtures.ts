import { USER, type MockDb, type Row } from "./mock";

/**
 * Obra de prueba: "Parque Solar Prueba" con dos frentes y cuatro actividades, avance de los
 * últimos días, hallazgos, plano con pilotes, parte diario, un ensayo y una restricción.
 * Las fechas se calculan desde hoy (hora de Colombia) para que el dashboard siempre tenga datos.
 */
export const PROJECT_ID = "11111111-1111-4111-8111-000000000001";
export const FRONT_A = "22222222-2222-4222-8222-00000000000a";
export const FRONT_B = "22222222-2222-4222-8222-00000000000b";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
export const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const TODAY = today;

export function buildDb(role: "admin" | "resident" | "field" = "admin"): MockDb {
  const fronts = [
    { id: FRONT_A, project_id: PROJECT_ID, code: "BA", name: "Bloque A", max_parallel_resources: 4 },
    { id: FRONT_B, project_id: PROJECT_ID, code: "BB", name: "Bloque B", max_parallel_resources: 4 },
  ];
  const act = (id: string, front: (typeof fronts)[number], code: string, name: string, unit: string, qty: number, start: number, finish: number, weight: number | null = null) => ({
    id,
    project_id: PROJECT_ID,
    front_id: front.id,
    front: { code: front.code, name: front.name, max_parallel_resources: 4 },
    code,
    name,
    unit,
    contract_qty: qty,
    planned_start: day(start),
    planned_finish: day(finish),
    predecessors: [],
    external_ref: null,
    weight,
  });
  const activities = [
    act("a1", fronts[0]!, "BA-HIN", "Hincado de pilotes", "pilotes", 200, -20, 10),
    act("a2", fronts[0]!, "BA-MON", "Montaje de trackers", "trackers", 20, -10, 20),
    act("a3", fronts[1]!, "BB-HIN", "Hincado de pilotes", "pilotes", 200, -15, 15),
    act("a4", fronts[1]!, "BB-ZAN", "Zanjas DC", "m", 600, -5, 25),
  ];
  const entries: Row[] = [];
  let n = 0;
  for (let i = -14; i <= 0; i++) {
    const add = (activity: string, front: string, qty: number, extra: Row = {}) =>
      entries.push({
        id: `e${++n}`,
        project_id: PROJECT_ID,
        front_id: front,
        activity_id: activity,
        work_date: day(i),
        quantity: qty,
        effective_hours: 8,
        lost_hours: 0,
        loss_cause: "none",
        weather: "sunny",
        crew_size: 6,
        notes: "",
        // Los dos últimos días del hincado BA-HIN siguen por aprobar
        status: activity === "a1" && i >= -1 ? "submitted" : "approved",
        created_by: USER.id,
        version: 1,
        rejection_reason: null,
        ...extra,
      });
    add("a1", FRONT_A, 8);
    if (i > -8) add("a2", FRONT_A, 0.5);
    add("a3", FRONT_B, 3, i === -2 ? { lost_hours: 3, loss_cause: "weather", weather: "heavy_rain" } : i === -1 ? { lost_hours: 1, loss_cause: "material" } : {});
  }
  const elements = Array.from({ length: 12 }, (_, i) => ({
    id: `el${i}`,
    project_id: PROJECT_ID,
    code: `A-P${i + 1}`,
    kind: "pile",
    qty: 1,
    activity_id: "a1",
    geojson: JSON.stringify({ type: "Point", coordinates: [-73.65 + i * 0.0001, 9.95] }),
  }));
  const entry_elements = elements.slice(0, 6).map((e, i) => ({ element_id: e.id, project_id: PROJECT_ID, entry: { activity_id: "a1", work_date: day(-6 + i), status: "approved" } }));
  const findings = [
    { id: "f1", project_id: PROJECT_ID, front_id: FRONT_A, type: "safety", severity: "critical", status: "open", description: "Zanja sin señalizar", lat: 9.95, lon: -73.65, due_date: day(-3), created_at: `${day(-5)}T15:00:00Z`, closed_at: null, category: "observacion", impeditive: false, activity_id: null, element_id: null, company_id: null },
    { id: "f2", project_id: PROJECT_ID, front_id: FRONT_B, type: "quality", severity: "medium", status: "open", description: "Pilote fuera de plomo", lat: null, lon: null, due_date: day(3), created_at: `${day(-1)}T15:00:00Z`, closed_at: null, category: "observacion", impeditive: false, activity_id: null, element_id: null, company_id: null },
  ];
  const project = {
    id: PROJECT_ID,
    org_id: "org1",
    code: "PSP",
    name: "Parque Solar Prueba",
    currency: "COP",
    start_date: day(-20),
    contract_end_date: day(30),
    workdays: [1, 2, 3, 4, 5, 6],
    holidays: [],
    colombian_holidays: true,
    client_name: "HELIOS",
    contractor_name: "CNX",
    contract_code: "CNX-PRUEBA-001",
    report_code: "CNX-PRB-001",
    report_signers: ["Residente civil", "Director de obra", "Interventoría"],
    personnel_roles: ["Oficial de obra", "Auxiliar de obra"],
    equipment_types: ["Hincadora"],
  };
  const tables: Record<string, Row[]> = {
    memberships: [{ user_id: USER.id, project_id: PROJECT_ID, org_id: "org1", role, project: { id: PROJECT_ID, code: "PSP", name: project.name, org_id: "org1" } }],
    projects: [project],
    fronts,
    activities,
    progress_entries: entries,
    activity_resources: [],
    findings,
    elements,
    entry_elements,
    progress_areas: [],
    site_plans: [],
    photos: [],
    daily_log_latest: [
      { project_id: PROJECT_ID, log_date: day(-1), personnel: [{ role: "Oficial de obra", qty: 4 }, { role: "Auxiliar de obra", qty: 8 }], equipment: [{ name: "Hincadora", qty: 2 }], rain: [{ start: "10:00", end: "10:45" }], observations: "Lluvia corta" },
    ],
    lab_tests: [{ id: "t1", project_id: PROJECT_ID, activity_id: "a4", name: "Densidad en campo", standard: "INV E-161", sample_date: day(-2), sent_date: day(-1), lab: "Lab. Costa", status: "enviado", result: null, observation: null, updated_at: `${day(-1)}T15:00:00Z` }],
    project_constraints: [{ id: "c1", project_id: PROJECT_ID, activity_id: null, description: "Falta permiso de servidumbre", responsible: "Cliente", need_by: day(2), status: "abierta", released_at: null, created_at: `${day(-3)}T15:00:00Z` }],
    share_links: [],
    simulations: [],
    contracts: [{ project_id: PROJECT_ID, contract_value: 5_000_000_000, contract_end_date: day(30), penalty_mode: "amount", penalty_per_day: 20_000_000, penalty_percent_per_day: 0, penalty_cap_percent: 0.1, early_bonus_per_day: 0, daily_indirect_cost: 15_000_000, annual_discount_rate: null, claimable_causes: ["weather", "permits", "design_client"] }],
    cost_settings: [{ project_id: PROJECT_ID, expected_rework_pct: 0.02, inspection_cost_per_day: 500_000, labor_cost_per_hour: 15000 }],
    cost_records: [],
    import_runs: [],
    alerts: [
      { id: "al1", project_id: PROJECT_ID, kind: "productivity_drop", severity: "high", title: "Baja la productividad", body: "BB-HIN · Hincado de pilotes: 0,06 pilotes por hora-hombre esta semana contra 0,1 antes (−40 %).", created_at: `${day(0)}T11:00:00Z` },
    ],
    activity_progress: activities.map((a) => ({ activity_id: a.id, project_id: PROJECT_ID, executed_qty: entries.filter((e) => e.activity_id === a.id).reduce((s, e) => s + Number(e.quantity), 0) })),
    activity_daily_output: entries.map((e) => ({ project_id: PROJECT_ID, activity_id: e.activity_id, work_date: e.work_date, quantity: e.quantity })),
    resource_catalog: [],
    form_templates: [],
  };
  const sharedDashboard = (args: Record<string, unknown>) => {
    if (args.p_token !== "token-valido") throw new Error("Enlace no válido, vencido o revocado");
    return {
      link: { label: "Interventoría", expires_at: `${day(30)}T00:00:00Z`, include_findings: true },
      project,
      activities,
      // Como la función real: sin notas de campo ni autores
      entries: entries.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "notes" && k !== "created_by"))),
      findings,
      elements,
      element_links: entry_elements,
      areas: [],
    };
  };
  const team = [
    { user_id: USER.id, name: "Eddie Cárdenas", email: USER.email, role: "admin", telegram_linked: true, last_sign_in_at: `${day(0)}T12:00:00Z`, must_change_password: false },
    { user_id: "u-marta", name: "Marta", email: "marta@obra.test", role: "field", telegram_linked: false, last_sign_in_at: null, must_change_password: false },
  ];
  // Equipo: la RPC lo lee de las membresías simuladas, así un cambio de rol se ve al recargar
  tables.memberships!.push({ user_id: "u-marta", project_id: PROJECT_ID, org_id: "org1", role: "field", company_id: null });
  tables.memberships![0]!.company_id = "co-contratista";
  tables.project_companies = [{ id: "co-contratista", project_id: PROJECT_ID, name: "Constructora Demo", kind: "contratista" }];
  // El montaje de trackers (BA-MON) es del contratista; el resto aún sin empresa
  tables.activities!.find((a) => a.code === "BA-MON")!.company_id = "co-contratista";
  // Costo directo presupuestado del hincado BA-HIN: $50.000 por pilote
  tables.activities!.find((a) => a.code === "BA-HIN")!.budget_unit_cost = 50000;
  // Subcampos y circuitos para los filtros del centro de control
  Object.assign(tables.activities!.find((a) => a.code === "BA-HIN")!, { subfield: "SC-01", circuit: "C-01" });
  Object.assign(tables.activities!.find((a) => a.code === "BB-HIN")!, { subfield: "SC-02", circuit: "C-02" });
  const projectTeam = () =>
    team
      .map((m) => {
        const ms = tables.memberships!.find((x) => x.user_id === m.user_id);
        return { ...m, role: (ms?.role as string) ?? m.role, name: (ms?.member_name as string) ?? m.name, company_id: (ms?.company_id as string | null) ?? null };
      })
      .filter((m) => tables.memberships!.some((x) => x.user_id === m.user_id));
  // Correcciones: como las funciones de la base (solo de aprobados, una pendiente por registro)
  tables.entry_corrections = [];
  const snap = (e: Row) => ({ quantity: e.quantity, work_date: e.work_date, effective_hours: e.effective_hours, lost_hours: e.lost_hours, loss_cause: e.loss_cause, crew_size: e.crew_size, notes: e.notes });
  const requestCorrection = (a: Record<string, unknown>) => {
    const e = tables.progress_entries!.find((x) => x.id === a.p_entry)!;
    if (e.status !== "approved") throw new Error("Solo se piden correcciones de registros aprobados");
    if (tables.entry_corrections!.some((c) => c.entry_id === e.id && c.status === "pendiente")) throw new Error("Este registro ya tiene una corrección pendiente");
    const id = `cor${tables.entry_corrections!.length + 1}`;
    tables.entry_corrections!.push({ id, project_id: PROJECT_ID, entry_id: e.id, reason: a.p_reason, previous: snap(e), proposed: { ...snap(e), ...(a.p_changes as Row) }, status: "pendiente", requested_by: "u-marta", requested_at: `${day(0)}T14:00:00Z`, decided_by: null, decided_at: null, decision_note: null, result_version: null });
    return id;
  };
  const decideCorrection = (a: Record<string, unknown>) => {
    const c = tables.entry_corrections!.find((x) => x.id === a.p_id)!;
    if (!a.p_approve && !String(a.p_note ?? "").trim()) throw new Error("Explica por qué se rechaza");
    const e = tables.progress_entries!.find((x) => x.id === c.entry_id)!;
    if (a.p_approve) Object.assign(e, c.proposed, { version: Number(e.version) + 1 });
    Object.assign(c, { status: a.p_approve ? "aprobada" : "rechazada", decided_by: USER.id, decided_at: `${day(0)}T15:00:00Z`, decision_note: a.p_note ?? null, result_version: a.p_approve ? e.version : null });
    return e.version;
  };
  // Calidad: listas, plan de inspección e inspecciones (cada "no cumple" abre una NC, como en la base)
  tables.checklists = [];
  tables.inspection_points = [];
  tables.inspections = [];
  const submitInspection = (a: Record<string, unknown>) => {
    const p = a.p as { checklist_id: string; activity_id: string | null; element_id: string | null; answers: { id: string; result: string; note: string; impeditive: boolean }[] };
    const list = tables.checklists!.find((c) => c.id === p.checklist_id)!;
    const items = list.items as { id: string; text: string }[];
    const missing = items.find((it) => !p.answers.find((x) => x.id === it.id && ["ok", "no_ok", "na"].includes(x.result)));
    if (missing) throw new Error(`Falta responder: ${missing.text}`);
    const id = `insp${tables.inspections!.length + 1}`;
    const bad = p.answers.filter((x) => x.result === "no_ok");
    tables.inspections!.push({ id, project_id: PROJECT_ID, checklist_id: list.id, activity_id: p.activity_id, element_id: p.element_id, location_note: null, inspected_on: day(0), result: bad.length ? "rechazada" : "aprobada", answers: p.answers.map((x) => ({ ...x, text: items.find((it) => it.id === x.id)!.text })) });
    for (const b of bad)
      tables.findings!.push({ id: `nc-${id}-${b.id}`, project_id: PROJECT_ID, front_id: null, type: "quality", severity: b.impeditive ? "high" : "medium", status: "open", description: `${list.name}: ${b.note}`, due_date: day(7), created_at: `${day(0)}T15:00:00Z`, closed_at: null, category: "no_conformidad", impeditive: b.impeditive, activity_id: p.activity_id, element_id: p.element_id, company_id: null, inspection_id: id });
    return { inspection_id: id, non_conformities: bad.length };
  };
  return {
    tables,
    rpc: { shared_dashboard: sharedDashboard, project_team: projectTeam, request_correction: requestCorrection, decide_correction: decideCorrection, submit_inspection: submitInspection },
    functions: {
      "team-create-user": (b) =>
        b.email === "marta@obra.test" ? [409, { error: "marta@obra.test ya está en el proyecto (rol actual: field). Cámbiale el rol en la lista." }] : [200, { status: "created", user_id: "u-nuevo" }],
    },
  };
}
