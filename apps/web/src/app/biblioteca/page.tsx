"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, cx } from "@/components/ui";
import {
  compareActivity,
  dailyCost,
  DEFAULT_WORKDAY,
  effectiveDaily,
  money,
  qty,
  unitCost,
  type Resource,
  type WorkdayAssumptions,
} from "@/lib/library";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Assignment {
  id: string;
  activity_id: string;
  resource_id: string;
  units: number;
  use_real_rate: boolean;
}
interface Activity {
  id: string;
  code: string;
  name: string;
  unit: string;
  project_id: string;
}
interface Daily {
  activity_id: string;
  work_date: string;
  quantity: number;
}

const BLANK: Omit<Resource, "id" | "org_id"> = {
  name: "",
  kind: "equipment",
  unit: "",
  ref_rate: 0,
  rate_basis: "hour",
  mechanical_availability: 0.85,
  factors: {},
  ownership: "rented",
  cost_per_hour: 0,
  operator_cost_per_hour: 0,
  fuel_cost_per_hour: 0,
  maintenance_cost_per_hour: 0,
  mobilization_cost: 0,
  min_rental_days: 0,
  notes: null,
  archived: false,
};

/** Biblioteca de rendimientos y costos de la empresa + contraste real vs. referencia por actividad. */
export default function Biblioteca() {
  const { orgId, isAdmin, projectIds } = useSession();
  const [resources, setResources] = useState<Resource[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [w, setW] = useState<WorkdayAssumptions>(DEFAULT_WORKDAY);
  const [editing, setEditing] = useState<(Partial<Resource> & typeof BLANK) | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [r, a, as, d] = await Promise.all([
      supabase.from("resource_catalog").select("*").eq("org_id", orgId).order("name"),
      supabase.from("activities").select("id, code, name, unit, project_id").in("project_id", projectIds).order("code"),
      supabase.from("activity_resources").select("id, activity_id, resource_id, units, use_real_rate").in("project_id", projectIds),
      supabase
        .from("activity_daily_output")
        .select("activity_id, work_date, quantity")
        .in("project_id", projectIds)
        .gte("work_date", new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)),
    ]);
    setResources((r.data ?? []) as Resource[]);
    setActivities((a.data ?? []) as Activity[]);
    setAssignments((as.data ?? []) as Assignment[]);
    setDaily((d.data ?? []) as Daily[]);
  }, [orgId, projectIds]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!editing || !orgId) return;
    if (editing.name.trim().length < 3 || !editing.unit.trim()) return setMsg("El recurso necesita nombre y unidad.");
    const row = { ...editing, org_id: orgId, name: editing.name.trim() };
    const { error } = editing.id
      ? await supabase.from("resource_catalog").update(row).eq("id", editing.id)
      : await supabase.from("resource_catalog").insert(row);
    if (error) return setMsg(`No se pudo guardar: ${error.message}`);
    setEditing(null);
    setMsg("✓ Recurso guardado");
    await load();
  }

  const byActivity = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) m.set(a.activity_id, [...(m.get(a.activity_id) ?? []), a]);
    return m;
  }, [assignments]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">Biblioteca de rendimientos y costos</h1>
        <p className="text-zinc-500">Todos los supuestos están a la vista. El rendimiento real sale del avance registrado en campo.</p>
      </div>

      {msg ? (
        <div className="rounded-lg bg-blue-50 px-4 py-2 font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          {msg}{" "}
          <button className="ml-2 underline" onClick={() => setMsg(null)}>
            cerrar
          </button>
        </div>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-4 text-sm font-bold uppercase tracking-wide text-zinc-500">Supuestos de jornada (estimados)</div>
        <Field label="Horas efectivas / día">
          <Input type="number" min={1} max={24} value={w.effectiveHours} onChange={(e) => setW({ ...w, effectiveHours: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Horas pagadas / día">
          <Input type="number" min={1} max={24} value={w.paidHours} onChange={(e) => setW({ ...w, paidHours: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Turnos">
          <Select value={w.shifts} onChange={(e) => setW({ ...w, shifts: Number(e.target.value) })}>
            <option value={1}>1 turno</option>
            <option value={2}>2 turnos</option>
            <option value={3}>3 turnos</option>
          </Select>
        </Field>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold">Recursos</h2>
          {isAdmin ? (
            <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
              ＋ Recurso
            </Button>
          ) : null}
        </div>

        {editing ? <ResourceEditor value={editing} onChange={setEditing} onSave={() => void save()} onCancel={() => setEditing(null)} w={w} /> : null}

        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-[15px]">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2">Recurso</th>
                <th>Referencia</th>
                <th>Disp.</th>
                <th>Factores</th>
                <th className="text-right">Rinde / día</th>
                <th className="text-right">Costo / día</th>
                <th className="pr-4 text-right">Costo por unidad</th>
              </tr>
            </thead>
            <tbody>
              {resources
                .filter((r) => !r.archived)
                .map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => isAdmin && setEditing({ ...r })}
                    className={cx("border-b border-zinc-100 dark:border-zinc-800", isAdmin && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50")}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">{r.name}</div>
                      <div className="flex gap-1">
                        <Badge>{r.kind === "equipment" ? "Equipo" : "Cuadrilla"}</Badge>
                        <Badge>{r.ownership === "own" ? "Propio" : "Alquilado"}</Badge>
                      </div>
                    </td>
                    <td>
                      {qty(Number(r.ref_rate), 2)} {r.unit}/{r.rate_basis === "hour" ? "h" : "día"}
                    </td>
                    <td>{Math.round(Number(r.mechanical_availability) * 100)} %</td>
                    <td className="text-sm text-zinc-600">
                      {Object.entries(r.factors ?? {}).map(([k, v]) => `${k} ×${v}`).join(", ") || "—"}
                    </td>
                    <td className="text-right font-semibold">
                      {qty(effectiveDaily(r, w))} {r.unit}
                    </td>
                    <td className="text-right">{money(dailyCost(r, w))}</td>
                    <td className="pr-4 text-right">
                      {money(unitCost(r, w))} / {r.unit}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold">Rendimiento real vs. referencia por actividad</h2>
        <p className="text-zinc-500">Últimos 14 días con avance. Elige qué rendimiento usará la proyección y la calculadora de equipos.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {activities.map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              assigned={byActivity.get(a.id) ?? []}
              resources={resources}
              daily={daily.filter((d) => d.activity_id === a.id)}
              w={w}
              isAdmin={isAdmin}
              onChanged={load}
              onError={setMsg}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ResourceEditor({
  value: v,
  onChange,
  onSave,
  onCancel,
  w,
}: {
  value: Partial<Resource> & typeof BLANK;
  onChange: (r: Partial<Resource> & typeof BLANK) => void;
  onSave: () => void;
  onCancel: () => void;
  w: WorkdayAssumptions;
}) {
  const set = (k: keyof Resource, val: unknown) => onChange({ ...v, [k]: val });
  const n = (s: string) => Number(s.replace(",", ".")) || 0;
  const [factorKey, setFactorKey] = useState("");
  const preview = { ...v, id: "x", org_id: "x" } as Resource;
  return (
    <Card className="space-y-4 border-blue-400">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Nombre" className="md:col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Hincadora de pilotes" />
        </Field>
        <Field label="Tipo">
          <Select value={v.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="equipment">Equipo</option>
            <option value="crew">Cuadrilla</option>
          </Select>
        </Field>
        <Field label="Propiedad">
          <Select value={v.ownership} onChange={(e) => set("ownership", e.target.value)}>
            <option value="rented">Alquilado</option>
            <option value="own">Propio</option>
          </Select>
        </Field>
        <Field label="Rendimiento de referencia">
          <Input value={v.ref_rate} onChange={(e) => set("ref_rate", n(e.target.value))} />
        </Field>
        <Field label="Unidad">
          <Input value={v.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pilotes, m³…" />
        </Field>
        <Field label="Por">
          <Select value={v.rate_basis} onChange={(e) => set("rate_basis", e.target.value)}>
            <option value="hour">hora efectiva</option>
            <option value="day">día</option>
          </Select>
        </Field>
        <Field label="Disponibilidad mecánica" hint="(0–1)">
          <Input value={v.mechanical_availability} onChange={(e) => set("mechanical_availability", n(e.target.value))} />
        </Field>
      </div>

      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Factores de ajuste (esponjamiento, suelo, clima, curva de aprendizaje…)
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(v.factors ?? {}).map(([k, val]) => (
            <span key={k} className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
              {k} ×
              <input className="w-16 rounded border border-zinc-300 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-950" value={val} onChange={(e) => set("factors", { ...v.factors, [k]: n(e.target.value) })} />
              <button
                className="text-red-700"
                onClick={() => {
                  const f = { ...v.factors };
                  delete f[k];
                  set("factors", f);
                }}
              >
                ✕
              </button>
            </span>
          ))}
          <Input className="w-44" placeholder="nuevo factor" value={factorKey} onChange={(e) => setFactorKey(e.target.value)} />
          <Button
            size="sm"
            disabled={!factorKey.trim()}
            onClick={() => {
              set("factors", { ...v.factors, [factorKey.trim().toLowerCase().replace(/\s+/g, "_")]: 1 });
              setFactorKey("");
            }}
          >
            ＋
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-6">
        {(
          [
            ["cost_per_hour", "Alquiler / posesión por h"],
            ["operator_cost_per_hour", "Operador / cuadrilla por h"],
            ["fuel_cost_per_hour", "Combustible por h"],
            ["maintenance_cost_per_hour", "Mantenimiento por h"],
            ["mobilization_cost", "Movilización (ida y vuelta)"],
            ["min_rental_days", "Mínimo de alquiler (días)"],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <Input value={v[k] as number} onChange={(e) => set(k, n(e.target.value))} />
          </Field>
        ))}
      </div>

      <div className="rounded-lg bg-zinc-50 p-3 text-[15px] dark:bg-zinc-800/50">
        Con los supuestos de jornada: rinde <b>{qty(effectiveDaily(preview, w))} {v.unit}/día</b> por unidad, cuesta{" "}
        <b>{money(dailyCost(preview, w))}/día</b> → <b>{money(unitCost(preview, w))}</b> por {v.unit || "unidad"}.
      </div>

      <div className="flex gap-2">
        <Button variant="primary" onClick={onSave}>
          Guardar recurso
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

function ActivityCard({
  activity: a,
  assigned,
  resources,
  daily,
  w,
  isAdmin,
  onChanged,
  onError,
}: {
  activity: Activity;
  assigned: Assignment[];
  resources: Resource[];
  daily: Daily[];
  w: WorkdayAssumptions;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const withRes = assigned
    .map((x) => ({ ...x, resource: resources.find((r) => r.id === x.resource_id) }))
    .filter((x): x is Assignment & { resource: Resource } => Boolean(x.resource));
  const cmp = compareActivity(withRes.map((x) => ({ resource: x.resource, units: Number(x.units) })), daily, w);
  const useReal = assigned.some((x) => x.use_real_rate);
  const maxBar = Math.max(cmp.referenceDaily, cmp.realDaily, 1);

  async function call(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p;
    if (error) onError(error.message);
    await onChanged();
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold">
            {a.code} · {a.name}
          </div>
          <div className="text-sm text-zinc-500">
            {cmp.real.samples} día(s) con avance{!cmp.real.reliable && cmp.real.samples > 0 ? " · poco confiable" : ""}
          </div>
        </div>
        {withRes.length > 0 && cmp.real.samples > 0 ? (
          <Badge tone={cmp.ratio < 0.6 ? "red" : cmp.ratio < 0.85 ? "amber" : "green"}>{Math.round(cmp.ratio * 100)} % de la referencia</Badge>
        ) : null}
      </div>

      <div className="space-y-1.5 text-sm">
        {[
          ["Referencia", cmp.referenceDaily, "bg-zinc-400"],
          ["Real (promedio)", cmp.realDaily, "bg-blue-600"],
        ].map(([label, val, color]) => (
          <div key={label as string} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-zinc-600 dark:text-zinc-400">{label as string}</span>
            <div className="h-3 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
              <div className={cx("h-3 rounded", color as string)} style={{ width: `${Math.min(100, ((val as number) / maxBar) * 100)}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right font-semibold">
              {qty(val as number)} {a.unit}/día
            </span>
          </div>
        ))}
      </div>

      {cmp.warnings.length && withRes.length ? <p className="text-sm text-amber-800 dark:text-amber-300">⚠ {cmp.warnings[0]}</p> : null}

      <div className="space-y-1">
        {withRes.map((x) => (
          <div key={x.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{x.resource.name}</span>
            <input
              type="number"
              min={0}
              step={1}
              disabled={!isAdmin}
              defaultValue={x.units}
              className="w-16 rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950"
              onBlur={(e) => Number(e.target.value) !== Number(x.units) && void call(supabase.from("activity_resources").update({ units: Number(e.target.value) }).eq("id", x.id))}
            />
            <span className="text-zinc-500">unid.</span>
            {isAdmin ? (
              <button className="text-red-700" onClick={() => void call(supabase.from("activity_resources").delete().eq("id", x.id))}>
                ✕
              </button>
            ) : null}
          </div>
        ))}
        {isAdmin ? (
          <div className="flex gap-2 pt-1">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">＋ Asignar recurso…</option>
              {resources
                .filter((r) => !r.archived && !assigned.some((x) => x.resource_id === r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
            <Button
              size="sm"
              disabled={!adding}
              onClick={() => {
                void call(supabase.from("activity_resources").insert({ project_id: a.project_id, activity_id: a.id, resource_id: adding, units: 1 }));
                setAdding("");
              }}
            >
              Asignar
            </Button>
          </div>
        ) : null}
      </div>

      {withRes.length ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
          <span className="font-semibold">La proyección usa:</span>
          {(
            [
              [false, "Referencia"],
              [true, "Real (histórico)"],
            ] as const
          ).map(([val, label]) => (
            <label key={label} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`rate-${a.id}`}
                disabled={!isAdmin}
                checked={useReal === val}
                onChange={() => void call(supabase.from("activity_resources").update({ use_real_rate: val }).eq("activity_id", a.id))}
              />
              {label}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Sin recursos asignados: asigna equipos o cuadrillas para comparar con la referencia.</p>
      )}
    </Card>
  );
}
