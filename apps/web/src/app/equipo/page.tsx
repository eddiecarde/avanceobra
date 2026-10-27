"use client";

import { useEffect, useMemo, useState } from "react";
import { ClientAccess } from "@/components/ClientAccess";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Role = "field" | "resident" | "director" | "admin";
const ROLE_LABEL: Record<Role, string> = { field: "Supervisor de campo", resident: "Residente", director: "Director", admin: "Administrador" };
const ROLE_HELP: Record<Role, string> = {
  field: "Registra avance, parte diario y hallazgos desde el teléfono.",
  resident: "Además aprueba registros, cierra hallazgos y lleva ensayos y restricciones.",
  director: "Ve todo, usa el simulador y comparte el dashboard.",
  admin: "Todo lo anterior, más configurar el proyecto, importar la programación y gestionar el equipo.",
};

type Kind = "contratista" | "subcontratista";
const KIND_LABEL: Record<Kind, string> = { contratista: "Contratista", subcontratista: "Subcontratista" };

interface Company {
  id: string;
  name: string;
  kind: Kind;
}

interface Member {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  telegram_linked: boolean;
  last_sign_in_at: string | null;
  must_change_password: boolean;
  company_id: string | null;
}

/** Contraseña temporal legible (sin 0/O ni 1/l para dictarla o copiarla sin errores). */
function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join("");
  return `${pick(5)}-${pick(5)}-${Math.floor(10 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 90))}`;
}

