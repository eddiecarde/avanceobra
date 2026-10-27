"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { useSession } from "@/lib/session";
import { PLANS, type Plan } from "@/lib/subscription";
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
  admin_users?: { user_id: string; name: string; email: string }[];
  last_sign_in: string | null;
  last_entry: string | null;
  entries_30d: number;
  plan: Plan;
  max_projects: number | null;
  max_users: number | null;
  paid_until: string | null;
  monthly_fee: number | null;
}

interface DemoRequest {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  city: string | null;
  project_type: string | null;
  projects_count: number | null;
  message: string | null;
  status: "nuevo" | "contactado" | "convertido" | "descartado";
  created_at: string;
}

const DEMO_STATUS: Record<DemoRequest["status"], { label: string; tone: "amber" | "blue" | "green" | "neutral" }> = {
  nuevo: { label: "Nuevo", tone: "amber" },
  contactado: { label: "Contactado", tone: "blue" },
  convertido: { label: "Ya es cliente", tone: "green" },
  descartado: { label: "Descartado", tone: "neutral" },
};
const today = () => new Date().toISOString().slice(0, 10);

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Contraseña temporal legible (sin 0/O ni 1/l para dictarla o copiarla sin errores). */
function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join("");
  return `${pick(5)}-${pick(5)}-${Math.floor(10 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 90))}`;
}

const EMPTY = { company_name: "", tax_id: "", admin_name: "", admin_email: "", password: "", project_name: "", project_code: "", start: "", end: "", plan: "prueba" };

