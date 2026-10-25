"use client";

import { addDays } from "@avanceobra/engine";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { localToday, LOSS_LABEL } from "@/lib/dashboard";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Status = "draft" | "submitted" | "approved" | "rejected";
const STATUS_LABEL: Record<Status, string> = { draft: "Borrador", submitted: "Enviado", approved: "Aprobado", rejected: "Rechazado" };
const STATUS_TONE: Record<Status, "neutral" | "amber" | "green" | "red"> = { draft: "neutral", submitted: "amber", approved: "green", rejected: "red" };

interface Activity {
  id: string;
  code: string;
  name: string;
  unit: string;
}

interface Entry {
  id: string;
  activity_id: string;
  work_date: string;
  quantity: number;
  effective_hours: number;
  lost_hours: number;
  loss_cause: string;
  crew_size: number;
  notes: string;
  status: Status;
  created_by: string;
  version: number;
  rejection_reason: string | null;
}

type Fields = { quantity: number; work_date: string; effective_hours: number; lost_hours: number; loss_cause: string; crew_size: number; notes: string };

interface Correction {
  id: string;
  entry_id: string;
  reason: string;
  previous: Fields;
  proposed: Fields;
  status: "pendiente" | "aprobada" | "rechazada" | "anulada";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result_version: number | null;
}

const FIELD_LABEL: Record<keyof Fields, string> = {
  quantity: "Cantidad",
  work_date: "Fecha",
  effective_hours: "Horas efectivas",
  lost_hours: "Horas perdidas",
  loss_cause: "Causa de pérdida",
  crew_size: "Personal",
  notes: "Notas",
};
const show = (k: keyof Fields, v: unknown) => (k === "loss_cause" ? (v === "none" ? "Ninguna" : (LOSS_LABEL[String(v)] ?? String(v))) : v === "" || v == null ? "—" : String(v));
const n1 = (n: number) => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** Lo que cambia una corrección, campo por campo: "Cantidad 10 → 1". */
function Changes({ c }: { c: Pick<Correction, "previous" | "proposed"> }) {
  const keys = (Object.keys(FIELD_LABEL) as (keyof Fields)[]).filter((k) => String(c.previous[k]) !== String(c.proposed[k]));
  return (
    <ul className="text-sm">
      {keys.map((k) => (
        <li key={k}>
          {FIELD_LABEL[k]}: <span className="text-zinc-500 line-through">{show(k, c.previous[k])}</span> → <b>{show(k, c.proposed[k])}</b>
        </li>
      ))}
    </ul>
  );
}

/**
 * Registros de avance y su verificación: el residente aprueba o rechaza lo enviado, y lo aprobado
 * solo se corrige con una solicitud (motivo, versión anterior y nueva) que decide otra persona.
 */