/** Equipo del proyecto: crear usuarios con contraseña temporal, agruparlos por empresa, cambiar roles, retirar y ver Telegram. */
export default function Equipo() {
  const { memberships, session } = useSession();
  const projects = useMemo(
    () => [...new Map(memberships.filter((m) => m.project && m.role === "admin").map((m) => [m.project_id, m.project!])).values()],
    [memberships],
  );
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const project = projects.find((p) => p.id === projectId);
  const [team, setTeam] = useState<{ projectId: string; rows: Member[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [companies, setCompanies] = useState<{ projectId: string; rows: Company[] } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "field" as Role, password: "", company_id: "" });
  const [newCompany, setNewCompany] = useState({ name: "", kind: "subcontratista" as Kind });
  const [editing, setEditing] = useState<{ userId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  // Mensaje con la contraseña temporal recién restablecida (para enviársela a la persona)
  const [resetNote, setResetNote] = useState<string | null>(null);
  const [formMsg, setFormMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void supabase.rpc("project_team", { p_project: projectId }).then(({ data, error }) => {
      if (off) return;
      if (error) setMsg({ tone: "error", text: error.message });
      setTeam({ projectId, rows: (data ?? []) as Member[] });
    });
    void supabase
      .from("project_companies")
      .select("id, name, kind")
      .eq("project_id", projectId)
      .order("name")
      .then(({ data }) => {
        if (!off) setCompanies({ projectId, rows: (data ?? []) as Company[] });
      });
    return () => {
      off = true;
    };
  }, [projectId, version]);
  const rows = team?.projectId === projectId ? team.rows : [];
  const companyRows = useMemo(
    // Primero el contratista, luego los subcontratistas, cada grupo por nombre
    () => (companies?.projectId === projectId ? companies.rows : []).slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "es")),
    [companies, projectId],
  );
  const groups = useMemo(() => {
    const known = new Set(companyRows.map((c) => c.id));
    const out = companyRows.map((c) => ({ key: c.id, company: c as Company | null, members: rows.filter((m) => m.company_id === c.id) }));
    const loose = rows.filter((m) => !m.company_id || !known.has(m.company_id));
    if (loose.length) out.push({ key: "none", company: null, members: loose });
    return out;
  }, [companyRows, rows]);
  const reload = () => setVersion((v) => v + 1);

  /** Cambio en la membresía de una persona (nombre, rol o empresa) con mensaje de resultado. */
  async function patchMember(m: Member, patch: Record<string, unknown>, okText: string) {
    setMsg(null);
    const { error } = await supabase.from("memberships").update(patch).eq("user_id", m.user_id).eq("project_id", projectId);
    setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: okText });
    reload();
    return !error;
  }

  async function saveName() {
    if (!editing) return;
    const m = rows.find((r) => r.user_id === editing.userId);
    const name = editing.name.trim();
    if (!m) return setEditing(null);
    if (name.length < 2) return setMsg({ tone: "error", text: "El nombre debe tener al menos 2 letras." });
    if (await patchMember(m, { member_name: name }, `Nombre actualizado: ${name}.`)) setEditing(null);
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const name = newCompany.name.trim();
    if (name.length < 2) return setMsg({ tone: "error", text: "Escribe el nombre de la empresa." });
    const { error } = await supabase.from("project_companies").insert({ project_id: projectId, name, kind: newCompany.kind });
    if (error) return setMsg({ tone: "error", text: error.code === "23505" ? `${name} ya está en la lista.` : error.message });
    setMsg({ tone: "ok", text: `${KIND_LABEL[newCompany.kind]} agregado: ${name}.` });
    setNewCompany({ name: "", kind: "subcontratista" });
    reload();
  }

  async function removeCompany(c: Company) {
    if (!window.confirm(`¿Quitar ${c.name}? Sus personas siguen en el proyecto, pero quedan sin empresa.`)) return;
    setMsg(null);
    const { error } = await supabase.from("project_companies").delete().eq("id", c.id);
    setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: `${c.name} fue quitada de la lista.` });
    reload();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setWelcome(null);
    // Lo que falta se dice junto al botón (antes el botón quedaba gris sin explicar por qué)
    const missing = [
      form.name.trim().length < 2 ? "el nombre" : null,
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()) ? "un correo válido" : null,
      form.password.length < 10 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password) ? "la contraseña temporal (pulsa Generar)" : null,
    ].filter(Boolean);
    if (missing.length) return setFormMsg({ tone: "error", text: `Falta ${missing.join(", ")}.` });
    setBusy(true);
    setFormMsg({ tone: "info", text: "Creando la cuenta…" });
    const { data, error } = await supabase.functions.invoke("team-create-user", { body: { project_id: projectId, ...form } });
    setBusy(false);
    if (error) {
      // El cuerpo del error trae el mensaje en español de la función
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      return setFormMsg({ tone: "error", text: detail?.error ?? `No se pudo crear: ${error.message}` });
    }
    const result = data as { status: string; user_id: string };
    const createdNew = result.status === "created";
    const company = companyRows.find((c) => c.id === form.company_id);
    if (company) await supabase.from("memberships").update({ company_id: company.id }).eq("user_id", result.user_id).eq("project_id", projectId);
    setFormMsg({ tone: "ok", text: createdNew ? `Usuario creado: ${form.name}.` : `${form.email} ya tenía cuenta: se agregó al proyecto con su contraseña de siempre.` });
    setWelcome(
      `Hola ${form.name}, ya tienes acceso a AvanceObra (${project?.name}) como ${ROLE_LABEL[form.role].toLowerCase()}${company ? ` de ${company.name}` : ""}.\n` +
        `Entra en la app del teléfono o en ${window.location.origin} con tu correo ${form.email}` +
        (createdNew ? ` y la contraseña temporal ${form.password} (al entrar a la web te pedirá cambiarla).` : " y tu contraseña de siempre.") +
        `\nPara recibir alertas: en la app, Sincronía → Vincular Telegram.`,
    );
    setForm({ name: "", email: "", role: "field", password: "", company_id: form.company_id });
    reload();
  }

  const changeRole = (m: Member, role: Role) => patchMember(m, { role }, `${m.name} ahora es ${ROLE_LABEL[role].toLowerCase()}.`);
  const changeCompany = (m: Member, id: string) => {
    const c = companyRows.find((x) => x.id === id);
    return patchMember(m, { company_id: c?.id ?? null }, c ? `${m.name} quedó en ${c.name}.` : `${m.name} quedó sin empresa.`);
  };

  /** Nueva contraseña temporal para quien la olvidó: al entrar tendrá que cambiarla. */
  async function resetPassword(m: Member) {
    if (!window.confirm(`¿Generar una contraseña temporal nueva para ${m.name}? La que tiene deja de servir.`)) return;
    setMsg(null);
    setResetNote(null);
    const password = tempPassword();
    const { error } = await supabase.functions.invoke("team-reset-password", { body: { project_id: projectId, user_id: m.user_id, password } });
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      return setMsg({ tone: "error", text: detail?.error ?? `No se pudo restablecer: ${error.message}` });
    }
    setMsg({ tone: "ok", text: `Contraseña de ${m.name} restablecida. Envíale el mensaje de abajo.` });
    setResetNote(
      `Hola ${m.name}, tu contraseña de AvanceObra se restableció.\n` +
        `Entra en la app del teléfono o en ${window.location.origin} con tu correo ${m.email} y la contraseña temporal ${password}.\n` +
        `Al entrar te pedirá crear una contraseña nueva.`,
    );
    reload();
  }

  async function remove(m: Member) {
    if (!window.confirm(`¿Retirar a ${m.name} del proyecto? Conserva su cuenta y lo que registró, pero deja de ver el proyecto.`)) return;
    setMsg(null);
    const { error } = await supabase.from("memberships").delete().eq("user_id", m.user_id).eq("project_id", projectId);
    if (error) setMsg({ tone: "error", text: error.message });
    else setMsg({ tone: "ok", text: `${m.name} fue retirado del proyecto.` });
    reload();
  }

  if (!projects.length) return <p className="text-zinc-600">Solo el administrador del proyecto gestiona el equipo.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Equipo</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Quién usa la app en {project?.name}, con qué rol y si recibe alertas por Telegram.</p>
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
        <p className={cx("rounded-lg px-4 py-2 font-semibold", msg.tone === "ok" ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200")}>
          {msg.text}
        </p>
      ) : null}
      {resetNote ? (
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
          <div className="mb-1 text-xs font-bold uppercase text-zinc-500">Mensaje para enviarle</div>
          <pre className="whitespace-pre-wrap font-sans text-sm">{resetNote}</pre>
          <Button size="sm" className="mt-2" onClick={() => void navigator.clipboard.writeText(resetNote).then(() => setMsg({ tone: "ok", text: "Mensaje copiado." }))}>
            Copiar mensaje
          </Button>
        </div>
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-2">Persona</th>
                <th className="pr-2">Empresa</th>
                <th className="pr-2">Rol</th>
                <th className="pr-2">Telegram</th>
                <th className="pr-2">Último ingreso</th>
                <th />
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr className="bg-zinc-50 dark:bg-zinc-900">
                  <th colSpan={6} scope="colgroup" className="px-2 py-1.5 text-sm font-bold">
                    {g.company ? (
                      <>
                        <Badge tone={g.company.kind === "contratista" ? "blue" : "neutral"}>{KIND_LABEL[g.company.kind]}</Badge> <span className="ml-1">{g.company.name}</span>
                      </>
                    ) : (
                      <span className="text-zinc-600 dark:text-zinc-400">Sin empresa asignada</span>
                    )}{" "}
                    <span className="ml-1 font-normal text-zinc-500">
                      {g.members.length} {g.members.length === 1 ? "persona" : "personas"}
                    </span>
                  </th>
                </tr>
                {g.members.map((m) => {
                  const me = m.user_id === session?.user.id;
                  const isEditing = editing?.userId === m.user_id;
                  return (
                    <tr key={m.user_id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-2">
                        {isEditing ? (
                          <form
                            className="flex flex-wrap items-center gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveName();
                            }}
                          >
                            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label={`Nombre de ${m.name}`} className="py-1" autoFocus />
                            <Button size="sm" variant="primary" type="submit">
                              Guardar
                            </Button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>
                              Cancelar
                            </Button>
                          </form>
                        ) : (
                          <div className="font-semibold">
                            {m.name}
                            {me ? <span className="ml-1 font-normal text-zinc-500">(tú)</span> : null}
                            <button
                              type="button"
                              onClick={() => setEditing({ userId: m.user_id, name: m.name })}
                              aria-label={`Editar nombre de ${m.name}`}
                              className="ml-2 text-sm font-normal text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
                            >
                              Editar
                            </button>
                          </div>
                        )}
                        <div className="text-sm text-zinc-500">{m.email}</div>
                      </td>
                      <td className="pr-2">
                        <Select value={m.company_id ?? ""} onChange={(e) => void changeCompany(m, e.target.value)} aria-label={`Empresa de ${m.name}`} className="py-1">
                          <option value="">Sin empresa</option>
                          {companyRows.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({KIND_LABEL[c.kind].toLowerCase()})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="pr-2">
                        <Select value={m.role} onChange={(e) => void changeRole(m, e.target.value as Role)} aria-label={`Rol de ${m.name}`} className="py-1">
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="pr-2">{m.telegram_linked ? <Badge tone="green">✓ Vinculado</Badge> : <Badge tone="amber">Sin vincular</Badge>}</td>
                      <td className="pr-2 text-sm tabular-nums">
                        {m.must_change_password ? (
                          <Badge tone="amber">Contraseña temporal</Badge>
                        ) : m.last_sign_in_at ? (
                          new Date(m.last_sign_in_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
                        ) : (
                          "Nunca"
                        )}
                      </td>
                      <td className="space-x-1 py-2 text-right whitespace-nowrap">
                        {me ? null : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => void resetPassword(m)} aria-label={`Restablecer contraseña de ${m.name}`}>
                              Restablecer contraseña
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void remove(m)}>
                              Retirar
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {g.members.length === 0 ? (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td colSpan={6} className="py-2 text-sm text-zinc-500">
                      Nadie asignado todavía: elige la empresa en la columna Empresa de cada persona.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            ))}
          </table>
        </div>
        {rows.some((m) => !m.telegram_linked) ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Para vincular Telegram, cada persona abre la app del teléfono → <b>Sincronía</b> → <b>Vincular Telegram</b> → Iniciar en el bot. Solo así le llegan las alertas y el informe
            diario.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Empresas</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">El contratista y sus subcontratistas en esta obra. Quien es de un subcontratista ve y registra solo las actividades asignadas a su empresa (se asignan en Proyecto), sus fotos y sus hallazgos; el contratista ve toda la obra.</p>
        {companyRows.length ? (
          <ul className="mb-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {companyRows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Badge tone={c.kind === "contratista" ? "blue" : "neutral"}>{KIND_LABEL[c.kind]}</Badge>
                <span className="mr-auto font-semibold">{c.name}</span>
                <span className="text-sm text-zinc-500">{rows.filter((m) => m.company_id === c.id).length} personas</span>
                <Button size="sm" variant="ghost" onClick={() => void removeCompany(c)} aria-label={`Quitar ${c.name}`}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={(e) => void addCompany(e)} className="flex flex-wrap items-end gap-2">
          <Field label="Nombre de la empresa" className="min-w-56 flex-1">
            <Input value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} placeholder="p. ej. Hincas del Caribe S.A.S." />
          </Field>
          <Field label="Tipo">
            <Select value={newCompany.kind} onChange={(e) => setNewCompany({ ...newCompany, kind: e.target.value as Kind })}>
              <option value="contratista">Contratista</option>
              <option value="subcontratista">Subcontratista</option>
            </Select>
          </Field>
          <Button type="submit">Agregar empresa</Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Agregar persona</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Se crea la cuenta con una contraseña temporal que tú le envías (por ejemplo, por WhatsApp). Si el correo ya tiene cuenta, solo se agrega al proyecto.
        </p>
        <form onSubmit={(e) => void create(e)} className="grid gap-3 md:grid-cols-2">
          <Field label="Nombre">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="p. ej. Marta Rincón" />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="correo@empresa.co" />
          </Field>
          <Field label="Rol" hint={`· ${ROLE_HELP[form.role]}`}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Empresa">
            <Select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
              <option value="">Sin empresa</option>
              {companyRows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({KIND_LABEL[c.kind].toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Contraseña temporal" hint="(mín. 10, letras y números)" className="flex-1">
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </Field>
            <Button type="button" onClick={() => setForm({ ...form, password: tempPassword() })}>
              Generar
            </Button>
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear y agregar al proyecto"}
            </Button>
            {formMsg ? (
              <span
                role={formMsg.tone === "error" ? "alert" : "status"}
                className={cx(
                  "font-semibold",
                  formMsg.tone === "ok" && "text-green-700 dark:text-green-400",
                  formMsg.tone === "error" && "text-red-700 dark:text-red-400",
                  formMsg.tone === "info" && "text-zinc-600 dark:text-zinc-400",
                )}
              >
                {formMsg.text}
              </span>
            ) : null}
          </div>
        </form>
        {welcome ? (
          <div className="mt-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
            <div className="mb-1 text-xs font-bold uppercase text-zinc-500">Mensaje para enviarle</div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{welcome}</pre>
            <Button size="sm" className="mt-2" onClick={() => void navigator.clipboard.writeText(welcome).then(() => setMsg({ tone: "ok", text: "Mensaje copiado." }))}>
              Copiar mensaje
            </Button>
          </div>
        ) : null}
      </Card>

      <ClientAccess projectId={projectId} projectName={project?.name ?? ""} tempPassword={tempPassword} />
    </div>
  );
}
