"use client";

import { availableDays, entryLossLines, equipmentUnitsByActivity, historicalRate, type LossLine, type ProjectSim, type SimActivity } from "@avanceobra/engine";
import { effectiveDaily, type Resource, type WorkdayAssumptions } from "./library";
import { loadWeatherClaim } from "./parte";
import { supabase } from "./supabase";

/** Fila editable de la tabla de supuestos (una por actividad con saldo pendiente). */
export interface SimRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  include: boolean;
  pendingQty: number;
  predecessors: string[];
  perUnitDaily: number;
  rateSource: "real" | "reference" | "manual";
  realSamples: number;
  /** Días del rendimiento real en que el parte diario dijo cuántas máquinas trabajaron en la actividad. */
  realMachineDays: number;
  realReliable: boolean;
  referencePerUnit: number | null;
  realPerUnit: number | null;
  currentUnits: number;
  maxUnits: number;
  maxShifts: 1 | 2 | 3;
  resourceName: string | null;
  /** Costo por unidad y día (turno diurno): equipo (alquiler, combustible, mantenimiento) y mano de obra. */
  equipmentDailyCost: number | null;
  laborDailyCost: number | null;
  mobilization: number;
  minRentalDays: number;
}

export interface ContractInputs {
  contractEnd: string;
  penaltyPerDay: number;
  penaltyCap: number | null;
  earlyBonusPerDay: number;
  dailyIndirectCost: number;
  claimableDays: number;
  claimableSource: string;
  annualDiscountRate: number | null;
  reworkPct: number;
  inspectionPerDay: number;
  currency: string;
}

export interface SimInputs {
  projectName: string;
  rows: SimRow[];
  contract: ContractInputs;
  rainPct: number;
  workday: WorkdayAssumptions;
  nightSurcharge: number;
  secondShiftProductivity: number;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Lee proyecto, contrato, actividades, avance y biblioteca y arma los supuestos iniciales. */
export async function loadSimInputs(projectId: string, workday: WorkdayAssumptions): Promise<SimInputs> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [p, c, cs, acts, done, daily, ar, losses, weather, logs] = await Promise.all([
    supabase.from("projects").select("name, currency, contract_end_date, org_id").eq("id", projectId).single(),
    supabase.from("contracts").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("cost_settings").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("activities").select("id, code, name, unit, contract_qty, predecessors, front:fronts(max_parallel_resources)").eq("project_id", projectId).order("code"),
    supabase.from("activity_progress").select("activity_id, executed_qty").eq("project_id", projectId),
    supabase.from("activity_daily_output").select("activity_id, work_date, quantity").eq("project_id", projectId).gte("work_date", since),
    supabase.from("activity_resources").select("activity_id, units, use_real_rate, resource:resource_catalog(*)").eq("project_id", projectId),
    supabase.from("progress_entries").select("loss_cause, lost_hours, losses").eq("project_id", projectId).neq("loss_cause", "none"),
    loadWeatherClaim(projectId, workday.effectiveHours),
    // Máquinas que el parte diario asignó a cada actividad (para el rendimiento real por máquina)
    supabase.from("daily_log_latest").select("log_date, equipment").eq("project_id", projectId).gte("log_date", since),
  ]);
  const machines = equipmentUnitsByActivity(
    ((logs.data ?? []) as { log_date: string; equipment: { name: string; qty: number; activity_id?: string | null }[] | null }[]).map((l) => ({ date: l.log_date, equipment: l.equipment ?? [] })),
  );

