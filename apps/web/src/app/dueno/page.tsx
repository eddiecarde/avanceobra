"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Company {
  id: string;
  name: string;
  tax_id: string | null;
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  projects: number;
  project_names: string[];
  users: number;
  admins: string[];
  last_sign_in: string | null;
  last_entry: string | null;
  entries_30d: number;
}

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Contraseña temporal legible (sin 0/O ni 1/l para dictarla o copiarla sin errores). */
function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join("");
  return `${pick(5)}-${pick(5)}-${Math.floor(10 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 90))}`;
}

const EMPTY = { company_name: "", tax_id: "", admin_name: "", admin_email: "", password: "", project_name: "", project_code: "", start: "", end: "" };

/** Panel del dueño de la plataforma: empresas, su uso, alta de empresas nuevas y suspensión. */
export default function Dueno() {
  const { isPlatformAdmin } = useSession();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    void supabase.rpc("platform_companies").then(({ data, error }) => {
      if (error) setMsg({ tone: "error", text: error.message });
      else setCompanies((data ?? []) as Company[]);
    });
  }, [isPlatformAdmin, version]);

  if (!isPlatformAdmin) return <p className="text-zinc-600">Esta página es solo para el dueño de la plataforma.</p>;

  async function toggle(c: Company) {
    setMsg(null);
    const suspend = !c.suspended_at;
    let reason: string | null = null;
    if (suspend) {
      reason = window.prompt(`¿Por qué se suspende ${c.name}? Su gente no podrá entrar hasta que la reactives; los datos se conservan.`);
      if (!reason) return;
    } else if (!window.confirm(`¿Reactivar ${c.name}? Su gente vuelve a entrar con todo como estaba.`)) return;
    const { error } = await supabase.rpc("platform_set_suspended", { p_org: c.id, p_suspended: suspend, p_reason: reason });
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: suspend ? `${c.name} quedó suspendida.` : `${c.name} quedó activa de nuevo.` });
    setVersion((v) => v + 1);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setWelcome(null);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("platform-create-company", { body: form });
    setBusy(false);
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      return setMsg({ tone: "error", text: detail?.error ?? `No se pudo crear: ${error.message}` });
    }
    const created = (data as { status: string }).status === "created";
    setMsg({ tone: "ok", text: `${form.company_name} quedó creada con su primera obra.` });
    setWelcome(
      `Hola ${form.admin_name}, ya tienes acceso a AvanceObra como administrador de ${form.company_name}.\n` +
        `Entra en ${window.location.origin} con tu correo ${form.admin_email}` +
        (created ? ` y la contraseña temporal ${form.password} (te pedirá cambiarla).` : " y tu contraseña de siempre.") +
        `\nTu primera obra, ${form.project_name}, ya está creada: carga su programación en Programación y agrega a tu equipo en Equipo.`,
    );
    setForm(EMPTY);
    setVersion((v) => v + 1);
  }

  const set = (k: keyof typeof EMPTY, v: string) => setForm({ ...form, [k]: v });
  const active = companies?.filter((c) => !c.suspended_at).length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Panel del dueño</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Las empresas que usan AvanceObra. Cada una ve solo sus obras; su administrador crea obras y maneja su equipo. Aquí das de alta empresas nuevas y las
          suspendes o reactivas.
        </p>
      </div>
      {msg ? (
        <p role="status" className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>
          {msg.text}
        </p>
      ) : null}

      <Card>
        <h2 className="text-lg font-bold">
          Empresas {companies ? `(${active} activa${active === 1 ? "" : "s"} de ${companies.length})` : ""}
        </h2>
        {!companies ? (
          <p className="text-zinc-500">Cargando…</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1">Empresa</th>
                  <th className="text-right">Obras</th>
                  <th className="text-right">Usuarios</th>
                  <th>Administradores</th>
                  <th>Último ingreso</th>
                  <th className="text-right">Registros (30 días)</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-2">
                      <b>{c.name}</b>
                      {c.tax_id ? <div className="text-xs text-zinc-500">NIT {c.tax_id}</div> : null}
                      <div className="text-xs text-zinc-500" title={c.project_names.join(", ")}>
                        {c.project_names.slice(0, 3).join(" · ")}
                        {c.project_names.length > 3 ? " …" : ""}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{c.projects}</td>
                    <td className="text-right tabular-nums">{c.users}</td>
                    <td>{c.admins.join(", ") || "—"}</td>
                    <td>{when(c.last_sign_in)}</td>
                    <td className="text-right tabular-nums">{c.entries_30d}</td>
                    <td>
                      {c.suspended_at ? (
                        <>
                          <Badge tone="red">Suspendida</Badge>
                          <div className="text-xs text-zinc-500">{c.suspended_reason}</div>
                        </>
                      ) : (
                        <Badge tone="green">Activa</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant={c.suspended_at ? "primary" : "ghost"} onClick={() => void toggle(c)}>
                        {c.suspended_at ? "Reactivar" : "Suspender"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Dar de alta una empresa</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Se crea la empresa, su administrador (con contraseña temporal; si el correo ya tiene cuenta, entra con la suya) y su primera obra. Desde ahí la empresa
          se maneja sola.
        </p>
        <form onSubmit={(e) => void create(e)} className="grid gap-3 md:grid-cols-2">
          <Field label="Nombre de la empresa">
            <Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="p. ej. Constructora Andina SAS" />
          </Field>
          <Field label="NIT" hint="(opcional)">
            <Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} placeholder="p. ej. 900123456-7" />
          </Field>
          <Field label="Nombre del administrador">
            <Input value={form.admin_name} onChange={(e) => set("admin_name", e.target.value)} placeholder="p. ej. Carolina Ruiz" />
          </Field>
          <Field label="Correo del administrador">
            <Input type="email" value={form.admin_email} onChange={(e) => set("admin_email", e.target.value)} />
          </Field>
          <Field label="Contraseña temporal del administrador">
            <div className="flex gap-2">
              <Input value={form.password} onChange={(e) => set("password", e.target.value)} />
              <Button type="button" onClick={() => set("password", tempPassword())}>
                Generar
              </Button>
            </div>
          </Field>
          <Field label="Primera obra">
            <Input value={form.project_name} onChange={(e) => set("project_name", e.target.value)} placeholder="p. ej. Parque Solar Norte" />
          </Field>
          <Field label="Código de la obra">
            <Input value={form.project_code} onChange={(e) => set("project_code", e.target.value.toUpperCase())} placeholder="p. ej. PSN-01" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio">
              <Input type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
            </Field>
            <Field label="Terminación">
              <Input type="date" value={form.end} onChange={(e) => set("end", e.target.value)} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creando…" : "Crear empresa"}
            </Button>
          </div>
        </form>
        {welcome ? (
          <div className="mt-3">
            <p className="text-sm font-semibold">Mensaje para enviarle (cópialo):</p>
            <pre className="mt-1 rounded-lg bg-zinc-100 p-3 text-sm whitespace-pre-wrap dark:bg-zinc-800">{welcome}</pre>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