export default function Registros() {
  const { memberships, session } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useState("");
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const me = session?.user.id ?? "";
  const canApprove = role === "resident" || role === "admin";
  const canDecide = role === "resident" || role === "director" || role === "admin";

  const [from, setFrom] = useState(addDays(localToday(), -13));
  const [to, setTo] = useState(localToday());
  const [activity, setActivity] = useState("");
  const [status, setStatus] = useState("");
  const [acts, setActs] = useState<Activity[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<{ entry: Entry; form: Record<keyof Fields, string>; reason: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    let q = supabase
      .from("progress_entries")
      .select("id, activity_id, work_date, quantity, effective_hours, lost_hours, loss_cause, crew_size, notes, status, created_by, version, rejection_reason")
      .eq("project_id", projectId)
      .gte("work_date", from)
      .lte("work_date", to)
      .neq("status", "draft")
      .order("work_date", { ascending: false })
      .limit(500);
    if (activity) q = q.eq("activity_id", activity);
    if (status) q = q.eq("status", status);
    void Promise.all([
      supabase.from("activities").select("id, code, name, unit").eq("project_id", projectId).order("code"),
      q,
      supabase.from("entry_corrections").select("*").eq("project_id", projectId).order("requested_at", { ascending: false }).limit(300),
      supabase.from("memberships").select("user_id, member_name").eq("project_id", projectId),
    ]).then(([a, e, c, m]) => {
      if (off) return;
      setActs((a.data ?? []) as Activity[]);
      setEntries(((e.data ?? []) as Entry[]).map((x) => ({ ...x, quantity: Number(x.quantity) })));
      setCorrections((c.data ?? []) as Correction[]);
      setNames(Object.fromEntries((m.data ?? []).map((x: { user_id: string; member_name: string | null }) => [x.user_id, x.member_name ?? ""])));
      if (e.error) setMsg({ tone: "error", text: e.error.message });
    });
    return () => {
      off = true;
    };
  }, [projectId, from, to, activity, status, version]);

  const actOf = (id: string) => acts.find((a) => a.id === id);
  const who = (id: string | null) => (!id ? "—" : id === me ? "tú" : names[id] || "otra persona");
  const pending = corrections.filter((c) => c.status === "pendiente");
  const entryOfCorrection = (c: Correction) => entries.find((e) => e.id === c.entry_id);
  const reload = () => setVersion((v) => v + 1);

  /** Llamada a la base con mensaje de resultado (los errores vienen en español desde las funciones). */
  async function act(run: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setMsg(null);
    const { error } = await run();
    setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: ok });
    reload();
    return !error;
  }

  function startCorrection(e: Entry) {
    setEditing({
      entry: e,
      reason: "",
      form: {
        quantity: String(e.quantity),
        work_date: e.work_date,
        effective_hours: String(e.effective_hours),
        lost_hours: String(e.lost_hours),
        loss_cause: e.loss_cause,
        crew_size: String(e.crew_size),
        notes: e.notes,
      },
    });
  }

  async function sendCorrection() {
    if (!editing) return;
    const e = editing.entry;
    const f = editing.form;
    const num = (s: string) => Number(s.replace(",", "."));
    const next: Fields = {
      quantity: num(f.quantity),
      work_date: f.work_date,
      effective_hours: num(f.effective_hours),
      lost_hours: num(f.lost_hours),
      loss_cause: f.loss_cause,
      crew_size: Math.round(num(f.crew_size)),
      notes: f.notes,
    };
    if (Object.values(next).some((v) => typeof v === "number" && !Number.isFinite(v))) return setMsg({ tone: "error", text: "Revisa los números de la corrección." });
    // Solo se envía lo que cambia
    const changes = Object.fromEntries((Object.keys(next) as (keyof Fields)[]).filter((k) => String(next[k]) !== String(e[k])).map((k) => [k, next[k]]));
    if (!Object.keys(changes).length) return setMsg({ tone: "error", text: "La corrección no cambia nada del registro." });
    if (editing.reason.trim().length < 10) return setMsg({ tone: "error", text: "Explica el motivo de la corrección (al menos 10 letras)." });
    if (await act(() => supabase.rpc("request_correction", { p_entry: e.id, p_reason: editing.reason.trim(), p_changes: changes }), "Corrección enviada: queda pendiente hasta que otra persona la apruebe."))
      setEditing(null);
  }

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Registros y correcciones</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Lo reportado en campo, su aprobación y las correcciones con su historial de versiones.</p>
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

      <Card>
        <h2 className="mb-2 text-lg font-bold">Correcciones pendientes ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-zinc-500">No hay correcciones por decidir.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pending.map((c) => {
              const e = entryOfCorrection(c);
              const a = e ? actOf(e.activity_id) : undefined;
              const mine = c.requested_by === me;
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-4 py-3">
                  <div className="min-w-64 flex-1">
                    <div className="font-semibold">
                      {a ? `${a.code} · ${a.name}` : "Registro"} · {c.previous.work_date}
                    </div>
                    <Changes c={c} />
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      Motivo: {c.reason} · pedida por {who(c.requested_by)} el {new Date(c.requested_at).toLocaleDateString("es-CO")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canDecide && (!mine || role === "admin") ? (
                      <>
                        <Input
                          value={notes[c.id] ?? ""}
                          onChange={(ev) => setNotes({ ...notes, [c.id]: ev.target.value })}
                          placeholder="Nota (obligatoria para rechazar)"
                          aria-label={`Nota de la decisión de la corrección de ${a?.code ?? "registro"}`}
                          className="w-64 py-1"
                        />
                        <Button size="sm" variant="primary" onClick={() => void act(() => supabase.rpc("decide_correction", { p_id: c.id, p_approve: true, p_note: notes[c.id] ?? null }), "Corrección aprobada y aplicada al registro.")}>
                          Aprobar
                        </Button>
                        <Button size="sm" onClick={() => void act(() => supabase.rpc("decide_correction", { p_id: c.id, p_approve: false, p_note: notes[c.id] ?? null }), "Corrección rechazada: el registro no cambia.")}>
                          Rechazar
                        </Button>
                      </>
                    ) : mine ? (
                      <span className="text-sm text-zinc-500">Esperando que otra persona la decida</span>
                    ) : null}
                    {mine ? (
                      <Button size="sm" variant="ghost" onClick={() => void act(() => supabase.rpc("cancel_correction", { p_id: c.id }), "Corrección anulada.")}>
                        Anular
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Desde">
            <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
          <Field label="Actividad">
            <Select value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="">Todas</option>
              {acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="submitted">Enviados (por aprobar)</option>
              <option value="approved">Aprobados</option>
              <option value="rejected">Rechazados</option>
            </Select>
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-3">Fecha</th>
                <th className="pr-3">Actividad</th>
                <th className="pr-3 text-right">Cantidad</th>
                <th className="pr-3 text-right">Horas</th>
                <th className="pr-3">Estado</th>
                <th className="pr-3">Autor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const a = actOf(e.activity_id);
                const done = corrections.filter((c) => c.entry_id === e.id && c.status !== "pendiente");
                const open = corrections.some((c) => c.entry_id === e.id && c.status === "pendiente");
                const canRequest = e.status === "approved" && !open && (e.created_by === me || canDecide);
                return (
                  <Fragment key={e.id}>
                    <tr className="border-b border-zinc-100 align-top dark:border-zinc-800">
                      <td className="py-2 pr-3 tabular-nums">{e.work_date}</td>
                      <td className="py-2 pr-3">
                        <b>{a?.code}</b> · {a?.name}
                        {e.notes ? <div className="text-sm text-zinc-500">{e.notes}</div> : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {n1(e.quantity)} {a?.unit}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {n1(e.effective_hours)}
                        {e.lost_hours > 0 ? <div className="text-sm text-zinc-500">−{n1(e.lost_hours)} {LOSS_LABEL[e.loss_cause] ?? ""}</div> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                        {e.version > 1 && done.some((c) => c.status === "aprobada") ? <span className="ml-1 text-xs text-zinc-500">corregido</span> : null}
                        {open ? <div className="text-xs font-semibold text-amber-700">Corrección pendiente</div> : null}
                        {e.status === "rejected" && e.rejection_reason ? <div className="text-xs text-red-700">{e.rejection_reason}</div> : null}
                      </td>
                      <td className="py-2 pr-3">{who(e.created_by)}</td>
                      <td className="py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {e.status === "submitted" && canApprove ? (
                            <>
                              <Button size="sm" variant="primary" onClick={() => void act(() => supabase.from("progress_entries").update({ status: "approved" }).eq("id", e.id), "Registro aprobado.")}>
                                Aprobar
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  const reason = window.prompt("¿Por qué se rechaza? (lo verá quien lo registró)")?.trim();
                                  if (reason) void act(() => supabase.from("progress_entries").update({ status: "rejected", rejection_reason: reason }).eq("id", e.id), "Registro rechazado.");
                                }}
                              >
                                Rechazar
                              </Button>
                            </>
                          ) : null}
                          {canRequest ? (
                            <Button size="sm" onClick={() => startCorrection(e)}>
                              Pedir corrección
                            </Button>
                          ) : null}
                          {done.length ? (
                            <Button size="sm" variant="ghost" onClick={() => setHistory(history === e.id ? null : e.id)} aria-expanded={history === e.id}>
                              Historial ({done.length})
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {editing?.entry.id === e.id ? (
                      <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                        <td colSpan={7} className="p-3">
                          <div className="mb-2 font-semibold">Corrección del registro (versión {e.version})</div>
                          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                            {(["quantity", "work_date", "effective_hours", "lost_hours", "crew_size"] as const).map((k) => (
                              <Field key={k} label={k === "quantity" ? `Cantidad (${a?.unit ?? ""})` : FIELD_LABEL[k]}>
                                <Input
                                  type={k === "work_date" ? "date" : "text"}
                                  inputMode={k === "work_date" ? undefined : "decimal"}
                                  value={editing.form[k]}
                                  onChange={(ev) => setEditing({ ...editing, form: { ...editing.form, [k]: ev.target.value } })}
                                />
                              </Field>
                            ))}
                            <Field label="Causa de pérdida">
                              <Select value={editing.form.loss_cause} onChange={(ev) => setEditing({ ...editing, form: { ...editing.form, loss_cause: ev.target.value } })}>
                                <option value="none">Ninguna</option>
                                {Object.entries(LOSS_LABEL).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Notas" className="sm:col-span-3 lg:col-span-6">
                              <Input value={editing.form.notes} onChange={(ev) => setEditing({ ...editing, form: { ...editing.form, notes: ev.target.value } })} />
                            </Field>
                            <Field label="Motivo de la corrección" hint="(obligatorio; queda en el historial)" className="sm:col-span-3 lg:col-span-6">
                              <Textarea rows={2} value={editing.reason} onChange={(ev) => setEditing({ ...editing, reason: ev.target.value })} placeholder="p. ej. Se digitó 10 en vez de 1; verificado contra el plano" />
                            </Field>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <Button variant="primary" onClick={() => void sendCorrection()}>
                              Enviar corrección
                            </Button>
                            <Button variant="ghost" onClick={() => setEditing(null)}>
                              Cancelar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {history === e.id ? (
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <td colSpan={7} className="p-3">
                          <ol className="space-y-2">
                            {done.map((c) => (
                              <li key={c.id} className="text-sm">
                                <Badge tone={c.status === "aprobada" ? "green" : c.status === "rechazada" ? "red" : "neutral"}>
                                  {c.status === "aprobada" ? `Aprobada · versión ${c.result_version}` : c.status === "rechazada" ? "Rechazada" : "Anulada"}
                                </Badge>{" "}
                                pedida por {who(c.requested_by)} el {new Date(c.requested_at).toLocaleDateString("es-CO")}, decidida por {who(c.decided_by)}
                                {c.decided_at ? ` el ${new Date(c.decided_at).toLocaleDateString("es-CO")}` : ""}
                                <Changes c={c} />
                                <div className="text-zinc-600 dark:text-zinc-400">
                                  Motivo: {c.reason}
                                  {c.decision_note ? ` · Nota: ${c.decision_note}` : ""}
                                </div>
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? <p className="mt-2 text-zinc-500">No hay registros con estos filtros.</p> : null}
        {entries.length === 500 ? <p className="mt-2 text-sm text-amber-700">Se muestran los 500 más recientes: acota las fechas para ver el resto.</p> : null}
      </Card>
    </div>
  );
}