  const contract = c.data;
  const contractValue = Number(contract?.contract_value ?? 0);
  const penaltyPerDay =
    contract?.penalty_mode === "percent" ? contractValue * Number(contract.penalty_percent_per_day ?? 0) : Number(contract?.penalty_per_day ?? 0);
  const penaltyCap = contract?.penalty_cap_percent != null ? contractValue * Number(contract.penalty_cap_percent) : null;
  const claimCauses: string[] = contract?.claimable_causes ?? ["weather", "permits", "design_client"];
  // Clima: por día (lluvia del parte dentro de la jornada o lo registrado), sin sumar cuadrillas.
  // Otras causas reclamables (permisos, cambios del cliente): horas perdidas registradas.
  // Cada línea de pérdida por su causa (el clima se cuenta aparte, por día, con el parte diario)
  const otherHours = ((losses.data ?? []) as { loss_cause: string; lost_hours: number; losses: LossLine[] | null }[])
    .flatMap((l) => entryLossLines({ lostHours: Number(l.lost_hours), lossCause: l.loss_cause, losses: l.losses }))
    .filter((l) => l.cause !== "weather" && claimCauses.includes(l.cause))
    .reduce((s, l) => s + l.hours, 0);
  const weatherHours = claimCauses.includes("weather") ? weather.hours : 0;
  const claimHours = otherHours + weatherHours;
  const claimable = Math.floor(claimHours / workday.effectiveHours + 1e-9);

  const executed = new Map((done.data ?? []).map((d) => [d.activity_id as string, Number(d.executed_qty)]));
  const rows: SimRow[] = [];
  for (const a of acts.data ?? []) {
    const pending = Math.max(0, Number(a.contract_qty) - (executed.get(a.id) ?? 0));
    const assigned = (ar.data ?? []).filter((x) => x.activity_id === a.id && x.resource) as unknown as {
      units: number;
      use_real_rate: boolean;
      resource: Resource;
    }[];
    // Recurso principal: el que más produce (si hay varios asignados)
    const primary = [...assigned].sort((x, y) => effectiveDaily(y.resource, workday) * y.units - effectiveDaily(x.resource, workday) * x.units)[0];
    const units = assigned.reduce((s, x) => s + Number(x.units), 0) || 1;
    // Por día, las máquinas que reportó el parte para esta actividad; si el parte no lo dice, las asignadas
    const reported = machines.get(a.id);
    const series = (daily.data ?? [])
      .filter((d) => d.activity_id === a.id)
      .map((d) => ({ date: d.work_date as string, quantity: Number(d.quantity), units: reported?.get(d.work_date as string) ?? units }));
    // Los mismos 14 días que usa el rendimiento real
    const reportedDays = [...series]
      .filter((d) => d.units > 0)
      .sort((x, y) => x.date.localeCompare(y.date))
      .slice(-14)
      .filter((d) => reported?.has(d.date)).length;
    const real = historicalRate(series, 14);
    const realPerUnit = real.samples > 0 ? real.meanPerUnit : null;
    const referencePerUnit = primary ? effectiveDaily(primary.resource, workday) : null;
    const useReal = primary ? primary.use_real_rate : true;
    const perUnit = useReal ? realPerUnit ?? referencePerUnit ?? 0 : referencePerUnit ?? realPerUnit ?? 0;
    const front = a.front as unknown as { max_parallel_resources: number | null } | null;
    rows.push({
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      include: pending > 0,
      pendingQty: pending,
      predecessors: (a.predecessors as string[] | null) ?? [],
      perUnitDaily: perUnit,
      rateSource: perUnit === realPerUnit && realPerUnit !== null ? "real" : perUnit === referencePerUnit && referencePerUnit !== null ? "reference" : "manual",
      realSamples: real.samples,
      realMachineDays: reportedDays,
      realReliable: real.reliable,
      referencePerUnit,
      realPerUnit,
      currentUnits: units,
      maxUnits: Math.max(units, front?.max_parallel_resources ?? units + 3),
      maxShifts: 2,
      resourceName: primary?.resource.name ?? null,
      equipmentDailyCost: primary
        ? (Number(primary.resource.cost_per_hour) + Number(primary.resource.fuel_cost_per_hour) + Number(primary.resource.maintenance_cost_per_hour)) * workday.paidHours
        : null,
      laborDailyCost: primary ? Number(primary.resource.operator_cost_per_hour) * workday.paidHours : null,
      mobilization: primary ? Number(primary.resource.mobilization_cost) : 0,
      minRentalDays: primary ? Number(primary.resource.min_rental_days) : 0,
    });
  }

