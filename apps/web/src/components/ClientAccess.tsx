"use client";

import { useEffect, useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface ClientRow {
  user_id: string;
  name: string;
  company: string | null;
  created_at: string;
}

/**
 * Acceso del cliente (interventoría, dueño): entra solo al portal, donde ve el avance, aprueba u
 * observa las actas y consulta las entregas del punch list. No es parte del equipo: no registra nada.
 */
export function ClientAccess({ projectId, projectName, tempPassword }: { projectId: string; projectName: string; tempPassword: () => string }) {
  const [rows, setRows] = useState<{ projectId: string; list: ClientRow[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void supabase
      .from("project_clients")
      .select("user_id, name, company, created_at")
      .eq("project_id", projectId)
      .order("name")
      .then(({ data }) => setRows({ projectId, list: (data ?? []) as ClientRow[] }));
  }, [projectId, version]);

  const list = rows?.projectId === projectId ? rows.list : [];

  async function add() {
    setMsg(null);
    setWelcome(null);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("team-create-user", { body: { project_id: projectId, role: "client", ...form } });
    setBusy(false);
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      return setMsg({ tone: "error", text: detail?.error ?? `No se pudo dar acceso: ${error.message}` });
    }
    const created = (data as { status: string }).status === "created";
    setMsg({ tone: "ok", text: `${form.name} ya puede entrar al portal del cliente.` });
    setWelcome(
      `Hola ${form.name}, ya tienes acceso al portal del cliente de AvanceObra (${projectName}): avance de la obra, actas de cobro para aprobar y entregas del punch list.\n` +
        `Entra en ${window.location.origin}/cliente con tu correo ${form.email}` +
        (created ? ` y la contraseña temporal ${form.password} (te pedirá cambiarla).` : " y tu contraseña de siempre."),
    );
    setForm({ name: "", company: form.company, email: "", password: "" });
    setVersion((v) => v + 1);
  }

  async function remove(c: ClientRow) {
    if (!window.confirm(`¿Quitar el acceso de ${c.name} al portal? Las actas que ya aprobó conservan su firma.`)) return;
    const { error } = await supabase.from("project_clients").delete().eq("project_id", projectId).eq("user_id", c.user_id);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: `${c.name} ya no entra al portal.` });
    setVersion((v) => v + 1);
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Acceso del cliente</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        El cliente o la interventoría entran a un portal propio: ven el avance, aprueban u observan las actas de cobro y consultan las entregas del punch list. No
        pueden registrar ni cambiar nada.
      </p>
      {list.length ? (
        <ul className="mb-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {list.map((c) => (
            <li key={c.user_id} className="flex items-center gap-3 py-2">
              <span className="mr-auto">
                <b>{c.name}</b>
                {c.company ? ` · ${c.company}` : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void remove(c)}>
                Quitar acceso
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Nombre del cliente">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="p. ej. Laura Gómez" />
        </Field>
        <Field label="Empresa del cliente">
          <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="p. ej. Interventoría ABC" />
        </Field>
        <Field label="Correo del cliente">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Contraseña temporal del cliente">
          <div className="flex gap-2">
            <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Button onClick={() => setForm({ ...form, password: tempPassword() })}>Generar</Button>
          </div>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy} onClick={() => void add()}>
          {busy ? "Dando acceso…" : "Dar acceso al portal"}
        </Button>
        {msg ? <span className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>{msg.text}</span> : null}
      </div>
      {welcome ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">Mensaje para enviarle (cópialo):</p>
          <pre className="mt-1 rounded-lg bg-zinc-100 p-3 text-sm whitespace-pre-wrap dark:bg-zinc-800">{welcome}</pre>
        </div>
      ) : null}
    </Card>
  );
}