/** Panel del dueño de la plataforma: empresas, su uso, alta de empresas nuevas y suspensión. */
export default function Dueno() {
  const { isPlatformAdmin } = useSession();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [fromRequest, setFromRequest] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    void supabase.rpc("platform_companies").then(({ data, error }) => {
      if (error) setMsg({ tone: "error", text: error.message });
      else setCompanies((data ?? []) as Company[]);
    });
    void supabase
      .from("demo_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRequests((data ?? []) as DemoRequest[]));
  }, [isPlatformAdmin, version]);

  if (!isPlatformAdmin) return <p className="text-zinc-600">Esta página es solo para el dueño de la plataforma.</p>;

  /** Contraseña temporal nueva para el administrador de una empresa que la olvidó. */
  async function resetAdmin(c: Company, a: { user_id: string; name: string; email: string }) {
    if (!window.confirm(`¿Generar una contraseña temporal nueva para ${a.name} (${c.name})? La que tiene deja de servir.`)) return;
    setMsg(null);
    setWelcome(null);
    const password = tempPassword();
    const { error } = await supabase.functions.invoke("team-reset-password", { body: { user_id: a.user_id, password } });
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      return setMsg({ tone: "error", text: detail?.error ?? `No se pudo restablecer: ${error.message}` });
    }
    setMsg({ tone: "ok", text: `Contraseña de ${a.name} restablecida. Envíale el mensaje de abajo.` });
    setWelcome(
      `Hola ${a.name}, tu contraseña de AvanceObra se restableció.\n` +
        `Entra en ${window.location.origin} o en la app del teléfono con tu correo ${a.email} y la contraseña temporal ${password}.\n` +
        `Al entrar te pedirá crear una contraseña nueva.`,
    );
  }

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
    const result = data as { status: string; org_id: string };
    const created = result.status === "created";
    if (fromRequest) await supabase.from("demo_requests").update({ status: "convertido", org_id: result.org_id, updated_at: new Date().toISOString() }).eq("id", fromRequest);
    setFromRequest(null);
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
                  <th>Plan</th>
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
                    <td>
                      {c.admin_users?.length
                        ? c.admin_users.map((a) => (
                            <div key={a.user_id}>
                              {a.name}{" "}
                              <button
                                type="button"
                                className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
                                onClick={() => void resetAdmin(c, a)}
                                aria-label={`Restablecer contraseña de ${a.name}`}
                              >
                                restablecer contraseña
                              </button>
                            </div>
                          ))
                        : c.admins.join(", ") || "—"}
                    </td>
                    <td>{when(c.last_sign_in)}</td>
                    <td className="text-right tabular-nums">{c.entries_30d}</td>
                    <td>
                      <b>{PLANS[c.plan]?.label ?? c.plan}</b>
                      <div className="text-xs text-zinc-500">
                        obras {c.projects}/{c.max_projects ?? "∞"} · usuarios {c.users}/{c.max_users ?? "∞"}
                      </div>
                      {c.paid_until ? (
                        <div className={c.paid_until < today() ? "text-xs font-semibold text-red-700 dark:text-red-400" : "text-xs text-zinc-500"}>
                          {c.paid_until < today() ? "venció" : "vence"} {when(c.paid_until)}
                        </div>
                      ) : null}
                    </td>
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
                    <td className="space-x-1 text-right whitespace-nowrap">
                      <Button size="sm" onClick={() => setPlanFor(planFor === c.id ? null : c.id)} aria-label={`Plan de ${c.name}`}>
                        Plan
                      </Button>
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

      {planFor && companies ? (
        <PlanEditor
          key={planFor}
          company={companies.find((c) => c.id === planFor)!}
          onSaved={(text) => {
            setMsg({ tone: "ok", text });
            setPlanFor(null);
            setVersion((v) => v + 1);
          }}
          onError={(text) => setMsg({ tone: "error", text })}
        />
      ) : null}

      <Card>
        <h2 className="text-lg font-bold">Solicitudes de demostración ({requests.filter((r) => r.status === "nuevo").length} nuevas)</h2>
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Llegan desde la página pública /demo (enlace en la entrada de la web).</p>
        {requests.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                <div className="mr-auto min-w-64">
                  <b>{r.company}</b> · {r.name}
                  <div className="text-zinc-500">
                    {r.email}
                    {r.phone ? ` · ${r.phone}` : ""}
                    {r.city ? ` · ${r.city}` : ""}
                    {r.project_type ? ` · ${r.project_type}` : ""}
                    {r.projects_count ? ` · ${r.projects_count} obra(s)` : ""} · {when(r.created_at)}
                  </div>
                  {r.message ? <div className="text-zinc-700 dark:text-zinc-300">{r.message}</div> : null}
                </div>
                <Badge tone={DEMO_STATUS[r.status].tone}>{DEMO_STATUS[r.status].label}</Badge>
                <Select
                  aria-label={`Estado de ${r.company}`}
                  value={r.status}
                  className="w-40 py-1"
                  onChange={async (e) => {
                    const { error } = await supabase.from("demo_requests").update({ status: e.target.value, updated_at: new Date().toISOString() }).eq("id", r.id);
                    if (error) return setMsg({ tone: "error", text: error.message });
                    setVersion((v) => v + 1);
                  }}
                >
                  {Object.entries(DEMO_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
                {r.status !== "convertido" ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setForm({ ...EMPTY, company_name: r.company, admin_name: r.name, admin_email: r.email });
                      setFromRequest(r.id);
                      setMsg({ tone: "ok", text: `Formulario de alta llenado con los datos de ${r.company}: completa la obra y crea la empresa.` });
                    }}
                  >
                    Dar de alta
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Aún no hay solicitudes.</p>
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
          <Field label="Plan">
            <Select value={form.plan} onChange={(e) => set("plan", e.target.value)}>
              {(Object.keys(PLANS) as Plan[]).map((k) => (
                <option key={k} value={k}>
                  {PLANS[k].label}
                  {PLANS[k].maxProjects ? ` · ${PLANS[k].maxProjects} obra(s), ${PLANS[k].maxUsers} usuarios` : " · sin límites"}
                  {PLANS[k].days ? ` · ${PLANS[k].days} días` : ""}
                </option>
              ))}
            </Select>
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

/** Plan de una empresa: obras y usuarios permitidos, hasta cuándo está pagada y su tarifa mensual. */
function PlanEditor({ company, onSaved, onError }: { company: Company; onSaved: (text: string) => void; onError: (text: string) => void }) {
  const [f, setF] = useState({
    plan: company.plan,
    max_projects: company.max_projects == null ? "" : String(company.max_projects),
    max_users: company.max_users == null ? "" : String(company.max_users),
    paid_until: company.paid_until ?? "",
    monthly_fee: company.monthly_fee == null ? "" : String(company.monthly_fee),
  });
  const intOrNull = (s: string) => (s.trim() ? Math.max(1, Math.round(Number(s))) : null);

  async function save() {
    const { error } = await supabase.rpc("platform_set_plan", {
      p_org: company.id,
      p_plan: f.plan,
      p_max_projects: intOrNull(f.max_projects),
      p_max_users: intOrNull(f.max_users),
      p_paid_until: f.paid_until || null,
      p_monthly_fee: f.monthly_fee.trim() ? Number(f.monthly_fee.replace(/[$\s.]/g, "").replace(",", ".")) : null,
    });
    if (error) return onError(error.message);
    onSaved(`Plan de ${company.name} actualizado.`);
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Plan de {company.name}</h2>
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Plan">
          <Select
            value={f.plan}
            onChange={(e) => {
              const k = e.target.value as Plan;
              setF({ ...f, plan: k, max_projects: PLANS[k].maxProjects == null ? "" : String(PLANS[k].maxProjects), max_users: PLANS[k].maxUsers == null ? "" : String(PLANS[k].maxUsers) });
            }}
          >
            {(Object.keys(PLANS) as Plan[]).map((k) => (
              <option key={k} value={k}>
                {PLANS[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Obras" hint="(vacío = sin límite)">
          <Input inputMode="numeric" value={f.max_projects} onChange={(e) => setF({ ...f, max_projects: e.target.value })} />
        </Field>
        <Field label="Usuarios" hint="(vacío = sin límite)">
          <Input inputMode="numeric" value={f.max_users} onChange={(e) => setF({ ...f, max_users: e.target.value })} />
        </Field>
        <Field label="Pagado hasta">
          <Input type="date" value={f.paid_until} onChange={(e) => setF({ ...f, paid_until: e.target.value })} />
        </Field>
        <Field label="Tarifa mensual" hint="($)">
          <Input inputMode="numeric" value={f.monthly_fee} onChange={(e) => setF({ ...f, monthly_fee: e.target.value })} />
        </Field>
      </div>
      <Button className="mt-3" variant="primary" onClick={() => void save()}>
        Guardar plan
      </Button>
    </Card>
  );
}
