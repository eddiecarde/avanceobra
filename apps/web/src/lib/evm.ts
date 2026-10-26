"use client";

import { earnedValue, parteCosts, type CostItem, type EvmResult } from "@avanceobra/engine";
import { fetchAll, loadDashboard, localToday } from "./dashboard";
import { DEFAULT_WORKDAY } from "./library";
import { loadParte } from "./parte";
import { supabase } from "./supabase";

export interface CostRates {
  personnel: Record<string, number>;
  equipment: Record<string, number>;
  /** Por id del material. */
  materials: Record<string, number>;
}

export interface EvmData {
  evm: EvmResult;
  rates: CostRates;
  /** Cargos y equipos para tarifar: los del catálogo del proyecto y los que aparecen en el parte. */
  roles: string[];
  equipmentTypes: string[];
  materials: { id: string; name: string; unit: string; delivered: number }[];
  unpricedRoles: string[];
  unpricedEquipment: string[];
  /** Entregas de material sin precio (no entran al costo real). */
  unpricedMaterials: string[];
  /** Hay costos de material registrados a mano y también entregas con precio: posible doble conteo. */
  manualMaterialAndDeliveries: boolean;
}

/** Valor ganado de la obra: presupuesto por actividad, avance aprobado y costo real de todas las fuentes. */
export async function loadEvm(projectId: string, cutoff = localToday()): Promise<EvmData> {
  const [dash, budget, parte, rates, mats, deliveries, certs, records] = await Promise.all([
    loadDashboard(projectId),
    fetchAll<{ id: string; budget_unit_cost: number | null }>((a, b) => supabase.from("activities").select("id, budget_unit_cost").eq("project_id", projectId).order("id").range(a, b)),
    loadParte(projectId, DEFAULT_WORKDAY.effectiveHours, { to: cutoff }),
    supabase.from("cost_rates").select("personnel, equipment, materials").eq("project_id", projectId).maybeSingle(),
    supabase.from("materials").select("id, name, unit").eq("project_id", projectId).order("name"),
    fetchAll<{ material_id: string; delivered_on: string; quantity: number }>((a, b) =>
      supabase.from("material_deliveries").select("material_id, delivered_on, quantity").eq("project_id", projectId).order("delivered_on").order("id").range(a, b),
    ),
    supabase.from("payment_certificates").select("period_end, totals").eq("project_id", projectId).not("company_id", "is", null).eq("status", "emitida"),
    supabase.from("cost_records").select("record_date, kind, amount").eq("project_id", projectId),
  ]);
  for (const r of [budget, deliveries, rates, mats, certs, records]) if (r.error) throw new Error(r.error.message);

  const cr: CostRates = {
    personnel: (rates.data?.personnel as Record<string, number> | undefined) ?? {},
    equipment: (rates.data?.equipment as Record<string, number> | undefined) ?? {},
    materials: (rates.data?.materials as Record<string, number> | undefined) ?? {},
  };
  const materials = (mats.data ?? []) as { id: string; name: string; unit: string }[];
  const costs: CostItem[] = [];

  // Personal y equipos del parte diario
  const fromParte = parteCosts(parte.days, cr.personnel, cr.equipment);
  costs.push(...fromParte.items);

  // Materiales entregados × precio
  const delivered = new Map<string, number>();
  const unpricedMaterials = new Set<string>();
  for (const d of deliveries.data) {
    delivered.set(d.material_id, (delivered.get(d.material_id) ?? 0) + Number(d.quantity));
    const price = cr.materials[d.material_id];
    if (price) costs.push({ date: d.delivered_on, amount: Number(d.quantity) * price, source: "materiales" });
    else unpricedMaterials.add(materials.find((m) => m.id === d.material_id)?.name ?? "Material");
  }

  // Actas de subcontratistas (valor del acta, en la fecha de corte del acta)
  for (const c of (certs.data ?? []) as { period_end: string; totals: { grossAmount?: number; periodAmount: number } }[]) {
    const amount = Number(c.totals.grossAmount ?? c.totals.periodAmount);
    if (amount) costs.push({ date: c.period_end, amount, source: "subcontratos" });
  }

  // Costos registrados a mano
  const records_ = (records.data ?? []) as { record_date: string; kind: string; amount: number }[];
  for (const r of records_)
    costs.push({ date: r.record_date, amount: Number(r.amount), source: r.kind === "material" ? "materiales" : r.kind === "subcontrato" ? "subcontratos" : "otros" });

  const unitCost = new Map(budget.data.map((x) => [x.id, x.budget_unit_cost == null ? null : Number(x.budget_unit_cost)]));
  const evm = earnedValue({
    activities: dash.activities.map((a) => ({
      id: a.id,
      contractQty: a.contractQty,
      budgetUnitCost: unitCost.get(a.id) ?? null,
      plannedStart: a.plannedStart,
      plannedFinish: a.plannedFinish,
    })),
    approved: dash.entries.filter((e) => e.status === "approved").map((e) => ({ activityId: e.activityId, date: e.workDate, quantity: e.quantity })),
    costs,
    cutoff,
    calendar: dash.project.calendar,
  });

  const seenRoles = new Set(parte.days.flatMap((d) => Object.keys(d.personnel)));
  const seenEquipment = new Set(parte.days.flatMap((d) => Object.keys(d.equipment)));
  return {
    evm,
    rates: cr,
    roles: [...new Set([...dash.project.personnelRoles, ...seenRoles])],
    equipmentTypes: [...new Set([...dash.project.equipmentTypes, ...seenEquipment])],
    materials: materials.map((m) => ({ ...m, delivered: delivered.get(m.id) ?? 0 })),
    unpricedRoles: fromParte.unpricedRoles,
    unpricedEquipment: fromParte.unpricedEquipment,
    unpricedMaterials: [...unpricedMaterials].sort(),
    manualMaterialAndDeliveries: records_.some((r) => r.kind === "material") && deliveries.data.some((d) => cr.materials[d.material_id]),
  };
}
