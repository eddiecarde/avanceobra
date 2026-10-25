"use client";

import { costControl, type CostControl } from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { loadDashboard, localToday, pct, SEVERITY_LABEL, type DashActivity, type DashData } from "@/lib/dashboard";
import { DEFAULT_WORKDAY, effectiveDaily, type Resource } from "@/lib/library";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface CostRecord {
  id: string;
  activity_id: string | null;
  record_date: string;
  kind: "material" | "subcontrato" | "otro";
  description: string;
  amount: number;
}
interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  created_at: string;
}

const KIND_LABEL: Record<CostRecord["kind"], string> = { material: "Material", subcontrato: "Subcontrato", otro: "Otro" };
const ALERT_KINDS = ["productivity_drop", "constraints", "late_projection"];
const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const n2 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/**
 * Costos y productividad: presupuesto contra costo real, costo por unidad, horas-hombre,
 * aprovechamiento del tiempo, rendimiento frente a la referencia y costo estimado para terminar;
 * con las alertas tempranas de productividad, restricciones y terminación en riesgo.
 */
export default function Costos() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canSee = role === "resident" || role === "director" || role === "admin";
  const isAdmin = role === "admin";
  const canRecord = role === "director" || role === "admin";

  const [loaded, setLoaded] = useState<{
    projectId: string;
    data: DashData;
    unitCost: Record<string, number | null>;
    labor: number;
    equipment: Record<string, { daily: number; ref: number }>;
    records: CostRecord[];
    alerts: AlertRow[];
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [f, setF] = useState({ company: "", front: "", subfield: "" });
  const [laborInput, setLaborInput] = useState("");
  const [unitInputs, setUnitInputs] = useState<Record<string, string>>({});
  const [rec, setRec] = useState({ activity_id: "", kind: "material" as CostRecord["kind"], description: "", amount: "", record_date: localToday() });

  useEffect(() => {
    if (!projectId || !canSee) return;
    let off = false;
    Promise.all([
      loadDashboard(projectId),
      supabase.from("activities").select("id, budget_unit_cost").eq("project_id", projectId),
      supabase.from("cost_settings").select("labor_cost_per_hour").eq("project_id", projectId).maybeSingle(),
      supabase.from("activity_resources").select("activity_id, units, resource:resource_catalog(*)").eq("project_id", projectId),
      supabase.from("cost_records").select("id, activity_id, record_date, kind, description, amount").eq("project_id", projectId).order("record_date", { ascending: false }),
      supabase.from("alerts").select("id, kind, severity, title, body, created_at").eq("project_id", projectId).in("kind", ALERT_KINDS).order("created_at", { ascending: false }).limit(30),
    ]).then(
      ([data, a, s, r, c, al]) => {
        if (off) return;
        // Costo diario de los equipos asignados (con operador) y rendimiento diario de referencia
        const equipment: Record<string, { daily: number; ref: number }> = {};
        for (const x of (r.data ?? []) as unknown as { activity_id: string; units: number; resource: Resource | null }[]) {
          if (!x.resource) continue;
          const u = Number(x.units) || 1;
          const e = (equipment[x.activity_id] ??= { daily: 0, ref: 0 });
          e.ref += effectiveDaily(x.resource, DEFAULT_WORKDAY) * u;
          if (x.resource.kind === "equipment") {
            const perHour = Number(x.resource.cost_per_hour) + Number(x.resource.operator_cost_per_hour) + Number(x.resource.fuel_cost_per_hour ?? 0) + Number(x.resource.maintenance_cost_per_hour ?? 0);
            e.daily += perHour * DEFAULT_WORKDAY.paidHours * u;
          }
        }
        const unitCost = Object.fromEntries((a.data ?? []).map((x: { id: string; budget_unit_cost: number | null }) => [x.id, x.budget_unit_cost == null ? null : Number(x.budget_unit_cost)]));
        const labor = Number(s.data?.labor_cost_per_hour ?? 0);
        setLoaded({ projectId, data, unitCost, labor, equipment, records: ((c.data ?? []) as CostRecord[]).map((x) => ({ ...x, amount: Number(x.amount) })), alerts: (al.data ?? []) as AlertRow[] });
        setLaborInput(labor ? String(labor) : "");
        setUnitInputs(Object.fromEntries(Object.entries(unitCost).map(([k, v]) => [k, v == null ? "" : String(v)])));
      },
      (e: Error) => !off && setMsg({ tone: "error", text: e.message }),
    );
    return () => {
      off = true;
    };
  }, [projectId, version, canSee]);

  const data = loaded?.projectId === projectId ? loaded.data : null;
  const rows = useMemo(() => {
    if (!data || !loaded) return [] as { a: DashActivity; c: CostControl }[];
    return data.activities.map((a) => ({
      a,
      c: costControl({
        contractQty: a.contractQty,
        budgetUnitCost: loaded.unitCost[a.id] ?? null,
        entries: data.entries.filter((e) => e.activityId === a.id).map((e) => ({ date: e.workDate, quantity: e.quantity, effectiveHours: e.effectiveHours, lostHours: e.lostHours, crewSize: e.crewSize, status: e.status })),
        laborCostPerHour: loaded.labor,
        equipmentDailyCost: loaded.equipment[a.id]?.daily ?? 0,
        otherCost: loaded.records.filter((r) => r.activity_id === a.id).reduce((t, r) => t + r.amount, 0),
        refDailyRate: loaded.equipment[a.id]?.ref || null,
      }),
    }));
  }, [data, loaded]);

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  if (!canSee) return <p className="text-zinc-600">Los costos los ven el residente, el director y el administrador.</p>;
  if (!data || !loaded) return <p className="text-zinc-500">{msg?.text ?? "Cargando costos…"}</p>;

  const shown = rows.filter(({ a }) => (!f.company || (a.companyId ?? "none") === f.company) && (!f.front || a.frontId === f.front) && (!f.subfield || a.subfield === f.subfield));
  const sum = (k: (c: CostControl) => number | null) => shown.reduce((t, r) => t + (k(r.c) ?? 0), 0);
  const withBudget = shown.filter((r) => r.c.budget != null);
  const budget = withBudget.reduce((t, r) => t + r.c.budget!, 0);
  const eacBudgeted = withBudget.reduce((t, r) => t + r.c.atCompletion, 0);
  const variance = budget - eacBudgeted;
  const ev = withBudget.reduce((t, r) => t + (loaded.unitCost[r.a.id] ?? 0) * r.c.reported, 0);
  const actualBudgeted = withBudget.reduce((t, r) => t + r.c.actual, 0);
  const cpi = actualBudgeted > 0 ? ev / actualBudgeted : null;
  const subfields = [...new Set(data.activities.map((a) => a.subfield).filter((x): x is string => !!x))].sort();
  const fronts = [...new Map(data.activities.map((a) => [a.frontId, `${a.frontCode} · ${a.frontName}`])).entries()];
  const reload = () => setVersion((v) => v + 1);

  async function act(run: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setMsg(null);
    const { error } = await run();
    setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: ok });
    if (!error) reload();
    return !error;
  }

  async function saveUnit(a: DashActivity) {
    const raw = (unitInputs[a.id] ?? "").trim();
    const v = raw ? num(raw) : null;
    if (v != null && (!Number.isFinite(v) || v < 0)) return setMsg({ tone: "error", text: `Costo unitario no válido para ${a.code}.` });
    if (v === (loaded!.unitCost[a.id] ?? null)) return;
    await act(() => supabase.from("activities").update({ budget_unit_cost: v }).eq("id", a.id), `Costo unitario de ${a.code} actualizado.`);
  }

  const kpis: [label: string, value: string, sub?: string, tone?: "good" | "bad"][] = [
    ["Presupuesto", budget ? M(budget) : "Sin definir", withBudget.length < shown.length ? `${shown.length - withBudget.length} actividad(es) sin costo unitario` : undefined],
    ["Costo real a la fecha", M(sum((c) => c.actual)), `Mano de obra ${M(sum((c) => c.labor))} · equipos ${M(sum((c) => c.equipment))} · otros ${M(sum((c) => c.other))}`],
    ["Costo estimado al terminar", budget ? M(eacBudgeted) : "—", "Al costo por unidad real de cada actividad"],
    ["Variación", budget ? `${variance >= 0 ? "" : "−"}${M(Math.abs(variance))}` : "—", budget ? (variance >= 0 ? "Por debajo del presupuesto" : "Sobrecosto proyectado") : undefined, budget ? (variance >= 0 ? "good" : "bad") : undefined],
    ["Desempeño del costo (CPI)", cpi == null ? "—" : n2(cpi), "Valor de lo ejecutado ÷ costo real", cpi == null ? undefined : cpi >= 1 ? "good" : "bad"],
    ["Horas-hombre", `${Math.round(sum((c) => c.hhProductive)).toLocaleString("es-CO")} h`, `${Math.round(sum((c) => c.hhLost)).toLocaleString("es-CO")} h perdidas`],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Costos y productividad</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Presupuesto contra costo real, horas-hombre, rendimiento y costo estimado para terminar.</p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => setPicked(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {msg ? (
        <p role={msg.tone === "error" ? "alert" : "status"} className={cx("rounded-lg px-4 py-2 font-semibold", msg.tone === "ok" ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200")}>
          {msg.text}
        </p>
      ) : null}

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Empresa">
            <Select value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })}>
              <option value="">Todas</option>
              {data.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">Sin empresa</option>
            </Select>
          </Field>
          <Field label="Frente">
            <Select value={f.front} onChange={(e) => setF({ ...f, front: e.target.value })}>
              <option value="">Todos</option>
              {fronts.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subcampo">
            <Select value={f.subfield} onChange={(e) => setF({ ...f, subfield: e.target.value })}>
              <option value="">Todos</option>
              {subfields.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([label, value, sub, tone]) => (
          <Card key={label} className="p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</div>
            <div className={cx("mt-1 text-xl font-extrabold tabular-nums", tone === "good" && "text-green-700 dark:text-green-400", tone === "bad" && "text-red-700 dark:text-red-400")}>{value}</div>
            {sub ? <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{sub}</div> : null}
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-lg font-bold">Alertas tempranas</h2>
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Se revisan cada día: productividad que cae más del 20 %, restricciones acumuladas o vencidas, y terminación en riesgo. Llegan también por Telegram.</p>
        {loaded.alerts.length === 0 ? (
          <p className="text-zinc-500">Sin alertas en este momento.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loaded.alerts.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start gap-2 py-2">
                <Badge tone={x.severity === "high" || x.severity === "critical" ? "red" : "amber"}>{SEVERITY_LABEL[x.severity] ?? x.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{x.title}</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">{x.body}</div>
                </div>
                <span className="text-sm text-zinc-500 tabular-nums">{new Date(x.created_at).toLocaleDateString("es-CO")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Por actividad</h2>
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Costo real = personal × horas pagadas × costo de la hora-hombre, más equipos asignados por día trabajado, más materiales y subcontratos registrados.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-[15px]">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-3">Actividad</th>
                <th className="pr-3 text-right">Costo unit. presup.</th>
                <th className="pr-3 text-right">Presupuesto</th>
                <th className="pr-3 text-right">Real a la fecha</th>
                <th className="pr-3 text-right">Costo / unidad real</th>
                <th className="pr-3 text-right">Al terminar</th>
                <th className="pr-3 text-right">Variación</th>
                <th className="pr-3 text-right">HH</th>
                <th className="pr-3 text-right">Productividad</th>
                <th className="pr-3 text-right">Aprovechamiento</th>
                <th className="text-right">Rinde vs. referencia</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ a, c }) => (
                <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <b>{a.code}</b> · {a.name}
                    <div className="text-sm text-zinc-500">
                      {n2(c.reported)} de {n2(a.contractQty)} {a.unit}
                    </div>
                  </td>
                  <td className="pr-3 text-right">
                    {isAdmin ? (
                      <Input
                        value={unitInputs[a.id] ?? ""}
                        onChange={(e) => setUnitInputs({ ...unitInputs, [a.id]: e.target.value })}
                        onBlur={() => void saveUnit(a)}
                        inputMode="decimal"
                        placeholder="$ por unidad"
                        aria-label={`Costo unitario presupuestado de ${a.code}`}
                        className="w-32 py-1 text-right"
                      />
                    ) : loaded.unitCost[a.id] != null ? (
                      money(loaded.unitCost[a.id]!)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="pr-3 text-right tabular-nums">{c.budget == null ? "—" : M(c.budget)}</td>
                  <td className="pr-3 text-right tabular-nums">{M(c.actual)}</td>
                  <td
                    className={cx(
                      "pr-3 text-right tabular-nums",
                      c.realUnitCost != null && loaded.unitCost[a.id] != null && c.realUnitCost > loaded.unitCost[a.id]! * 1.05 && "font-semibold text-red-700 dark:text-red-400",
                    )}
                  >
                    {c.realUnitCost == null ? "—" : money(c.realUnitCost)}
                  </td>
                  <td className="pr-3 text-right tabular-nums">{c.budget == null && c.actual === 0 ? "—" : M(c.atCompletion)}</td>
                  <td className={cx("pr-3 text-right tabular-nums", c.variance != null && (c.variance < 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"))}>
                    {c.variance == null ? "—" : `${c.variance < 0 ? "−" : ""}${M(Math.abs(c.variance))}`}
                  </td>
                  <td className="pr-3 text-right tabular-nums">
                    {Math.round(c.hhProductive).toLocaleString("es-CO")}
                    {c.hhLost ? <div className="text-sm text-zinc-500">+{Math.round(c.hhLost)} perdidas</div> : null}
                  </td>
                  <td className="pr-3 text-right tabular-nums">{c.productivity == null ? "—" : `${n2(c.productivity)} ${a.unit}/HH`}</td>
                  <td className={cx("pr-3 text-right tabular-nums", c.utilization != null && c.utilization < 0.85 && "font-semibold text-amber-700 dark:text-amber-400")}>{c.utilization == null ? "—" : pct(c.utilization, 0)}</td>
                  <td className={cx("text-right tabular-nums", c.rateVariance != null && c.rateVariance < -0.1 && "font-semibold text-red-700 dark:text-red-400")}>
                    {c.rateVariance == null ? "—" : `${c.rateVariance >= 0 ? "+" : "−"}${pct(Math.abs(c.rateVariance), 0)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-bold">Costo de la hora-hombre</h2>
          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Promedio de la cuadrilla con prestaciones. Se multiplica por el personal y las horas pagadas (efectivas más perdidas) de cada registro.</p>
          {isAdmin ? (
            <div className="flex items-end gap-2">
              <Field label="Pesos por hora-hombre">
                <Input value={laborInput} onChange={(e) => setLaborInput(e.target.value)} inputMode="decimal" placeholder="15000" className="w-40" />
              </Field>
              <Button
                variant="primary"
                onClick={() => {
                  const v = num(laborInput || "0");
                  if (!Number.isFinite(v) || v < 0) return setMsg({ tone: "error", text: "Escribe un valor en pesos." });
                  void act(() => supabase.from("cost_settings").upsert({ project_id: projectId, labor_cost_per_hour: v }), "Costo de la hora-hombre guardado.");
                }}
              >
                Guardar
              </Button>
            </div>
          ) : (
            <p className="text-xl font-bold">{loaded.labor ? money(loaded.labor) : "Sin definir"}</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-lg font-bold">Materiales, subcontratos y otros costos</h2>
          {canRecord ? (
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <Field label="Actividad">
                <Select value={rec.activity_id} onChange={(e) => setRec({ ...rec, activity_id: e.target.value })}>
                  <option value="">General del proyecto</option>
                  {data.activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tipo">
                <Select value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as CostRecord["kind"] })}>
                  <option value="material">Material</option>
                  <option value="subcontrato">Subcontrato</option>
                  <option value="otro">Otro</option>
                </Select>
              </Field>
              <Field label="Descripción">
                <Input value={rec.description} onChange={(e) => setRec({ ...rec, description: e.target.value })} placeholder="Factura 123 · arena" />
              </Field>
              <Field label="Valor">
                <Input value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} inputMode="decimal" placeholder="1.250.000" />
              </Field>
              <Field label="Fecha">
                <Input type="date" value={rec.record_date} max={localToday()} onChange={(e) => setRec({ ...rec, record_date: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="primary"
                  onClick={() => {
                    const amount = num(rec.amount || "0");
                    if (!(amount > 0) || rec.description.trim().length < 3) return setMsg({ tone: "error", text: "Escribe la descripción y el valor del costo." });
                    void act(
                      () => supabase.from("cost_records").insert({ project_id: projectId, activity_id: rec.activity_id || null, kind: rec.kind, description: rec.description.trim(), amount, record_date: rec.record_date }),
                      "Costo registrado.",
                    ).then((ok) => ok && setRec({ ...rec, description: "", amount: "" }));
                  }}
                >
                  Registrar costo
                </Button>
              </div>
            </div>
          ) : null}
          {loaded.records.length === 0 ? (
            <p className="text-zinc-500">Sin costos registrados.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {loaded.records.slice(0, 20).map((r) => (
                <li key={r.id} className="flex flex-wrap gap-2 py-1.5">
                  <span className="tabular-nums text-zinc-500">{r.record_date}</span>
                  <Badge tone="neutral">{KIND_LABEL[r.kind]}</Badge>
                  <span className="flex-1">
                    {r.description}
                    {r.activity_id ? <span className="text-zinc-500"> · {data.activities.find((a) => a.id === r.activity_id)?.code}</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums">{money(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
