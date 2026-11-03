import { diffDays, materialStatus, penaltyCost, penaltyFromPercent, ppc, sCurve, SCENARIO_LABEL, type ScenarioKey } from "@avanceobra/engine";
import { fetchAll, loadDashboard, pct, type DashData } from "@/lib/dashboard";
import { supabase } from "@/lib/supabase";

export interface Row {
  id: string;
  name: string;
  actual: number;
  planned: number;
  spi: number | null;
  projectedFinish: string | null;
  contractEnd: string | null;
  delayDays: number | null;
  penalty: number | null;
  ppc: number | null;
  ppcWeek: string | null;
  critical: number;
  impeditive: number;
  overdue: number;
  materialsLow: string[];
  billed: number | null;
  contractValue: number | null;
  /** Última simulación guardada (acelerar o pagar la multa). */
  simulation: { name: string; chosen: string; best: string; totalBase: number; totalChosen: number; date: string } | null;
}

export const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;

/** Lo que gerencia necesita de cada obra, en una sola página y lado a lado. */
export async function loadRow(projectId: string, today: string): Promise<Row> {
  const [dash, contract, plans, items, mats, usage, deliveries, certs, sims] = await Promise.all([
    loadDashboard(projectId),
    supabase.from("contracts").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("weekly_plans").select("id, week_start").eq("project_id", projectId).eq("status", "cerrado").order("week_start", { ascending: false }).limit(1),
    supabase.from("weekly_plan_items").select("plan_id, done").eq("project_id", projectId),
    supabase.from("materials").select("id, name, unit, low_days").eq("project_id", projectId),
    fetchAll((a, b) => supabase.from("material_usage").select("material_id, activity_id, factor").eq("project_id", projectId).order("material_id").order("activity_id").range(a, b)),
    supabase.from("material_deliveries").select("material_id, delivered_on, quantity").eq("project_id", projectId),
    supabase.from("payment_certificates").select("totals, number, status").eq("project_id", projectId).is("company_id", null).eq("status", "emitida").order("number", { ascending: false }).limit(1),
    supabase.from("simulations").select("name, chosen_scenario, best_scenario, total_base, total_chosen, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1),
  ]);
  const d: DashData = dash;
  const cal = d.project.calendar;
  const starts = d.activities.map((a) => a.plannedStart).filter(Boolean) as string[];
  const from = d.project.startDate ?? starts.sort()[0] ?? today;
  const to = d.project.contractEnd ?? today;
  const groups = d.activities.some((a) => a.workGroup) ? new Map(d.activities.map((a) => [a.id, a.workGroup])) : null;
  const curve = sCurve({
    activities: d.activities,
    daily: d.daily.filter((x) => x.date <= today),
    from,
    to: to < today ? today : to,
    today,
    calendar: cal,
    ...(groups ? { groupOf: (id: string) => groups.get(id) ?? null, rateWindowDays: 21 } : {}),
  });
  const delayDays = curve.projectedFinish && d.project.contractEnd ? diffDays(d.project.contractEnd, curve.projectedFinish) : null;
  const c = contract.data as Record<string, number | string | null> | null;
  let penalty: number | null = null;
  if (c && delayDays != null) {
    const value = Number(c.contract_value);
    const terms =
      c.penalty_mode === "percent"
        ? { ...penaltyFromPercent(value, Number(c.penalty_percent_per_day), c.penalty_cap_percent == null ? undefined : Number(c.penalty_cap_percent)), dailyIndirectCost: 0 }
        : { penaltyPerDay: Number(c.penalty_per_day), penaltyCap: c.penalty_cap_percent == null ? null : value * Number(c.penalty_cap_percent), dailyIndirectCost: 0 };
    penalty = penaltyCost(Math.max(0, delayDays), terms);
  }
  const lastPlan = (plans.data ?? [])[0] as { id: string; week_start: string } | undefined;
  const open = d.findings.filter((f) => f.status !== "closed");
  const mrows = materialStatus(
    ((mats.data ?? []) as { id: string; name: string; unit: string; low_days: number }[]).map((m) => ({ id: m.id, name: m.name, unit: m.unit, lowDays: m.low_days })),
    (usage.data as { material_id: string; activity_id: string; factor: number }[]).map((u) => ({ materialId: u.material_id, activityId: u.activity_id, factor: Number(u.factor) })),
    d.activities,
    d.daily,
    ((deliveries.data ?? []) as { material_id: string; delivered_on: string; quantity: number }[]).map((x) => ({ materialId: x.material_id, date: x.delivered_on, quantity: Number(x.quantity) })),
    today,
    cal,
  );
  const sim = (sims.data ?? [])[0] as
    | { name: string; chosen_scenario: string | null; best_scenario: string; total_base: number; total_chosen: number; created_at: string }
    | undefined;
  const cert = (certs.data ?? [])[0] as { totals: { cumulativeAmount: number; contractAmount: number } } | undefined;
  return {
    id: projectId,
    name: d.project.name,
    actual: curve.actualToday,
    planned: curve.plannedToday,
    spi: curve.spi,
    projectedFinish: curve.projectedFinish,
    contractEnd: d.project.contractEnd,
    delayDays,
    penalty,
    ppc: lastPlan ? ppc(((items.data ?? []) as { plan_id: string; done: boolean | null }[]).filter((i) => i.plan_id === lastPlan.id)) : null,
    ppcWeek: lastPlan?.week_start ?? null,
    critical: open.filter((f) => f.severity === "critical").length,
    impeditive: open.filter((f) => f.impeditive).length,
    overdue: open.filter((f) => f.dueDate && f.dueDate < today).length,
    materialsLow: mrows.filter((m) => m.status === "low" || m.status === "out").map((m) => m.name),
    billed: cert ? cert.totals.cumulativeAmount : null,
    contractValue: cert ? cert.totals.contractAmount : c ? Number(c.contract_value) : null,
    simulation: sim
      ? { name: sim.name, chosen: sim.chosen_scenario ?? sim.best_scenario, best: sim.best_scenario, totalBase: Number(sim.total_base), totalChosen: Number(sim.total_chosen), date: sim.created_at.slice(0, 10) }
      : null,
  };
}

const scenario = (k: string) => SCENARIO_LABEL[k as ScenarioKey] ?? k;

/**
 * Datos de una obra para el resumen ejecutivo de Muse Spark: solo lo que ya calculó el motor, con las
 * cifras formateadas tal como se muestran (el modelo las copia; la función rechaza cifras que no estén aquí).
 */
export function summaryFacts(r: Row, today: string) {
  return {
    obra: r.name,
    corte: today,
    avance_real: pct(r.actual),
    avance_programado: pct(r.planned),
    spi: pct(r.spi, 0),
    fin_proyectado: r.projectedFinish ?? "sin fecha (falta ritmo de avance)",
    fin_contractual: r.contractEnd ?? "sin fecha contractual",
    dias_atraso_proyectado: r.delayDays == null ? "sin dato" : r.delayDays > 0 ? `${r.delayDays} días de atraso` : r.delayDays < 0 ? `${-r.delayDays} días antes` : "a tiempo",
    multa_estimada: r.penalty == null ? "sin contrato cargado" : M(r.penalty),
    plan_semanal_cumplido_ppc: r.ppc == null ? "sin plan cerrado" : `${pct(r.ppc, 0)} (semana del ${r.ppcWeek})`,
    hallazgos_criticos_abiertos: r.critical,
    hallazgos_impeditivos_abiertos: r.impeditive,
    hallazgos_vencidos: r.overdue,
    materiales_por_agotarse: r.materialsLow,
    cobrado_acumulado: r.billed == null ? "sin actas emitidas" : M(r.billed),
    cobrado_sobre_contrato: r.billed != null && r.contractValue ? pct(r.billed / r.contractValue, 0) : "sin dato",
    decision_acelerar_o_pagar: r.simulation
      ? {
          simulacion: r.simulation.name,
          fecha: r.simulation.date,
          escenario_recomendado_por_el_motor: scenario(r.simulation.best),
          escenario_elegido: scenario(r.simulation.chosen),
          costo_total_sin_hacer_nada: M(r.simulation.totalBase),
          costo_total_escenario_elegido: M(r.simulation.totalChosen),
          ahorro_frente_a_no_hacer_nada: M(r.simulation.totalBase - r.simulation.totalChosen),
        }
      : "no hay simulación guardada: recomendar hacerla en el Simulador",
  };
}
