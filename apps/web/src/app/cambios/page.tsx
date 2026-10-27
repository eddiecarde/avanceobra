"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { cop, qty } from "@/lib/actas";
import { fetchAll } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Activity {
  id: string;
  front_id: string;
  code: string;
  name: string;
  unit: string;
  contract_qty: number;
  unit_price: number | null;
  subcontract_unit_price: number | null;
  company_id: string | null;
}
interface Item {
  id: string;
  activity_id: string | null;
  delta_qty: number;
  new_unit_price: number | null;
  new_front_id: string | null;
  new_code: string | null;
  new_name: string | null;
  new_unit: string | null;
  old_qty: number | null;
  old_unit_price: number | null;
}
interface Order {
  id: string;
  project_id: string;
  company_id: string | null;
  number: number;
  title: string;
  description: string | null;
  reason: string;
  days_extension: number;
  status: "borrador" | "enviada" | "aprobada" | "rechazada" | "anulada";
  amount: number | null;
  decided_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  items: Item[];
}

const REASON: Record<string, string> = {
  cliente: "Solicitud del cliente",
  diseno: "Cambio de diseño",
  condiciones_sitio: "Condiciones del sitio",
  omision: "Omisión en el contrato",
  otro: "Otro",
};
const STATUS: Record<Order["status"], { label: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  borrador: { label: "Borrador", tone: "neutral" },
  enviada: { label: "Por aprobar", tone: "amber" },
  aprobada: { label: "Aprobada", tone: "green" },
  rechazada: { label: "Rechazada", tone: "red" },
  anulada: { label: "Anulada", tone: "neutral" },
};
const num = (s: string) => {
  const n = Number(s.trim().replace(/[$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Órdenes de cambio (adicionales y menores cantidades) del contrato con el cliente y de cada subcontrato. */
export default function Cambios() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const me = memberships.find((m) => m.project_id === projectId);
  const canSee = me?.role === "resident" || me?.role === "director" || me?.role === "admin";
  const canEdit = !me?.sub_company_id && (me?.role === "director" || me?.role === "admin");
  const [data, setData] = useState<{
    projectId: string;
    orders: Order[];
    activities: Activity[];
    fronts: { id: string; code: string; name: string }[];
    companies: { id: string; name: string }[];
    client: string | null;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [targetKey, setTargetKey] = useState("cliente");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId || !canSee) return;
    let off = false;
    void Promise.all([
      supabase.from("change_orders").select("*, items:change_order_items(*)").eq("project_id", projectId).order("number", { ascending: false }),
      fetchAll<Activity>((a, b) =>
        supabase
          .from("activities")
          .select("id, front_id, code, name, unit, contract_qty, unit_price, subcontract_unit_price, company_id")
          .eq("project_id", projectId)
          .order("code")
          .order("id")
          .range(a, b),
      ),
      supabase.from("fronts").select("id, code, name").eq("project_id", projectId).order("code"),
      supabase.from("project_companies").select("id, name, kind").eq("project_id", projectId).eq("kind", "subcontratista").order("name"),
      supabase.from("projects").select("client_name").eq("id", projectId).single(),
    ]).then(([o, a, f, c, p]) => {
      if (off) return;
      const err = o.error ?? a.error ?? f.error;
      if (err) return setMsg({ tone: "error", text: err.message });
      setData({
        projectId,
        orders: ((o.data ?? []) as Order[]).map((x) => ({ ...x, items: x.items ?? [] })),
        activities: a.data.map((x) => ({ ...x, contract_qty: Number(x.contract_qty) })),
        fronts: f.data ?? [],
        companies: (c.data ?? []) as { id: string; name: string }[],
        client: p.data?.client_name ?? null,
      });
    });
    return () => {
      off = true;
    };
  }, [projectId, canSee, version]);

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  if (!canSee) return <p className="text-zinc-600">Las órdenes de cambio las ven el residente, el director y el administrador.</p>;
  const current = data?.projectId === projectId ? data : null;
  const companyId = targetKey === "cliente" ? null : targetKey;
  const orders = current?.orders.filter((o) => o.company_id === companyId) ?? [];
  const approved = orders.filter((o) => o.status === "aprobada");

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setMsg(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: ok });
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Órdenes de cambio</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Adicionales, mayores o menores cantidades y precios nuevos. Al aprobarse se aplican solas al contrato: actas, valor ganado y programación las usan.
          </p>
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
        {current ? (
          <Field label="Contrato">
            <Select value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              <option value="cliente">Cliente: {current.client ?? "contrato principal"}</option>
              {current.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  Subcontratista: {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      {msg ? (
        <p role="status" className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>
          {msg.text}
        </p>
      ) : null}

      {!current ? (
        <p className="text-zinc-500">Cargando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Aprobadas</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{approved.length}</p>
            </Card>
            <Card>
              <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Valor aprobado</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{cop(approved.reduce((t, o) => t + Number(o.amount ?? 0), 0))}</p>
            </Card>
            <Card>
              <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Prórroga aprobada</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{approved.reduce((t, o) => t + o.days_extension, 0)} días</p>
            </Card>
          </div>

          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              activities={current.activities}
              fronts={current.fronts}
              isClient={companyId === null}
              canEdit={canEdit}
              onRpc={rpc}
              onChanged={() => setVersion((v) => v + 1)}
              onMessage={setMsg}
            />
          ))}
          {!orders.length ? <Card className="text-zinc-500">Este contrato no tiene órdenes de cambio.</Card> : null}

          {canEdit ? (
            <NewOrder
              projectId={projectId}
              companyId={companyId}
              next={Math.max(0, ...orders.map((o) => o.number)) + 1}
              onCreated={() => setVersion((v) => v + 1)}
              onMessage={setMsg}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function OrderCard({
  order,
  activities,
  fronts,
  isClient,
  canEdit,
  onRpc,
  onChanged,
  onMessage,
}: {
  order: Order;
  activities: Activity[];
  fronts: { id: string; code: string; name: string }[];
  isClient: boolean;
  canEdit: boolean;
  onRpc: (fn: string, args: Record<string, unknown>, ok: string) => Promise<void>;
  onChanged: () => void;
  onMessage: (m: { tone: "ok" | "error"; text: string }) => void;
}) {
  const priceOf = (a: Activity | undefined) => (a ? (isClient ? a.unit_price : a.subcontract_unit_price) : null);
  const [line, setLine] = useState({ kind: "existente", activity_id: "", delta: "", price: "", front: fronts[0]?.id ?? "", code: "", name: "", unit: "" });
  // Valor estimado mientras es borrador; al enviarla queda el de la base de datos
  const estimate = order.items.reduce((t, i) => {
    const a = activities.find((x) => x.id === i.activity_id);
    if (!a) return t + i.delta_qty * Number(i.new_unit_price ?? 0);
    const p = Number(priceOf(a) ?? 0);
    return t + (a.contract_qty + Number(i.delta_qty)) * Number(i.new_unit_price ?? p) - a.contract_qty * p;
  }, 0);

  async function addLine() {
    const delta = num(line.delta);
    const price = line.price.trim() ? num(line.price) : null;
    if (!Number.isFinite(delta) || delta === 0) return onMessage({ tone: "error", text: "Escribe la cantidad que se agrega (o quita, con signo menos)." });
    const row =
      line.kind === "existente"
        ? { activity_id: line.activity_id, delta_qty: delta, new_unit_price: price }
        : { new_front_id: line.front, new_code: line.code.trim(), new_name: line.name.trim(), new_unit: line.unit.trim(), delta_qty: delta, new_unit_price: price };
    if (line.kind === "existente" && !line.activity_id) return onMessage({ tone: "error", text: "Elige la actividad." });
    const { error } = await supabase.from("change_order_items").insert({ change_order_id: order.id, project_id: order.project_id, ...row });
    if (error) return onMessage({ tone: "error", text: error.message.includes("check") ? "Una actividad nueva necesita frente, código, nombre, unidad, cantidad y precio." : error.message });
    setLine({ ...line, activity_id: "", delta: "", price: "", code: "", name: "", unit: "" });
    onChanged();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-bold">
            N° {order.number} · {order.title}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {REASON[order.reason] ?? order.reason}
            {order.days_extension ? ` · prórroga de ${order.days_extension} días` : ""}
            {order.description ? ` · ${order.description}` : ""}
          </p>
        </div>
        <Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge>
        <span className="text-lg font-extrabold tabular-nums">{cop(order.amount ?? estimate)}</span>
      </div>
      {order.items.length ? (
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1">Actividad</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Precio</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => {
              const a = activities.find((x) => x.id === i.activity_id);
              return (
                <tr key={i.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1">
                    {a ? `${a.code} · ${a.name}` : `${i.new_code} · ${i.new_name}`}
                    {!i.activity_id ? <Badge tone="blue">Nueva</Badge> : null}
                  </td>
                  <td className={cx("text-right tabular-nums", i.delta_qty < 0 && "text-red-700 dark:text-red-400")}>
                    {i.delta_qty > 0 ? "+" : ""}
                    {qty(Number(i.delta_qty))} {a?.unit ?? i.new_unit}
                  </td>
                  <td className="text-right tabular-nums">{i.new_unit_price != null ? cop(Number(i.new_unit_price)) : "sin cambio"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Sin renglones todavía.</p>
      )}
      {order.decided_at ? (
        <p className="mt-2 text-sm">
          <b>{STATUS[order.status].label}</b> {order.decided_name ? `por ${order.decided_name}` : ""} el {new Date(order.decided_at).toLocaleDateString("es-CO")}
          {order.decision_note ? `: ${order.decision_note}` : "."}
        </p>
      ) : null}

      {canEdit && order.status === "borrador" ? (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Renglón">
              <Select value={line.kind} onChange={(e) => setLine({ ...line, kind: e.target.value })}>
                <option value="existente">Actividad existente</option>
                <option value="nueva">Actividad nueva</option>
              </Select>
            </Field>
            {line.kind === "existente" ? (
              <Field label="Actividad" className="min-w-64 flex-1">
                <Select value={line.activity_id} onChange={(e) => setLine({ ...line, activity_id: e.target.value })}>
                  <option value="">Elige la actividad</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name} ({qty(a.contract_qty)} {a.unit})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <>
                <Field label="Frente">
                  <Select value={line.front} onChange={(e) => setLine({ ...line, front: e.target.value })}>
                    {fronts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Código">
                  <Input value={line.code} onChange={(e) => setLine({ ...line, code: e.target.value })} className="w-28" />
                </Field>
                <Field label="Nombre" className="min-w-48 flex-1">
                  <Input value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })} />
                </Field>
                <Field label="Unidad">
                  <Input value={line.unit} onChange={(e) => setLine({ ...line, unit: e.target.value })} className="w-20" />
                </Field>
              </>
            )}
            <Field label="Cantidad" hint="(+ o −)">
              <Input inputMode="decimal" value={line.delta} onChange={(e) => setLine({ ...line, delta: e.target.value })} className="w-28" />
            </Field>
            <Field label={line.kind === "nueva" ? "Precio unitario" : "Precio nuevo"} hint={line.kind === "nueva" ? "" : "(vacío = igual)"}>
              <Input inputMode="numeric" value={line.price} onChange={(e) => setLine({ ...line, price: e.target.value })} className="w-36" />
            </Field>
            <Button onClick={() => void addLine()}>Agregar renglón</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!order.items.length} onClick={() => void onRpc("submit_change_order", { p_id: order.id }, `Orden N° ${order.number} enviada a aprobación.`)}>
              Enviar a aprobación
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const { error } = await supabase.from("change_orders").delete().eq("id", order.id);
                if (error) return onMessage({ tone: "error", text: error.message });
                onMessage({ tone: "ok", text: `Borrador N° ${order.number} eliminado.` });
                onChanged();
              }}
            >
              Eliminar borrador
            </Button>
          </div>
        </div>
      ) : null}

      {canEdit && order.status === "enviada" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              const note = isClient ? window.prompt("¿Quién del cliente la aprobó y con qué documento? (oficio, correo, acta)") : (window.prompt("Nota de aprobación (opcional)") ?? "");
              if (isClient && !note) return;
              void onRpc("decide_change_order", { p_id: order.id, p_approve: true, p_note: note }, `Orden N° ${order.number} aprobada y aplicada al contrato.`);
            }}
          >
            {isClient ? "Registrar aprobación del cliente" : "Aprobar"}
          </Button>
          <Button
            onClick={() => {
              const note = window.prompt("¿Por qué se rechaza?");
              if (!note) return;
              void onRpc("decide_change_order", { p_id: order.id, p_approve: false, p_note: note }, `Orden N° ${order.number} rechazada.`);
            }}
          >
            Rechazar
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const reason = window.prompt("¿Por qué se anula?");
              if (!reason) return;
              void onRpc("void_change_order", { p_id: order.id, p_reason: reason }, `Orden N° ${order.number} anulada.`);
            }}
          >
            Anular
          </Button>
          {isClient ? <span className="self-center text-sm text-zinc-500">El cliente también puede aprobarla desde su portal.</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function NewOrder({
  projectId,
  companyId,
  next,
  onCreated,
  onMessage,
}: {
  projectId: string;
  companyId: string | null;
  next: number;
  onCreated: () => void;
  onMessage: (m: { tone: "ok" | "error"; text: string }) => void;
}) {
  const [f, setF] = useState({ title: "", reason: "cliente", days: "0", description: "" });
  async function create() {
    const { error } = await supabase.from("change_orders").insert({
      project_id: projectId,
      company_id: companyId,
      number: next,
      title: f.title.trim(),
      reason: f.reason,
      days_extension: Math.max(0, Math.round(Number(f.days) || 0)),
      description: f.description.trim() || null,
    });
    if (error) return onMessage({ tone: "error", text: error.message });
    onMessage({ tone: "ok", text: `Orden N° ${next} creada como borrador: agrégale sus renglones.` });
    setF({ title: "", reason: "cliente", days: "0", description: "" });
    onCreated();
  }
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Nueva orden de cambio (N° {next})</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Título" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="p. ej. Cerramiento adicional sector norte" />
        </Field>
        <Field label="Motivo">
          <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {Object.entries(REASON).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prórroga" hint="(días)">
          <Input inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        </Field>
        <Field label="Descripción" className="md:col-span-4">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      <Button className="mt-3" variant="primary" disabled={f.title.trim().length < 3} onClick={() => void create()}>
        Crear borrador
      </Button>
    </Card>
  );
}
