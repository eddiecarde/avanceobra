"use client";

import { addDays, lookahead, mondayOf, ppc } from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { loadDashboard, localToday, type DashData } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const CAUSE_LABEL: Record<string, string> = {
  weather: "Clima",
  material: "Material",
  equipment: "Equipo",
  permits: "Permisos",
  labor: "Personal",
  design_client: "Diseño/Cliente",
  prerequisite: "Tarea previa sin terminar",
  planning: "Mala estimación",
  other: "Otra",
};

interface Plan {
  id: string;
  week_start: string;
  status: "borrador" | "comprometido" | "cerrado";
}
interface PlanItem {
  id: string;
  plan_id: string;
  activity_id: string;
  planned_qty: number;
  responsible: string | null;
  executed_qty: number | null;
  done: boolean | null;
  failure_cause: string | null;
  failure_note: string | null;
}
interface Constraint {
  id: string;
  activity_id: string | null;
  description: string;
  need_by: string | null;
}

const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const weekLabel = (w: string) => `${dm(w)} – ${dm(addDays(w, 6))}`;

/**
 * Plan semanal (último planificador): programación a 3 semanas, compromiso de la semana solo con
 * tareas liberadas (sin restricciones abiertas) y, al cerrarla, porcentaje de plan cumplido y causas.
 */
