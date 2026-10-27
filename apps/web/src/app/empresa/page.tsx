"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { logoUrl } from "@/lib/logo";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Person {
  user_id: string;
  name: string;
  email: string;
  admin: boolean;
}

interface Defaults {
  contractor_name: string;
  personnel_roles: string;
  equipment_types: string;
  report_signers: string;
  workdays: number[];
  colombian_holidays: boolean;
  work_start: string;
  work_end: string;
  personnel_rates: Record<string, string>;
  equipment_rates: Record<string, string>;
}

const DAYS = [
  { iso: 1, label: "L" },
  { iso: 2, label: "M" },
  { iso: 3, label: "M" },
  { iso: 4, label: "J" },
  { iso: 5, label: "V" },
  { iso: 6, label: "S" },
  { iso: 7, label: "D" },
];
const EMPTY: Defaults = {
  contractor_name: "",
  personnel_roles: "",
  equipment_types: "",
  report_signers: "",
  workdays: [1, 2, 3, 4, 5, 6],
  colombian_holidays: true,
  work_start: "07:00",
  work_end: "17:00",
  personnel_rates: {},
  equipment_rates: {},
};
/** Una entrada por línea, sin vacías ni repetidas. */
const lines = (s: string) => [...new Set(s.split("\n").map((x) => x.trim()).filter(Boolean))];
const num = (s: string) => {
  const n = Number(s.trim().replace(/[$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const toText = (r: Record<string, number> | null | undefined) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, String(v)]));
const toNums = (r: Record<string, string>, keep: string[]) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => keep.includes(k)).map(([k, v]) => [k, num(v)]).filter(([, v]) => (v as number) > 0));