  return {
    projectName: p.data?.name ?? "Proyecto",
    rows,
    contract: {
      contractEnd: contract?.contract_end_date ?? p.data?.contract_end_date ?? todayISO(),
      penaltyPerDay,
      penaltyCap,
      earlyBonusPerDay: Number(contract?.early_bonus_per_day ?? 0),
      dailyIndirectCost: Number(contract?.daily_indirect_cost ?? 0),
      claimableDays: claimable,
      claimableSource: `${Math.round(weatherHours)} h de lluvia en la jornada (${weather.days.length} días) + ${Math.round(otherHours)} h perdidas por permisos o cambios del cliente ÷ ${workday.effectiveHours} h/día`,
      annualDiscountRate: contract?.annual_discount_rate != null ? Number(contract.annual_discount_rate) : null,
      reworkPct: Number(cs.data?.expected_rework_pct ?? 0.02),
      inspectionPerDay: Number(cs.data?.inspection_cost_per_day ?? 0),
      currency: p.data?.currency ?? "COP",
    },
    rainPct: 0.1,
    workday,
    nightSurcharge: 0.35,
    secondShiftProductivity: 0.85,
  };
}

/** Días laborables (lun–sáb, sin festivos de Colombia) hasta la fecha contractual, menos la lluvia estimada. */
export function availableFrom(inputs: SimInputs, from = todayISO()) {
  return availableDays(from, inputs.contract.contractEnd, {}, inputs.rainPct);
}

/** Convierte los supuestos editables en la entrada del motor. */
export function toProjectSim(inputs: SimInputs): ProjectSim {
  const included = inputs.rows.filter((r) => r.include && r.pendingQty > 0);
  const ids = new Set(included.map((r) => r.id));
  const activities: SimActivity[] = included.map((r) => ({
    id: r.id,
    // Con código: hay actividades homónimas en distintos frentes (BA-MOD y BB-MOD)
    name: `${r.code} ${r.name}`,
    unit: r.unit,
    pendingQty: r.pendingQty,
    predecessors: r.predecessors.filter((p) => ids.has(p)),
    perUnitDaily: r.perUnitDaily,
    rateSource: r.rateSource,
    currentUnits: r.currentUnits,
    resourceName: r.resourceName ?? "unidad(es)",
    maxUnits: r.maxUnits,
    maxShifts: r.maxShifts,
    unitCost:
      (r.equipmentDailyCost ?? 0) + (r.laborDailyCost ?? 0) > 0
        ? {
            rentalPerHour: (r.equipmentDailyCost ?? 0) / inputs.workday.paidHours,
            operatorPerHour: (r.laborDailyCost ?? 0) / inputs.workday.paidHours,
            paidHoursPerDay: inputs.workday.paidHours,
            mobilization: r.mobilization,
            minRentalDays: r.minRentalDays,
          }
        : null,
  }));
  const c = inputs.contract;
  return {
    availableDays: availableFrom(inputs).available,
    activities,
    contract: {
      penaltyPerDay: c.penaltyPerDay,
      penaltyCap: c.penaltyCap,
      earlyBonusPerDay: c.earlyBonusPerDay,
      dailyIndirectCost: c.dailyIndirectCost,
      claimableDays: c.claimableDays,
    },
    quality: { expectedReworkPct: c.reworkPct, extraInspectionPerDay: c.inspectionPerDay },
    shifts: {
      productivity: [1, inputs.secondShiftProductivity, Math.max(0, inputs.secondShiftProductivity - 0.1)],
      // Recargo nocturno (CST) sobre la mano de obra de los turnos 2.º y 3.º
      laborSurcharge: [0, inputs.nightSurcharge, inputs.nightSurcharge],
      extraShiftOverheadPerDay: 0,
    },
    annualDiscountRate: c.annualDiscountRate,
  };
}
