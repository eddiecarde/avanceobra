"use client";

import { colombianHolidays } from "@avanceobra/engine";
import { toNumber } from "@avanceobra/importers";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { geocode } from "@/lib/weather";

const DAYS = [
  { iso: 1, label: "Lun" },
  { iso: 2, label: "Mar" },
  { iso: 3, label: "Mié" },
  { iso: 4, label: "Jue" },
  { iso: 5, label: "Vie" },
  { iso: 6, label: "Sáb" },
  { iso: 7, label: "Dom" },
];

interface ProjectForm {
  name: string;
  start_date: string;
  contract_end_date: string;
  workdays: number[];
  work_start: string;
  work_end: string;
  colombian_holidays: boolean;
  holidays: string[];
  client_name: string;
  location_name: string;
  zone_label: string;
  contractor_name: string;
  contract_code: string;
  report_code: string;
  signers: string;
  personnel_roles: string;
  equipment_types: string;
}

interface ActRow {
  id: string;
  code: string;
  name: string;
  front: string;
  weight: string; // porcentaje editable ("49,85")
  original: number | null;
  company: string; // id de la empresa responsable o ""
  originalCompany: string;
  subfield: string;
  circuit: string;
  originalZone: string; // "subcampo|circuito" como llegó, para saber si cambió
}

interface Company {
  id: string;
  name: string;
  kind: "contratista" | "subcontratista";
}

/** Una entrada por línea, sin vacías ni repetidas. */
const lines = (s: string) => [...new Set(s.split("\n").map((x) => x.trim()).filter(Boolean))];

const toPct = (w: number | null) => (w == null ? "" : (w * 100).toLocaleString("es-CO", { maximumFractionDigits: 4 }));
/** "49,85" o "49.85" → 0,4985; vacío → sin peso; texto inválido → NaN. */
const fromPct = (s: string) => {
  if (!s.trim()) return null;
  const n = toNumber(s.replace("%", ""));
  return n == null ? NaN : n / 100;
};