/** La empresa: sus datos, sus administradores y los valores que hereda cada obra nueva. */
export default function Empresa() {
  const { orgId, isAdmin, memberships } = useSession();
  const [picked] = useCurrentProject();
  // La obra del menú lateral (o la primera de la empresa)
  const projectId = picked || memberships.find((m) => m.org_id === orgId)?.project_id || "";
  const [org, setOrg] = useState<{ name: string; tax_id: string; logo_path: string | null } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [form, setForm] = useState<Defaults>(EMPTY);
  const [candidate, setCandidate] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!orgId || !isAdmin) return;
    let off = false;
    void Promise.all([
      supabase.from("organizations").select("name, tax_id, logo_path").eq("id", orgId).single(),
      supabase.rpc("org_people", { p_org: orgId }),
      supabase.from("org_settings").select("*").eq("org_id", orgId).maybeSingle(),
    ]).then(([o, p, s]) => {
      if (off) return;
      if (o.error || p.error) return setMsg({ tone: "error", text: (o.error ?? p.error)!.message });
      setOrg({ name: o.data.name ?? "", tax_id: o.data.tax_id ?? "", logo_path: o.data.logo_path ?? null });
      setPeople((p.data ?? []) as Person[]);
      const d = s.data;
      if (d)
        setForm({
          contractor_name: d.contractor_name ?? "",
          personnel_roles: (d.personnel_roles ?? []).join("\n"),
          equipment_types: (d.equipment_types ?? []).join("\n"),
          report_signers: (d.report_signers ?? []).join("\n"),
          workdays: d.workdays ?? EMPTY.workdays,
          colombian_holidays: d.colombian_holidays ?? true,
          work_start: String(d.work_start ?? "07:00").slice(0, 5),
          work_end: String(d.work_end ?? "17:00").slice(0, 5),
          personnel_rates: toText(d.personnel_rates),
          equipment_rates: toText(d.equipment_rates),
        });
    });
    return () => {
      off = true;
    };
  }, [orgId, isAdmin, version]);

  if (!isAdmin || !orgId) return <p className="text-zinc-600">Esta página es para el administrador de la empresa.</p>;
  if (!org) return <p className="text-zinc-500">{msg?.text ?? "Cargando…"}</p>;

  const set = <K extends keyof Defaults>(k: K, v: Defaults[K]) => setForm({ ...form, [k]: v });
  const admins = people.filter((p) => p.admin);
  const others = people.filter((p) => !p.admin);

  async function run(task: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await task();
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: ok });
    setVersion((v) => v + 1);
  }

  /** Trae los valores de la obra elegida en el menú para no escribirlos de nuevo. */
  async function copyFromProject() {
    if (!projectId) return setMsg({ tone: "error", text: "Elige una obra en el menú lateral." });
    const [p, r] = await Promise.all([
      supabase
        .from("projects")
        .select("name, contractor_name, personnel_roles, equipment_types, report_signers, workdays, colombian_holidays, work_start, work_end")
        .eq("id", projectId)
        .single(),
      supabase.from("cost_rates").select("personnel, equipment").eq("project_id", projectId).maybeSingle(),
    ]);
    if (p.error) return setMsg({ tone: "error", text: p.error.message });
    setForm({
      contractor_name: p.data.contractor_name ?? "",
      personnel_roles: (p.data.personnel_roles ?? []).join("\n"),
      equipment_types: (p.data.equipment_types ?? []).join("\n"),
      report_signers: (p.data.report_signers ?? []).join("\n"),
      workdays: p.data.workdays ?? EMPTY.workdays,
      colombian_holidays: p.data.colombian_holidays !== false,
      work_start: String(p.data.work_start ?? "07:00").slice(0, 5),
      work_end: String(p.data.work_end ?? "17:00").slice(0, 5),
      personnel_rates: toText(r.data?.personnel as Record<string, number> | undefined),
      equipment_rates: toText(r.data?.equipment as Record<string, number> | undefined),
    });
    setMsg({ tone: "ok", text: `Copiados los valores de ${p.data.name}. Revisa y pulsa Guardar.` });
  }

  /** Sube el logo (PNG o JPG, máximo 1 MB) y queda en informes y actas de todas las obras. */
  async function uploadLogo(file: File | undefined) {
    if (!file || !orgId) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return setMsg({ tone: "error", text: "El logo debe ser PNG o JPG." });
    if (file.size > 1_000_000) return setMsg({ tone: "error", text: "El logo debe pesar menos de 1 MB." });
    setBusy(true);
    const path = `${orgId}/logo-${Date.now()}.${file.type.includes("png") ? "png" : "jpg"}`;
    const up = await supabase.storage.from("logos").upload(path, file, { contentType: file.type });
    if (up.error) {
      setBusy(false);
      return setMsg({ tone: "error", text: `No se pudo subir el logo: ${up.error.message}` });
    }
    return run(() => supabase.from("organizations").update({ logo_path: path }).eq("id", orgId), "Logo guardado: ya sale en los informes y las actas.");
  }

  function saveDefaults() {
    const roles = lines(form.personnel_roles);
    const equipment = lines(form.equipment_types);
    return run(
      () =>
        supabase.from("org_settings").upsert({
          org_id: orgId,
          contractor_name: form.contractor_name.trim() || null,
          personnel_roles: roles.length ? roles : null,
          equipment_types: equipment.length ? equipment : null,
          report_signers: lines(form.report_signers).length ? lines(form.report_signers) : null,
          workdays: [...form.workdays].sort(),
          colombian_holidays: form.colombian_holidays,
          work_start: form.work_start,
          work_end: form.work_end,
          personnel_rates: toNums(form.personnel_rates, roles),
          equipment_rates: toNums(form.equipment_rates, equipment),
          updated_at: new Date().toISOString(),
        }),
      "Guardado. Las obras que se creen de ahora en adelante arrancan con estos valores.",
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Empresa</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Los datos de {org.name}, quién la administra y los valores con los que arranca cada obra nueva.</p>
      </div>
      {msg ? (
        <p role="status" className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>
          {msg.text}
        </p>
      ) : null}

      <Card>
        <h2 className="mb-3 text-lg font-bold">Datos de la empresa</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nombre de la empresa">
            <Input value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
          </Field>
          <Field label="NIT">
            <Input value={org.tax_id} onChange={(e) => setOrg({ ...org, tax_id: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || org.name.trim().length < 3}
              onClick={() =>
                void run(() => supabase.from("organizations").update({ name: org.name.trim(), tax_id: org.tax_id.trim() || null }).eq("id", orgId), "Datos de la empresa guardados.")
              }
            >
              Guardar datos
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Logo</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Sale en el informe diario, el informe semanal (pantalla, impresión y Excel), las actas de cobro y la liquidación.</p>
        <div className="flex flex-wrap items-center gap-4">
          {logoUrl(org.logo_path) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl(org.logo_path)!} alt="Logo de la empresa" className="h-16 w-auto max-w-[220px] rounded border border-zinc-200 bg-white object-contain p-1" />
          ) : (
            <span className="text-sm text-zinc-500">Sin logo todavía.</span>
          )}
          <Field label={org.logo_path ? "Cambiar logo" : "Subir logo"} hint="(PNG o JPG, máximo 1 MB)">
            <Input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={(e) => void uploadLogo(e.target.files?.[0])} className="py-1.5" />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Administradores de la empresa</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Entran como administradores a todas las obras de la empresa, también a las que se creen después, y manejan esta página. Para nombrar a alguien que aún no
          está en ninguna obra, agrégalo primero en Equipo.
        </p>
        <ul className="mb-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {admins.map((p) => (
            <li key={p.user_id} className="flex items-center gap-3 py-2">
              <span className="mr-auto">
                <b>{p.name}</b> <span className="text-sm text-zinc-500">{p.email}</span>
              </span>
              <Badge tone="blue">Administrador</Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || admins.length < 2}
                title={admins.length < 2 ? "La empresa debe tener al menos un administrador" : undefined}
                onClick={() =>
                  window.confirm(`¿Quitar a ${p.name} como administrador de la empresa? Conserva su rol en cada obra; si hace falta, cámbialo en Equipo.`) &&
                  void run(() => supabase.from("org_admins").delete().eq("org_id", orgId).eq("user_id", p.user_id), `${p.name} ya no es administrador de la empresa.`)
                }
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
        {others.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nombrar administrador" className="min-w-64 flex-1">
              <Select value={candidate} onChange={(e) => setCandidate(e.target.value)}>
                <option value="">Elige una persona de las obras</option>
                {others.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name} · {p.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={busy || !candidate}
              onClick={() => {
                const who = others.find((p) => p.user_id === candidate);
                void run(() => supabase.from("org_admins").insert({ org_id: orgId, user_id: candidate }), `${who?.name} ahora administra la empresa y todas sus obras.`).then(() =>
                  setCandidate(""),
                );
              }}
            >
              Nombrar
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h2 className="text-lg font-bold">Valores para obras nuevas</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Cada obra que se cree arranca con estos valores; después se ajustan en Proyecto. Las obras que ya existen no cambian.
            </p>
          </div>
          <Button onClick={() => void copyFromProject()}>Copiar de la obra actual</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Contratista" hint="(cómo aparece en los informes)">
            <Input value={form.contractor_name} onChange={(e) => set("contractor_name", e.target.value)} placeholder="p. ej. CVP" />
          </Field>
          <Field label="Inicio de la jornada">
            <Input type="time" value={form.work_start} onChange={(e) => set("work_start", e.target.value)} />
          </Field>
          <Field label="Fin de la jornada">
            <Input type="time" value={form.work_end} onChange={(e) => set("work_end", e.target.value)} />
          </Field>
          <Field label="Cargos del personal" hint="(uno por línea)">
            <Textarea rows={6} value={form.personnel_roles} onChange={(e) => set("personnel_roles", e.target.value)} />
          </Field>
          <Field label="Equipos" hint="(uno por línea)">
            <Textarea rows={6} value={form.equipment_types} onChange={(e) => set("equipment_types", e.target.value)} />
          </Field>
          <Field label="Firmas del informe" hint="(una por línea)">
            <Textarea rows={6} value={form.report_signers} onChange={(e) => set("report_signers", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div>
            <span className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Días hábiles</span>
            <div className="mt-1 flex gap-1.5">
              {DAYS.map((d) => {
                const on = form.workdays.includes(d.iso);
                return (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={on}
                    aria-label={`Día ${d.iso}`}
                    onClick={() => set("workdays", on ? form.workdays.filter((x) => x !== d.iso) : [...form.workdays, d.iso])}
                    className={cx(
                      "rounded-lg border px-3 py-1.5 font-semibold",
                      on ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="mt-5 flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={form.colombian_holidays} onChange={(e) => set("colombian_holidays", e.target.checked)} className="h-5 w-5 accent-blue-700" />
            Descontar los festivos de Colombia
          </label>
        </div>

        <h3 className="mt-5 font-bold">Tarifas para el costo real</h3>
        <p className="mb-2 text-xs text-zinc-500">Pesos por persona-día y por equipo-día. Deja sin tarifa al personal y los equipos de subcontratistas.</p>
        <div className="grid gap-5 md:grid-cols-2">
          {(
            [
              ["personnel_rates", lines(form.personnel_roles)],
              ["equipment_rates", lines(form.equipment_types)],
            ] as const
          ).map(([k, names]) => (
            <div key={k} className="space-y-1.5">
              {names.length ? (
                names.map((n) => (
                  <label key={n} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{n}</span>
                    <Input
                      aria-label={`Tarifa de ${n}`}
                      inputMode="numeric"
                      className="w-36 py-1 text-right"
                      placeholder="sin tarifa"
                      value={form[k][n] ?? ""}
                      onChange={(e) => set(k, { ...form[k], [n]: e.target.value })}
                    />
                  </label>
                ))
              ) : (
                <p className="text-sm text-zinc-500">{k === "personnel_rates" ? "Escribe los cargos arriba." : "Escribe los equipos arriba."}</p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Button variant="primary" disabled={busy} onClick={() => void saveDefaults()}>
            {busy ? "Guardando…" : "Guardar valores"}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Ya son de toda la empresa</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Los{" "}
          <Link href="/formatos" className="font-semibold text-blue-700 underline dark:text-blue-400">
            formatos
          </Link>{" "}
          y la biblioteca de{" "}
          <Link href="/biblioteca" className="font-semibold text-blue-700 underline dark:text-blue-400">
            rendimientos y costos
          </Link>{" "}
          se comparten entre todas las obras de la empresa.
        </p>
      </Card>
    </div>
  );
}