export default function PlanSemanal() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canPlan = role === "resident" || role === "director" || role === "admin";
  const today = localToday();
  const [week, setWeek] = useState(addDays(mondayOf(today), 7));
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<{ projectId: string; dash: DashData; plans: Plan[]; items: PlanItem[]; constraints: Constraint[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Record<string, { qty: string; responsible: string }>>({});
  const [closing, setClosing] = useState<Record<string, { cause: string; note: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      loadDashboard(projectId),
      supabase.from("weekly_plans").select("id, week_start, status").eq("project_id", projectId).order("week_start", { ascending: false }),
      supabase.from("weekly_plan_items").select("*").eq("project_id", projectId),
      supabase.from("project_constraints").select("id, activity_id, description, need_by").eq("project_id", projectId).eq("status", "abierta"),
    ]).then(
      ([dash, p, i, c]) => {
        if (off) return;
        setData({ projectId, dash, plans: (p.data ?? []) as Plan[], items: ((i.data ?? []) as PlanItem[]).map((x) => ({ ...x, planned_qty: Number(x.planned_qty), executed_qty: x.executed_qty == null ? null : Number(x.executed_qty) })), constraints: (c.data ?? []) as Constraint[] });
        setError(null);
      },
      (e: Error) => !off && setError(e.message),
    );
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const ready = data?.projectId === projectId ? data : null;
  const plan = ready?.plans.find((p) => p.week_start === week) ?? null;
  const items = useMemo(() => (ready && plan ? ready.items.filter((i) => i.plan_id === plan.id) : []), [ready, plan]);

  // Ejecutado hasta antes de la semana (para sugerir) y durante la semana (para cerrarla)
  const { executedBefore, executedIn } = useMemo(() => {
    const before: Record<string, number> = {};
    const inWeek: Record<string, number> = {};
    for (const d of ready?.dash.daily ?? []) {
      if (d.date < week) before[d.activityId] = (before[d.activityId] ?? 0) + d.quantity;
      else if (d.date <= addDays(week, 6)) inWeek[d.activityId] = (inWeek[d.activityId] ?? 0) + d.quantity;
    }
    return { executedBefore: before, executedIn: inWeek };
  }, [ready, week]);

  const rows = useMemo(() => {
    if (!ready) return [];
    const la = new Map(lookahead(ready.dash.activities, executedBefore, week, 3, ready.dash.project.calendar).map((r) => [r.activityId, r]));
    const inPlan = new Set(items.map((i) => i.activity_id));
    return ready.dash.activities
      .filter((a) => la.has(a.id) || inPlan.has(a.id))
      .filter((a) => !front || a.frontId === front)
      .filter((a) => !q || `${a.code} ${a.name} ${a.workGroup ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      .map((a) => ({ a, weeks: la.get(a.id)?.weeks ?? [0, 0, 0], blocks: ready.constraints.filter((c) => c.activity_id === a.id) }));
  }, [ready, executedBefore, week, items, front, q]);

  const history = useMemo(() => {
    if (!ready) return [];
    return ready.plans
      .filter((p) => p.status === "cerrado")
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-12)
      .map((p) => ({ p, value: ppc(ready.items.filter((i) => i.plan_id === p.id)) }));
  }, [ready]);
  const causes = useMemo(() => {
    const closedIds = new Set(history.map((h) => h.p.id));
    const count: Record<string, number> = {};
    for (const i of ready?.items ?? []) if (closedIds.has(i.plan_id) && i.done === false) count[i.failure_cause ?? "other"] = (count[i.failure_cause ?? "other"] ?? 0) + 1;
    return Object.entries(count).sort((a, b) => b[1] - a[1]);
  }, [ready, history]);

  const editable = canPlan && (!plan || plan.status === "borrador");
  const itemOf = (id: string) => items.find((i) => i.activity_id === id);
  const selected = (id: string) => (draft[id] ? draft[id]!.qty !== "" : !!itemOf(id));

  async function savePlan(commit: boolean) {
    if (!ready) return;
    setBusy(true);
    setMsg(null);
    try {
      let planId = plan?.id;
      if (!planId) {
        const { data: p, error } = await supabase.from("weekly_plans").insert({ project_id: projectId, week_start: week }).select("id").single();
        if (error) throw error;
        planId = (p as { id: string }).id;
      }
      // Lo marcado en pantalla: cantidad > 0 entra; vacío sale
      for (const [activityId, d] of Object.entries(draft)) {
        const qty = Number(d.qty.replace(",", "."));
        if (d.qty.trim() === "") {
          const ex = itemOf(activityId);
          if (ex) {
            const { error } = await supabase.from("weekly_plan_items").delete().eq("id", ex.id);
            if (error) throw error;
          }
          continue;
        }
        if (!(qty > 0)) throw new Error("Las cantidades del plan deben ser mayores que cero.");
        const { error } = await supabase
          .from("weekly_plan_items")
          .upsert({ plan_id: planId, project_id: projectId, activity_id: activityId, planned_qty: qty, responsible: d.responsible.trim() || null }, { onConflict: "plan_id,activity_id" });
        if (error) throw error;
      }
      if (commit) {
        const count = new Set([...items.map((i) => i.activity_id), ...Object.keys(draft)].filter((id) => selected(id))).size;
        if (!count) throw new Error("El plan no tiene tareas: marca al menos una tarea liberada.");
        const { error } = await supabase.from("weekly_plans").update({ status: "comprometido", committed_at: new Date().toISOString() }).eq("id", planId);
        if (error) throw error;
      }
      setDraft({});
      setMsg({ tone: "ok", text: commit ? `Plan de la semana ${weekLabel(week)} comprometido.` : "Plan guardado como borrador." });
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function closeWeek() {
    if (!plan) return;
    const pending = items.filter((i) => (executedIn[i.activity_id] ?? 0) < i.planned_qty - 1e-9 && !closing[i.id]?.cause);
    if (pending.length) return setMsg({ tone: "error", text: `Falta la causa de ${pending.length} tarea(s) no cumplida(s).` });
    setBusy(true);
    setMsg(null);
    try {
      for (const i of items) {
        const executed = executedIn[i.activity_id] ?? 0;
        const done = executed >= i.planned_qty - 1e-9;
        const { error } = await supabase
          .from("weekly_plan_items")
          .update({ executed_qty: executed, done, failure_cause: done ? null : closing[i.id]!.cause, failure_note: done ? null : closing[i.id]?.note.trim() || null })
          .eq("id", i.id);
        if (error) throw error;
      }
      const { error } = await supabase.from("weekly_plans").update({ status: "cerrado", closed_at: new Date().toISOString() }).eq("id", plan.id);
      if (error) throw error;
      const value = ppc(items.map((i) => ({ done: (executedIn[i.activity_id] ?? 0) >= i.planned_qty - 1e-9 })));
      setMsg({ tone: "ok", text: `Semana cerrada: plan cumplido ${value == null ? "—" : `${Math.round(value * 100)} %`}.` });
      setClosing({});
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!projects.length) return <p className="text-zinc-500">No tienes proyectos asignados.</p>;
  const fronts = ready ? [...new Map(ready.dash.activities.map((a) => [a.frontId, `${a.frontCode} · ${a.frontName}`])).entries()] : [];
  const weekEnded = addDays(week, 6) < today;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Plan semanal</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Programación a 3 semanas, compromiso de la semana con tareas liberadas y porcentaje de plan cumplido (PPC).</p>
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

      <Card className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => (setWeek(addDays(week, -7)), setDraft({}))} aria-label="Semana anterior">
          ←
        </Button>
        <div>
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Semana</div>
          <div className="text-lg font-extrabold">{weekLabel(week)}</div>
        </div>
        <Button size="sm" onClick={() => (setWeek(addDays(week, 7)), setDraft({}))} aria-label="Semana siguiente">
          →
        </Button>
        <Badge tone={plan?.status === "cerrado" ? "green" : plan?.status === "comprometido" ? "blue" : "neutral"}>
          {plan ? { borrador: "Borrador", comprometido: "Comprometido", cerrado: "Cerrado" }[plan.status] : "Sin plan"}
        </Badge>
        {plan?.status === "cerrado" ? (
          <span className="font-semibold">PPC {Math.round((ppc(items) ?? 0) * 100)} %</span>
        ) : null}
        {msg ? <span className={cx("ml-auto font-semibold", msg.tone === "ok" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{msg.text}</span> : null}
      </Card>

      {error ? <Card className="text-red-700">No se pudo cargar: {error}</Card> : null}
      {!ready ? (
        !error ? <p className="text-zinc-500">Cargando…</p> : null
      ) : (
        <>
          {plan?.status === "comprometido" ? (
            <Card>
              <h2 className="text-lg font-bold">Cumplimiento de la semana</h2>
              <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                Lo ejecutado sale de los registros de campo de la semana. {weekEnded ? "Para las tareas no cumplidas, elige la causa y cierra la semana." : "La semana todavía no termina."}
              </p>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1">Tarea</th>
                    <th className="text-right">Plan</th>
                    <th className="text-right">Ejecutado</th>
                    <th>Estado</th>
                    <th>Causa si no se cumplió</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const a = ready.dash.activities.find((x) => x.id === i.activity_id);
                    const ex = executedIn[i.activity_id] ?? 0;
                    const done = ex >= i.planned_qty - 1e-9;
                    return (
                      <tr key={i.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5">
                          <b>{a?.code}</b> · {a?.name}
                          {i.responsible ? <div className="text-xs text-zinc-500">Responsable: {i.responsible}</div> : null}
                        </td>
                        <td className="text-right tabular-nums">
                          {n1(i.planned_qty)} {a?.unit}
                        </td>
                        <td className="text-right tabular-nums">{n1(ex)}</td>
                        <td>{done ? <Badge tone="green">✓ Cumplida</Badge> : <Badge tone="red">■ No cumplida</Badge>}</td>
                        <td>
                          {done ? null : (
                            <div className="flex gap-1">
                              <Select
                                aria-label={`Causa de ${a?.code}`}
                                value={closing[i.id]?.cause ?? ""}
                                onChange={(e) => setClosing({ ...closing, [i.id]: { cause: e.target.value, note: closing[i.id]?.note ?? "" } })}
                                className="py-1"
                              >
                                <option value="">Elegir…</option>
                                {Object.entries(CAUSE_LABEL).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </Select>
                              <Input
                                aria-label={`Detalle de ${a?.code}`}
                                placeholder="Detalle"
                                value={closing[i.id]?.note ?? ""}
                                onChange={(e) => setClosing({ ...closing, [i.id]: { cause: closing[i.id]?.cause ?? "", note: e.target.value } })}
                                className="py-1"
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {canPlan ? (
                <Button variant="primary" className="mt-3" disabled={busy || !weekEnded} onClick={() => void closeWeek()}>
                  {weekEnded ? "Cerrar semana y calcular PPC" : "Se cierra cuando termine la semana"}
                </Button>
              ) : null}
            </Card>
          ) : null}

          {plan?.status === "cerrado" ? (
            <Card>
              <h2 className="mb-2 text-lg font-bold">Semana cerrada</h2>
              <ul className="space-y-1 text-sm">
                {items.map((i) => {
                  const a = ready.dash.activities.find((x) => x.id === i.activity_id);
                  return (
                    <li key={i.id}>
                      {i.done ? "✓" : "■"} <b>{a?.code}</b> · {a?.name}: {n1(i.executed_qty ?? 0)} de {n1(i.planned_qty)} {a?.unit}
                      {i.done ? "" : ` — ${CAUSE_LABEL[i.failure_cause ?? "other"]}${i.failure_note ? `: ${i.failure_note}` : ""}`}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card>
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <h2 className="mr-auto text-lg font-bold">Programación a 3 semanas</h2>
              <Field label="Frente">
                <Select value={front} onChange={(e) => setFront(e.target.value)}>
                  <option value="">Todos</option>
                  {fronts.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Input placeholder="Buscar actividad" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            </div>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              Cantidad sugerida para ir al día con el programa (la primera semana incluye lo atrasado). Solo las tareas <b>liberadas</b> (sin restricciones abiertas)
              entran al plan de la semana.
            </p>
            {rows.length === 0 ? (
              <p className="text-zinc-500">No hay actividades programadas en estas tres semanas.</p>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
                    <tr>
                      <th className="px-2 py-2">Actividad</th>
                      {[0, 1, 2].map((i) => (
                        <th key={i} className="px-2 text-right">
                          {weekLabel(addDays(week, 7 * i))}
                        </th>
                      ))}
                      <th className="px-2">Restricciones</th>
                      <th className="px-2">Plan de la semana</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ a, weeks, blocks }) => {
                      const item = itemOf(a.id);
                      const d = draft[a.id];
                      const free = blocks.length === 0;
                      return (
                        <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-2 py-1.5">
                            <b>{a.code}</b> · {a.name}
                            <div className="text-xs text-zinc-500">{a.frontCode}</div>
                          </td>
                          {weeks.map((w, i) => (
                            <td key={i} className={cx("px-2 text-right tabular-nums", i === 0 && "font-semibold")}>
                              {w > 1e-9 ? `${n1(w)} ${a.unit}` : "—"}
                            </td>
                          ))}
                          <td className="px-2">
                            {free ? (
                              <Badge tone="green">Liberada</Badge>
                            ) : (
                              <span title={blocks.map((b) => `${b.description}${b.need_by ? ` (para ${b.need_by})` : ""}`).join("\n")}>
                                <Badge tone="red">{`${blocks.length} restricción(es)`}</Badge>
                                <div className="mt-0.5 max-w-56 truncate text-xs text-zinc-500">{blocks[0]!.description}</div>
                              </span>
                            )}
                          </td>
                          <td className="px-2">
                            {editable ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  aria-label={`Incluir ${a.code} en el plan`}
                                  className="h-4 w-4 accent-blue-700"
                                  disabled={!free && !item}
                                  checked={selected(a.id)}
                                  onChange={(e) =>
                                    setDraft({ ...draft, [a.id]: { qty: e.target.checked ? String(Math.round((weeks[0] || item?.planned_qty || 0) * 100) / 100) : "", responsible: d?.responsible ?? item?.responsible ?? "" } })
                                  }
                                />
                                {selected(a.id) ? (
                                  <>
                                    <Input
                                      aria-label={`Cantidad de ${a.code}`}
                                      inputMode="decimal"
                                      value={d?.qty ?? String(item?.planned_qty ?? "")}
                                      onChange={(e) => setDraft({ ...draft, [a.id]: { qty: e.target.value, responsible: d?.responsible ?? item?.responsible ?? "" } })}
                                      className="w-24 py-1"
                                    />
                                    <Input
                                      aria-label={`Responsable de ${a.code}`}
                                      placeholder="Responsable"
                                      value={d?.responsible ?? item?.responsible ?? ""}
                                      onChange={(e) => setDraft({ ...draft, [a.id]: { qty: d?.qty ?? String(item?.planned_qty ?? ""), responsible: e.target.value } })}
                                      className="w-36 py-1"
                                    />
                                  </>
                                ) : null}
                              </div>
                            ) : item ? (
                              <span className="tabular-nums">
                                {n1(item.planned_qty)} {a.unit}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {editable ? (
              <div className="mt-3 flex gap-2">
                <Button disabled={busy || !Object.keys(draft).length} onClick={() => void savePlan(false)}>
                  Guardar borrador
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void savePlan(true)}>
                  Comprometer plan de la semana
                </Button>
              </div>
            ) : !canPlan ? (
              <p className="mt-2 text-sm text-zinc-500">El plan lo hacen el residente, el director o el administrador.</p>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-bold">Porcentaje de plan cumplido (PPC)</h2>
            {history.length === 0 ? (
              <p className="text-zinc-500">Todavía no hay semanas cerradas.</p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <ul className="space-y-1.5 text-sm">
                    {history.map(({ p, value }) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 tabular-nums">{weekLabel(p.week_start)}</span>
                        <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(value ?? 0) * 100}%`, background: (value ?? 0) >= 0.8 ? "var(--viz-good)" : "var(--viz-1)" }} />
                          <span className="absolute inset-y-0 w-0.5 bg-zinc-900 dark:bg-zinc-100" style={{ left: "80%" }} />
                        </span>
                        <b className="w-12 text-right tabular-nums">{value == null ? "—" : `${Math.round(value * 100)} %`}</b>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-zinc-500">La raya marca la meta del 80 %.</p>
                </div>
                <div>
                  <h3 className="mb-1 font-semibold">Por qué no se cumplió</h3>
                  {causes.length === 0 ? (
                    <p className="text-sm text-zinc-500">Todo lo comprometido se cumplió.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {causes.map(([k, v]) => (
                          <tr key={k} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1">{CAUSE_LABEL[k] ?? k}</td>
                            <td className="text-right font-semibold tabular-nums">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
