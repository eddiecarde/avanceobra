"use client";

import { materialStatus, type MaterialRow } from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { fetchAll, loadDashboard, localToday, type DashData } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Material {
  id: string;
  name: string;
  unit: string;
  low_days: number;
}
interface Usage {
  material_id: string;
  activity_id: string;
  factor: number;
}
interface Delivery {
  id: string;
  material_id: string;
  delivered_on: string;
  quantity: number;
  document: string | null;
  supplier: string | null;
}

const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const num = (s: string) => Number(s.trim().replace(/\./g, "").replace(",", "."));
const STATUS: Record<MaterialRow["status"], { label: string; tone: "green" | "blue" | "amber" | "red" }> = {
  covered: { label: "✓ Alcanza para terminar", tone: "green" },
  ok: { label: "● Suficiente", tone: "blue" },
  low: { label: "▲ Por agotarse", tone: "amber" },
  out: { label: "■ Agotado", tone: "red" },
};

/** Materiales en obra: entregas contra lo instalado (según el avance) y días que alcanzan las existencias. */
export default function Materiales() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canManage = role === "resident" || role === "director" || role === "admin";
  const today = localToday();
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<{ projectId: string; dash: DashData; materials: Material[]; usage: Usage[]; deliveries: Delivery[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [delivery, setDelivery] = useState({ material: "", date: today, qty: "", document: "", supplier: "" });
  const [newMat, setNewMat] = useState({ name: "", unit: "", low: "3" });
  const [linking, setLinking] = useState<{ material: string; group: string; activity: string; factor: string }>({ material: "", group: "", activity: "", factor: "1" });

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      loadDashboard(projectId),
      supabase.from("materials").select("id, name, unit, low_days").eq("project_id", projectId).order("name"),
      fetchAll((a, b) => supabase.from("material_usage").select("material_id, activity_id, factor").eq("project_id", projectId).order("material_id").order("activity_id").range(a, b)),
      supabase.from("material_deliveries").select("id, material_id, delivered_on, quantity, document, supplier").eq("project_id", projectId).order("delivered_on", { ascending: false }),
    ]).then(
      ([dash, m, u, d]) => {
        if (off) return;
        setData({
          projectId,
          dash,
          materials: (m.data ?? []) as Material[],
          usage: (u.data as Usage[]).map((x) => ({ ...x, factor: Number(x.factor) })),
          deliveries: ((d.data ?? []) as Delivery[]).map((x) => ({ ...x, quantity: Number(x.quantity) })),
        });
        setError(null);
      },
      (e: Error) => !off && setError(e.message),
    );
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const ready = data?.projectId === projectId ? data : null;
  const rows = useMemo(
    () =>
      ready
        ? materialStatus(
            ready.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, lowDays: m.low_days })),
            ready.usage.map((u) => ({ materialId: u.material_id, activityId: u.activity_id, factor: u.factor })),
            ready.dash.activities,
            ready.dash.daily,
            ready.deliveries.map((d) => ({ materialId: d.material_id, date: d.delivered_on, quantity: d.quantity })),
            today,
            ready.dash.project.calendar,
          )
        : [],
    [ready, today],
  );

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setMsg(null);
    const { error: e } = await fn();
    if (e) return setMsg({ tone: "error", text: e.message }), false;
    setMsg({ tone: "ok", text: ok });
    setVersion((v) => v + 1);
    return true;
  }

  async function addDelivery() {
    const qty = num(delivery.qty);
    if (!delivery.material) return setMsg({ tone: "error", text: "Elige el material que llegó." });
    if (!(qty > 0)) return setMsg({ tone: "error", text: "La cantidad entregada debe ser mayor que cero." });
    const me = (await supabase.auth.getUser()).data.user?.id;
    const ok = await run(
      () =>
        supabase.from("material_deliveries").insert({
          project_id: projectId,
          material_id: delivery.material,
          delivered_on: delivery.date,
          quantity: qty,
          document: delivery.document.trim() || null,
          supplier: delivery.supplier.trim() || null,
          created_by: me,
        }),
      "Entrega registrada.",
    );
    if (ok) setDelivery({ ...delivery, qty: "", document: "" });
  }

  async function addMaterial() {
    if (!newMat.name.trim() || !newMat.unit.trim()) return setMsg({ tone: "error", text: "Escribe el nombre y la unidad del material." });
    const ok = await run(
      () => supabase.from("materials").insert({ project_id: projectId, name: newMat.name.trim(), unit: newMat.unit.trim(), low_days: Math.max(1, Math.round(num(newMat.low) || 3)) }),
      `Material ${newMat.name.trim()} creado: ahora indica qué actividades lo consumen.`,
    );
    if (ok) setNewMat({ name: "", unit: "", low: "3" });
  }

  async function link() {
    if (!ready) return;
    const factor = num(linking.factor);
    if (!linking.material) return setMsg({ tone: "error", text: "Elige el material." });
    if (!(factor > 0)) return setMsg({ tone: "error", text: "El consumo por unidad debe ser mayor que cero." });
    // Una actividad, o todas las de un grupo de trabajo (p. ej. "Módulos" en los 19 subcampos)
    const acts = linking.activity ? ready.dash.activities.filter((a) => a.id === linking.activity) : ready.dash.activities.filter((a) => (a.workGroup ?? a.name) === linking.group);
    if (!acts.length) return setMsg({ tone: "error", text: "Elige una actividad o un grupo." });
    const ok = await run(
      () =>
        supabase
          .from("material_usage")
          .upsert(acts.map((a) => ({ material_id: linking.material, activity_id: a.id, project_id: projectId, factor })), { onConflict: "material_id,activity_id" }),
      `${acts.length} actividad(es) vinculadas.`,
    );
    if (ok) setLinking({ ...linking, activity: "", group: "" });
  }

  if (!projects.length) return <p className="text-zinc-500">No tienes proyectos asignados.</p>;
  const groups = ready ? [...new Set(ready.dash.activities.map((a) => a.workGroup ?? a.name))].sort() : [];
  const alertsCount = rows.filter((r) => r.status === "low" || r.status === "out").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Materiales en obra</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Lo entregado contra lo instalado según el avance registrado, y cuántos días de trabajo alcanzan las existencias.</p>
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
      {error ? <Card className="text-red-700">No se pudo cargar: {error}</Card> : null}
      {!ready ? (
        !error ? <p className="text-zinc-500">Cargando…</p> : null
      ) : (
        <>
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="mr-auto text-lg font-bold">Existencias</h2>
              {alertsCount ? <Badge tone="red">{`${alertsCount} material(es) por agotarse`}</Badge> : null}
            </div>
            {rows.length === 0 ? (
              <p className="text-zinc-500">Todavía no hay materiales: créalos abajo e indica qué actividades los consumen.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
                    <tr>
                      <th className="px-2 py-2">Material</th>
                      <th className="px-2 text-right">Requerido</th>
                      <th className="px-2 text-right">Entregado</th>
                      <th className="px-2 text-right">Instalado</th>
                      <th className="px-2 text-right">Existencias</th>
                      <th className="px-2 text-right">Consumo / día</th>
                      <th className="px-2 text-right">Alcanza para</th>
                      <th className="px-2">Se agota</th>
                      <th className="px-2 text-right">Falta por entregar</th>
                      <th className="px-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-2 font-semibold">
                          {r.name} <span className="font-normal text-zinc-500">({r.unit})</span>
                          {r.required === 0 ? <div className="text-xs font-normal text-amber-700 dark:text-amber-400">Sin actividades vinculadas</div> : null}
                        </td>
                        <td className="px-2 text-right tabular-nums">{n1(r.required)}</td>
                        <td className="px-2 text-right tabular-nums">{n1(r.delivered)}</td>
                        <td className="px-2 text-right tabular-nums">{n1(r.consumed)}</td>
                        <td className={cx("px-2 text-right font-semibold tabular-nums", r.stock < 0 && "text-red-700 dark:text-red-400")}>{n1(r.stock)}</td>
                        <td className="px-2 text-right tabular-nums">{n1(r.ratePerDay)}</td>
                        <td className="px-2 text-right tabular-nums">{r.status === "covered" ? "hasta terminar" : r.daysLeft == null ? "sin consumo" : `${n1(r.daysLeft)} días`}</td>
                        <td className="px-2 tabular-nums">{r.runOutDate ?? "—"}</td>
                        <td className="px-2 text-right tabular-nums">{n1(r.pendingDelivery)}</td>
                        <td className="px-2">
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.some((r) => r.stock < 0) ? (
                  <p className="mt-2 text-sm text-red-700 dark:text-red-400">Existencias negativas: se instaló más de lo entregado registrado. Falta registrar entregas.</p>
                ) : null}
                <p className="mt-2 text-xs text-zinc-500">
                  Consumo por día: promedio de las últimas dos semanas de trabajo. Cada mañana se avisa por Telegram si un material alcanza para menos de los días
                  configurados.
                </p>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-bold">Registrar una entrega</h2>
            <div className="grid gap-3 md:grid-cols-6">
              <Field label="Material" className="md:col-span-2">
                <Select value={delivery.material} onChange={(e) => setDelivery({ ...delivery, material: e.target.value })}>
                  <option value="">Elegir…</option>
                  {ready.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha">
                <Input type="date" value={delivery.date} max={today} onChange={(e) => setDelivery({ ...delivery, date: e.target.value })} />
              </Field>
              <Field label="Cantidad">
                <Input inputMode="decimal" value={delivery.qty} onChange={(e) => setDelivery({ ...delivery, qty: e.target.value })} />
              </Field>
              <Field label="Remisión" hint="(opcional)">
                <Input value={delivery.document} onChange={(e) => setDelivery({ ...delivery, document: e.target.value })} />
              </Field>
              <Field label="Proveedor" hint="(opcional)">
                <Input value={delivery.supplier} onChange={(e) => setDelivery({ ...delivery, supplier: e.target.value })} />
              </Field>
            </div>
            <Button variant="primary" className="mt-3" onClick={() => void addDelivery()}>
              Registrar entrega
            </Button>
            {ready.deliveries.length ? (
              <table className="mt-4 w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1">Fecha</th>
                    <th>Material</th>
                    <th className="text-right">Cantidad</th>
                    <th>Remisión</th>
                    <th>Proveedor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ready.deliveries.slice(0, 30).map((d) => {
                    const m = ready.materials.find((x) => x.id === d.material_id);
                    return (
                      <tr key={d.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 tabular-nums">{d.delivered_on}</td>
                        <td>{m?.name}</td>
                        <td className="text-right tabular-nums">
                          {n1(d.quantity)} {m?.unit}
                        </td>
                        <td>{d.document ?? "—"}</td>
                        <td>{d.supplier ?? "—"}</td>
                        <td className="text-right">
                          {canManage ? (
                            <Button size="sm" variant="ghost" onClick={() => window.confirm("¿Borrar esta entrega?") && void run(() => supabase.from("material_deliveries").delete().eq("id", d.id), "Entrega borrada.")}>
                              Borrar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </Card>

          {canManage ? (
            <Card>
              <h2 className="mb-2 text-lg font-bold">Materiales y consumo por actividad</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Nuevo material">
                  <Input value={newMat.name} onChange={(e) => setNewMat({ ...newMat, name: e.target.value })} placeholder="p. ej. Módulos 580 W" />
                </Field>
                <Field label="Unidad">
                  <Input value={newMat.unit} onChange={(e) => setNewMat({ ...newMat, unit: e.target.value })} placeholder="Ud, m, kg…" />
                </Field>
                <Field label="Avisar con menos de" hint="(días)">
                  <Input inputMode="numeric" value={newMat.low} onChange={(e) => setNewMat({ ...newMat, low: e.target.value })} />
                </Field>
                <div className="flex items-end">
                  <Button onClick={() => void addMaterial()}>Crear material</Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-5">
                <Field label="Material">
                  <Select value={linking.material} onChange={(e) => setLinking({ ...linking, material: e.target.value })}>
                    <option value="">Elegir…</option>
                    {ready.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Lo consume el grupo">
                  <Select value={linking.group} onChange={(e) => setLinking({ ...linking, group: e.target.value, activity: "" })}>
                    <option value="">—</option>
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="o solo la actividad">
                  <Select value={linking.activity} onChange={(e) => setLinking({ ...linking, activity: e.target.value })}>
                    <option value="">—</option>
                    {ready.dash.activities
                      .filter((a) => !linking.group || (a.workGroup ?? a.name) === linking.group)
                      .slice(0, 400)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Consumo por unidad" hint="(de la actividad)">
                  <Input inputMode="decimal" value={linking.factor} onChange={(e) => setLinking({ ...linking, factor: e.target.value })} />
                </Field>
                <div className="flex items-end">
                  <Button onClick={() => void link()}>Vincular</Button>
                </div>
              </div>
              <ul className="mt-4 space-y-1 text-sm">
                {ready.materials.map((m) => {
                  const us = ready.usage.filter((u) => u.material_id === m.id);
                  return (
                    <li key={m.id}>
                      <b>{m.name}</b>: {us.length ? `${us.length} actividad(es)` : "sin actividades vinculadas"}
                      {us.length ? (
                        <span className="text-zinc-500">
                          {" "}
                          ·{" "}
                          {[...new Set(us.map((u) => ready.dash.activities.find((a) => a.id === u.activity_id)).map((a) => a?.workGroup ?? a?.name))]
                            .slice(0, 4)
                            .join(", ")}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
