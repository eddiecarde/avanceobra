"use client";

import { diffDays, materialStatus, penaltyCost, penaltyFromPercent, ppc, sCurve } from "@avanceobra/engine";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, cx } from "@/components/ui";
import { fetchAll, loadDashboard, localToday, pct, type DashData } from "@/lib/dashboard";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Row {
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
}

const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;

/** Lo que gerencia necesita de cada obra, en una sola página y lado a lado. */
async function loadRow(projectId: string, today: string): Promise<Row> {
  const [dash, contract, plans, items, mats, usage, deliveries, certs] = await Promise.all([
    loadDashboard(projectId),
    supabase.from("contracts").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("weekly_plans").select("id, week_start").eq("project_id", projectId).eq("status", "cerrado").order("week_start", { ascending: false }).limit(1),
    supabase.from("weekly_plan_items").select("plan_id, done").eq("project_id", projectId),
    supabase.from("materials").select("id, name, unit, low_days").eq("project_id", projectId),
    fetchAll((a, b) => supabase.from("material_usage").select("material_id, activity_id, factor").eq("project_id", projectId).order("material_id").order("activity_id").range(a, b)),
    supabase.from("material_deliveries").select("material_id, delivered_on, quantity").eq("project_id", projectId),
    supabase.from("payment_certificates").select("totals, number, status").eq("project_id", projectId).is("company_id", null).eq("status", "emitida").order("number", { ascending: false }).limit(1),
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
  };
}

/** Vista de gerencia: todas las obras lado a lado, de la más comprometida a la más tranquila. */
export default function Gerencia() {
  const { memberships, setCurrentProjectId } = useSession();
  const router = useRouter();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const today = localToday();
  const [rows, setRows] = useState<Record<string, Row | { error: string }>>({});

  useEffect(() => {
    let off = false;
    for (const p of projects)
      loadRow(p.id, today).then(
        (r) => !off && setRows((s) => ({ ...s, [p.id]: r })),
        (e: Error) => !off && setRows((s) => ({ ...s, [p.id]: { error: e.message } })),
      );
    return () => {
      off = true;
    };
  }, [projects, today]);

  const ready = Object.values(rows).filter((r): r is Row => !("error" in r));
  // Primero las obras con más días de atraso proyectado
  const sorted = [...ready].sort((a, b) => (b.delayDays ?? -1e9) - (a.delayDays ?? -1e9));
  const totals = {
    penalty: ready.reduce((t, r) => t + (r.penalty ?? 0), 0),
    critical: ready.reduce((t, r) => t + r.critical, 0),
    late: ready.filter((r) => (r.delayDays ?? 0) > 0).length,
  };
  const open = (id: string, path: string) => {
    setCurrentProjectId(id);
    router.push(path);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Gerencia</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Todas las obras lado a lado: avance, atraso, multa estimada, plan cumplido, hallazgos críticos, materiales y lo cobrado. Corte: hoy.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Obras</div>
          <div className="text-2xl font-extrabold">{projects.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Con atraso proyectado</div>
          <div className={cx("text-2xl font-extrabold", totals.late > 0 && "text-red-700 dark:text-red-400")}>{totals.late}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Multa estimada total</div>
          <div className={cx("text-2xl font-extrabold", totals.penalty > 0 && "text-red-700 dark:text-red-400")}>{M(totals.penalty)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Hallazgos críticos abiertos</div>
          <div className={cx("text-2xl font-extrabold", totals.critical > 0 && "text-red-700 dark:text-red-400")}>{totals.critical}</div>
        </Card>
      </div>

      {ready.length < projects.length ? <p className="text-sm text-zinc-500">{`Cargando ${projects.length - ready.length} obra(s)…`}</p> : null}
      {Object.entries(rows)
        .filter(([, r]) => "error" in r)
        .map(([id, r]) => (
          <Card key={id} className="text-red-700">
            {projects.find((p) => p.id === id)?.name}: {(r as { error: string }).error}
          </Card>
        ))}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
              <tr>
                <th className="px-2 py-2">Obra</th>
                <th className="px-2">Avance real / programado</th>
                <th className="px-2 text-right">SPI</th>
                <th className="px-2">Fin proyectado</th>
                <th className="px-2 text-right">Multa estimada</th>
                <th className="px-2 text-right">PPC</th>
                <th className="px-2">Hallazgos</th>
                <th className="px-2">Materiales</th>
                <th className="px-2 text-right">Cobrado</th>
                <th className="px-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                  <td className="px-2 py-2 font-semibold">{r.name}</td>
                  <td className="px-2">
                    <div className="relative h-3 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min(100, r.actual * 100)}%` }} />
                      <div className="absolute inset-y-0 w-0.5 bg-[var(--viz-text)]" style={{ left: `${Math.min(100, r.planned * 100)}%` }} />
                    </div>
                    <div className="mt-0.5 tabular-nums">
                      {pct(r.actual)} de {pct(r.planned)}
                    </div>
                  </td>
                  <td className={cx("px-2 text-right tabular-nums", r.spi != null && r.spi < 0.9 && "font-semibold text-red-700 dark:text-red-400")}>{pct(r.spi, 0)}</td>
                  <td className="px-2 tabular-nums">
                    {r.projectedFinish ?? "Sin fecha"}
                    {r.delayDays != null && r.delayDays !== 0 ? (
                      <div className={cx("text-xs", r.delayDays > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400")}>
                        {r.delayDays > 0 ? `+${r.delayDays} días` : `${-r.delayDays} días antes`}
                      </div>
                    ) : null}
                  </td>
                  <td className={cx("px-2 text-right tabular-nums", (r.penalty ?? 0) > 0 && "font-semibold text-red-700 dark:text-red-400")}>{r.penalty == null ? "sin contrato" : M(r.penalty)}</td>
                  <td className="px-2 text-right tabular-nums">{r.ppc == null ? "—" : pct(r.ppc, 0)}</td>
                  <td className="px-2">
                    <div className="flex flex-wrap gap-1">
                      {r.critical ? <Badge tone="red">{`${r.critical} crítico(s)`}</Badge> : null}
                      {r.impeditive ? <Badge tone="red">{`${r.impeditive} impeditivo(s)`}</Badge> : null}
                      {r.overdue ? <Badge tone="amber">{`${r.overdue} vencido(s)`}</Badge> : null}
                      {!r.critical && !r.impeditive && !r.overdue ? <Badge tone="green">Al día</Badge> : null}
                    </div>
                  </td>
                  <td className="px-2">{r.materialsLow.length ? <Badge tone="amber">{`Por agotarse: ${r.materialsLow.slice(0, 2).join(", ")}`}</Badge> : "—"}</td>
                  <td className="px-2 text-right tabular-nums">
                    {r.billed == null ? "—" : M(r.billed)}
                    {r.billed != null && r.contractValue ? <div className="text-xs text-zinc-500">{pct(r.billed / r.contractValue, 0)} del contrato</div> : null}
                  </td>
                  <td className="space-x-2 px-2 text-right whitespace-nowrap">
                    <button className="font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => open(r.id, "/dashboard")}>
                      Panel
                    </button>
                    <button className="font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => open(r.id, "/simulador")}>
                      Multa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Multa estimada: días de atraso proyectado × multa diaria del contrato, con su tope. Cobrado: acumulado de la última acta al cliente.
        </p>
      </Card>
    </div>
  );
}