/** Datos del proyecto para los informes del cliente: cabecera, calendario laboral, ponderación y empresa de cada actividad. */
export default function Proyecto() {
  const { memberships } = useSession();
  const projects = useMemo(
    () => [...new Map(memberships.filter((m) => m.project && m.role === "admin").map((m) => [m.project_id, m.project!])).values()],
    [memberships],
  );
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const [loaded, setLoaded] = useState<{ projectId: string; form: ProjectForm; acts: ActRow[]; companies: Company[] } | null>(null);
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [acts, setActs] = useState<ActRow[]>([]);
  const [newHoliday, setNewHoliday] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      supabase
        .from("projects")
        .select(
          "name, location_name, zone_label, start_date, contract_end_date, workdays, work_start, work_end, colombian_holidays, holidays, client_name, contractor_name, contract_code, report_code, report_signers, personnel_roles, equipment_types",
        )
        .eq("id", projectId)
        .single(),
      supabase.from("activities").select("id, code, name, weight, company_id, subfield, circuit, front:fronts(code)").eq("project_id", projectId).order("code"),
      supabase.from("project_companies").select("id, name, kind").eq("project_id", projectId).order("kind").order("name"),
    ]).then(([p, a, c]) => {
      if (off) return;
      if (p.error) return setMsg({ tone: "error", text: p.error.message });
      const f: ProjectForm = {
        name: p.data.name,
        start_date: p.data.start_date ?? "",
        contract_end_date: p.data.contract_end_date ?? "",
        workdays: p.data.workdays ?? [1, 2, 3, 4, 5, 6],
        work_start: String(p.data.work_start ?? "07:00").slice(0, 5),
        work_end: String(p.data.work_end ?? "17:00").slice(0, 5),
        colombian_holidays: p.data.colombian_holidays !== false,
        holidays: p.data.holidays ?? [],
        client_name: p.data.client_name ?? "",
        location_name: p.data.location_name ?? "",
        zone_label: p.data.zone_label ?? "",
        contractor_name: p.data.contractor_name ?? "",
        contract_code: p.data.contract_code ?? "",
        report_code: p.data.report_code ?? "",
        signers: (p.data.report_signers ?? []).join("\n"),
        personnel_roles: (p.data.personnel_roles ?? []).join("\n"),
        equipment_types: (p.data.equipment_types ?? []).join("\n"),
      };
      const rows = (a.data ?? []).map((x) => {
        const w = x.weight == null ? null : Number(x.weight);
        const company = (x.company_id as string | null) ?? "";
        const subfield = (x.subfield as string | null) ?? "";
        const circuit = (x.circuit as string | null) ?? "";
        return {
          id: x.id,
          code: x.code,
          name: x.name,
          front: (x.front as unknown as { code: string } | null)?.code ?? "",
          weight: toPct(w),
          original: w,
          company,
          originalCompany: company,
          subfield,
          circuit,
          originalZone: `${subfield}|${circuit}`,
        };
      });
      setLoaded({ projectId, form: f, acts: rows, companies: (c.data ?? []) as Company[] });
      setForm(f);
      setActs(rows);
    });
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const current = loaded?.projectId === projectId ? form : null;
  const companies = loaded?.projectId === projectId ? loaded.companies : [];
  const weights = acts.map((a) => fromPct(a.weight));
  const invalid = weights.some((w) => Number.isNaN(w) || (w != null && (w < 0 || w > 1)));
  const anyWeight = weights.some((w) => w != null);
  const total = weights.reduce<number>((s, w) => s + (w != null && !Number.isNaN(w) ? w : 0), 0);
  const totalOk = !anyWeight || Math.abs(total - 1) < 0.0005;
  // Aviso de cambios sin guardar en la barra fija de abajo
  const dirty =
    !!current && !!loaded && (JSON.stringify(current) !== JSON.stringify(loaded.form) || acts.some((a, i) => a.weight !== loaded.acts[i]?.weight || a.company !== a.originalCompany || `${a.subfield}|${a.circuit}` !== a.originalZone));
  const nextHolidays = useMemo(() => {
    const y = new Date().getFullYear();
    return [...colombianHolidays(y), ...colombianHolidays(y + 1)].filter((d) => d >= new Date().toISOString().slice(0, 10)).slice(0, 4);
  }, []);

  if (!projects.length) return <p className="text-zinc-600">Solo el administrador del proyecto puede editar estos datos.</p>;

  const set = <K extends keyof ProjectForm>(k: K, v: ProjectForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!current || invalid || !totalOk) return;
    setBusy(true);
    setMsg(null);
    try {
      // Coordenadas del municipio para el clima del día (si no se encuentran, se dejan las anteriores)
      const where = current.location_name.trim();
      const geo = where ? await geocode(where) : null;
      const { error } = await supabase
        .from("projects")
        .update({
          start_date: current.start_date || null,
          contract_end_date: current.contract_end_date || null,
          workdays: [...current.workdays].sort(),
          work_start: current.work_start,
          work_end: current.work_end,
          colombian_holidays: current.colombian_holidays,
          holidays: [...current.holidays].sort(),
          client_name: current.client_name.trim() || null,
          location_name: where || null,
          zone_label: current.zone_label.trim() || null,
          ...(geo ? { lat: geo.lat, lon: geo.lon } : {}),
          contractor_name: current.contractor_name.trim() || null,
          contract_code: current.contract_code.trim() || null,
          report_code: current.report_code.trim() || null,
          report_signers: lines(current.signers),
          personnel_roles: lines(current.personnel_roles),
          equipment_types: lines(current.equipment_types),
        })
        .eq("id", projectId);
      if (error) throw error;
      const changed = acts.filter((a, i) => (weights[i] ?? null) !== a.original || a.company !== a.originalCompany || `${a.subfield}|${a.circuit}` !== a.originalZone);
      for (const a of changed) {
        const { error: e } = await supabase
          .from("activities")
          .update({ weight: fromPct(a.weight), company_id: a.company || null, subfield: a.subfield.trim() || null, circuit: a.circuit.trim() || null })
          .eq("id", a.id);
        if (e) throw e;
      }
      setMsg({ tone: "ok", text: `Guardado. ${changed.length ? `${changed.length} actividad(es) actualizadas. ` : ""}El dashboard y los informes ya usan estos datos.` });
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Proyecto</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Cabecera de los informes, calendario laboral, peso y empresa de cada actividad.</p>
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

      {!current ? (
        <p className="text-zinc-500">Cargando…</p>
      ) : (
        <>
          <Card>
            <h2 className="text-lg font-bold">Cabecera del informe</h2>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Así aparece en el informe semanal exportado (formato del cliente).</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Ubicación de la obra" hint="(municipio, departamento: se usa para el clima)">
                <Input value={current.location_name} onChange={(e) => set("location_name", e.target.value)} placeholder="p. ej. Valledupar, Cesar" />
              </Field>
              <Field label="Cómo se llaman las zonas" hint="(Subcampo, Tramo, Bloque, Piso, Sector…)">
                <Input value={current.zone_label} onChange={(e) => set("zone_label", e.target.value)} placeholder="p. ej. Tramo" list="zone-labels" />
                <datalist id="zone-labels">
                  {["Subcampo", "Tramo", "Bloque", "Piso", "Sector", "Frente", "Zona"].map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
              <Field label="A quién se le reporta" hint="(cliente)">
                <Input value={current.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="p. ej. HELIOS" />
              </Field>
              <Field label="Reporta" hint="(contratista)">
                <Input value={current.contractor_name} onChange={(e) => set("contractor_name", e.target.value)} placeholder="p. ej. CNX" />
              </Field>
              <Field label="Contrato">
                <Input value={current.contract_code} onChange={(e) => set("contract_code", e.target.value)} placeholder="p. ej. CNX-PSS-CIV-001" />
              </Field>
              <Field label="Código del formato">
                <Input value={current.report_code} onChange={(e) => set("report_code", e.target.value)} placeholder="p. ej. CNX-PSS-001" />
              </Field>
              <Field label="Firmas del informe" hint="(una por línea)" className="md:col-span-2">
                <Textarea rows={3} value={current.signers} onChange={(e) => set("signers", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">Parte diario: cargos y equipos</h2>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Listas que ve el supervisor en el teléfono para contar personal y equipos. En campo puede agregar otros si hace falta.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Cargos del personal" hint="(uno por línea)">
                <Textarea rows={4} value={current.personnel_roles} onChange={(e) => set("personnel_roles", e.target.value)} />
              </Field>
              <Field label="Equipos" hint="(uno por línea)">
                <Textarea rows={4} value={current.equipment_types} onChange={(e) => set("equipment_types", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">Calendario laboral</h2>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Define los días hábiles del programado, la curva S, los semáforos y el informe semanal. El formato del cliente descuenta solo los domingos: en ese caso,
              desactiva los festivos de Colombia.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Inicio del proyecto">
                <Input type="date" value={current.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </Field>
              <Field label="Fecha contractual de terminación">
                <Input type="date" value={current.contract_end_date} onChange={(e) => set("contract_end_date", e.target.value)} />
              </Field>
              <Field label="Inicio de la jornada" hint="(la lluvia fuera de la jornada no cuenta como reclamable)">
                <Input type="time" value={current.work_start} onChange={(e) => set("work_start", e.target.value)} />
              </Field>
              <Field label="Fin de la jornada">
                <Input type="time" value={current.work_end} onChange={(e) => set("work_end", e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <span className="text-xs font-bold uppercase tracking-wide text-zinc-500">Días hábiles</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const on = current.workdays.includes(d.iso);
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("workdays", on ? current.workdays.filter((x) => x !== d.iso) : [...current.workdays, d.iso])}
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
            <label className="mt-3 flex items-center gap-2 font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={current.colombian_holidays} onChange={(e) => set("colombian_holidays", e.target.checked)} />
              Descontar los festivos de Colombia
            </label>
            <p className="ml-7 text-sm text-zinc-500">Próximos: {nextHolidays.join(", ")}</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Otros días no laborables" hint="(paros, días del proyecto)">
                <Input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} />
              </Field>
              <Button
                disabled={!newHoliday || current.holidays.includes(newHoliday)}
                onClick={() => {
                  set("holidays", [...current.holidays, newHoliday].sort());
                  setNewHoliday("");
                }}
              >
                Agregar
              </Button>
              {current.holidays.map((h) => (
                <span key={h} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-sm dark:bg-zinc-800">
                  {h}
                  <button type="button" aria-label={`Quitar ${h}`} className="font-bold text-zinc-500 hover:text-red-700" onClick={() => set("holidays", current.holidays.filter((x) => x !== h))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-lg font-bold">Actividades: peso, empresa y ubicación</h2>
              <Button size="sm" onClick={() => setActs((r) => r.map((a) => ({ ...a, weight: toPct(1 / r.length) })))}>
                Repartir por igual
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setActs((r) => r.map((a) => ({ ...a, weight: "" })))}>
                Quitar pesos
              </Button>
            </div>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              Peso de cada actividad en el avance general (hoja &quot;%&quot; del formato del cliente). Deben sumar 100 %. Sin pesos, todas pesan igual. La empresa
              responsable (contratista o subcontratista), el subcampo y el circuito agrupan y filtran el avance en el dashboard y el centro de control
              {companies.length ? "" : "; primero registra las empresas en Ajustes → Equipo"}.
            </p>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] max-w-5xl text-left">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-2">Frente</th>
                  <th className="pr-2">Actividad</th>
                  <th className="w-56 pr-2">Empresa</th>
                  <th className="w-28 pr-2">Subcampo</th>
                  <th className="w-28 pr-2">Circuito</th>
                  <th className="w-32 text-right">Peso (%)</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((a, i) => (
                  <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-2 font-semibold">{a.front}</td>
                    <td className="pr-2">
                      <b>{a.code}</b> · {a.name}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Select
                        value={a.company}
                        aria-label={`Empresa de ${a.code}`}
                        disabled={!companies.length}
                        onChange={(e) => setActs((r) => r.map((x) => (x.id === a.id ? { ...x, company: e.target.value } : x)))}
                        className="py-1"
                      >
                        <option value="">Sin empresa</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.kind})
                          </option>
                        ))}
                      </Select>
                    </td>
                    {(["subfield", "circuit"] as const).map((k) => (
                      <td key={k} className="py-1.5 pr-2">
                        <Input
                          value={a[k]}
                          aria-label={`${k === "subfield" ? "Subcampo" : "Circuito"} de ${a.code}`}
                          placeholder={k === "subfield" ? "SC-01" : "C-01"}
                          onChange={(e) => setActs((r) => r.map((x) => (x.id === a.id ? { ...x, [k]: e.target.value } : x)))}
                          className="py-1"
                        />
                      </td>
                    ))}
                    <td className="py-1.5">
                      <Input
                        value={a.weight}
                        inputMode="decimal"
                        aria-label={`Peso de ${a.code}`}
                        onChange={(e) => setActs((r) => r.map((x) => (x.id === a.id ? { ...x, weight: e.target.value } : x)))}
                        className={cx("py-1 text-right", Number.isNaN(weights[i]) && "border-red-600")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="pt-2 text-right font-bold">
                    Total
                  </td>
                  <td className={cx("pt-2 text-right text-lg font-extrabold tabular-nums", anyWeight && !totalOk && "text-red-700 dark:text-red-400")}>
                    {anyWeight ? `${(total * 100).toLocaleString("es-CO", { maximumFractionDigits: 3 })} %` : "por igual"}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
            {anyWeight && !totalOk ? <p className="mt-2 font-semibold text-red-700 dark:text-red-400">Los pesos deben sumar 100 % para guardar.</p> : null}
          </Card>

          {/* Barra fija: Guardar siempre a la vista, sin bajar hasta el final */}
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
            <Button variant="primary" disabled={busy || invalid || !totalOk} onClick={() => void save()}>
              {busy ? "Guardando…" : "Guardar"}
            </Button>
            {dirty && !msg ? <span className="font-semibold text-amber-700 dark:text-amber-400">Cambios sin guardar</span> : null}
            {msg ? <span className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>{msg.text}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}
