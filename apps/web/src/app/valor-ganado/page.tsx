"use client";

import type { CostSource } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EvmChart, IndexTrendChart } from "@/components/dash/Charts";
import { Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { localToday } from "@/lib/dashboard";
import { loadEvm, type CostRates, type EvmData } from "@/lib/evm";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const M = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
const idx = (n: number | null) => (n == null ? "—" : n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (s: string) => {
  const n = Number(s.trim().replace(/[$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const SOURCE_LABEL: Record<CostSource, string> = {
  personal: "Personal (parte diario × tarifa)",
  equipos: "Equipos (parte diario × tarifa)",
  materiales: "Materiales (entregas × precio y registros)",
  subcontratos: "Subcontratistas (actas y registros)",
  otros: "Otros costos registrados",
};

/** Semáforo de un índice: ≥ 1 bien, ≥ 0,95 atención, menos crítico. */
function tone(x: number | null) {
  if (x == null) return "text-zinc-500";
  return x >= 1 ? "text-green-700 dark:text-green-400" : x >= 0.95 ? "text-amber-600 dark:text-amber-400" : "text-red-700 dark:text-red-400";
}

/** Valor ganado (EVM) en dinero: plazo y costo juntos, con su tendencia y la lectura cruzada. */
export default function ValorGanado() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canSee = role === "resident" || role === "director" || role === "admin";
  const canEdit = role === "director" || role === "admin";
  const [cutoff, setCutoff] = useState(localToday());
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ key: string; projectId: string; data?: EvmData; error?: string } | null>(null);
  const [showRates, setShowRates] = useState(false);
  const key = `${projectId}|${cutoff}|${version}`;

  useEffect(() => {
    if (!projectId || !canSee) return;
    let off = false;
    loadEvm(projectId, cutoff).then(
      (data) => !off && setState({ key, projectId, data }),
      (e: Error) => !off && setState({ key, projectId, error: e.message }),
    );
    return () => {
      off = true;
    };
  }, [projectId, cutoff, key, canSee]);

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  if (!canSee) return <p className="text-zinc-600">El valor ganado lo ven el residente, el director y el administrador.</p>;
  // Mientras se recalcula (otra fecha o tarifas nuevas) se siguen viendo las cifras de la misma obra
  const data = state?.projectId === projectId ? state.data : undefined;
  const stale = state?.key !== key;
  const e = data?.evm;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full">
          <h1 className="text-2xl font-extrabold">Valor ganado (EVM)</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Plazo y costo en pesos: cuánto se debía ejecutar (PV), cuánto se ejecutó (EV) y cuánto costó (AC). El costo real sale solo del parte diario, las
            entregas de material, las actas de subcontratistas y los costos registrados.
          </p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(ev) => setPicked(ev.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Fecha de corte">
          <Input type="date" value={cutoff} max={localToday()} onChange={(ev) => ev.target.value && setCutoff(ev.target.value)} />
        </Field>
        {data && stale ? <span className="pb-2 text-sm text-zinc-500">Actualizando…</span> : null}
        {canEdit ? (
          <Button onClick={() => setShowRates((v) => !v)} aria-expanded={showRates}>
            {showRates ? "Cerrar tarifas" : "Tarifas y precios"}
          </Button>
        ) : null}
      </div>

      {state?.key === key && state.error ? <Card className="text-red-700">No se pudo calcular: {state.error}</Card> : null}
      {!data || !e ? (
        !state?.error ? <p className="text-zinc-500">Calculando…</p> : null
      ) : (
        <>
          {showRates ? <RatesEditor key={projectId} projectId={projectId} data={data} onSaved={() => setVersion((v) => v + 1)} /> : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="SPI · plazo" value={idx(e.spi)} className={tone(e.spi)} hint={e.spi == null ? "sin programado a la fecha" : `SV ${M(e.sv)} · ${e.spi >= 1 ? "al día o adelantado" : "atrasado"}`} />
            <Kpi label="CPI · costo" value={idx(e.cpi)} className={tone(e.cpi)} hint={e.cpi == null ? "sin costo real todavía" : `CV ${M(e.cv)} · por cada $1 se obtienen $${idx(e.cpi)} de obra`} />
            <Kpi label="EAC · costo estimado final" value={e.eac == null ? "—" : M(e.eac)} hint={`Presupuesto (BAC) ${M(e.bac)}${e.vac != null ? ` · ${e.vac >= 0 ? "ahorro" : "sobrecosto"} ${M(Math.abs(e.vac))}` : ""}`} />
            <Kpi label="ETC · falta por gastar" value={e.etc == null ? "—" : M(e.etc)} hint={e.tcpi == null ? "—" : `TCPI ${idx(e.tcpi)}: CPI necesario para cerrar en presupuesto`} />
          </div>

          <Card className="border-l-4 border-l-blue-600">
            <h2 className="text-lg font-bold">Lectura</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {e.readings.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {data.unpricedRoles.length || data.unpricedEquipment.length || data.unpricedMaterials.length ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Sin tarifa (no suman al costo real):{" "}
                {[...data.unpricedRoles, ...data.unpricedEquipment, ...data.unpricedMaterials].slice(0, 10).join(", ")}
                {data.unpricedRoles.length + data.unpricedEquipment.length + data.unpricedMaterials.length > 10 ? "…" : ""}. Si es personal o equipo de un
                subcontratista, déjalo sin tarifa: su costo entra por sus actas.
              </p>
            ) : null}
            {data.manualMaterialAndDeliveries ? (
              <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                Hay costos de material registrados a mano y también entregas con precio: revisa que no estés contando el mismo material dos veces.
              </p>
            ) : null}
            {e.budgetedActivities < e.totalActivities ? (
              <p className="mt-2 text-sm">
                Carga el costo unitario presupuestado en{" "}
                <Link href="/costos" className="font-semibold text-blue-700 underline dark:text-blue-400">
                  Costos y productividad
                </Link>
                .
              </p>
            ) : null}
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <h2 className="mb-2 text-lg font-bold">Curvas en dinero</h2>
              <EvmChart rows={e.series} format={M} />
            </Card>
            <Card>
              <h2 className="mb-2 text-lg font-bold">Costo real por fuente</h2>
              <table className="w-full text-sm">
                <tbody>
                  {(Object.keys(SOURCE_LABEL) as CostSource[]).map((s) => (
                    <tr key={s} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5">{SOURCE_LABEL[s]}</td>
                      <td className="text-right font-semibold tabular-nums">{M(e.acBySource[s])}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-zinc-300 font-bold dark:border-zinc-700">
                    <td className="py-1.5">Total (AC)</td>
                    <td className="text-right tabular-nums">{M(e.ac)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-lg font-bold">Tendencia de SPI y CPI</h2>
              <IndexTrendChart rows={e.series.slice(-12)} />
            </Card>
            <Card>
              <h2 className="mb-2 text-lg font-bold">Semana a semana</h2>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="py-1 text-left">Corte</th>
                      <th>PV</th>
                      <th>EV</th>
                      <th>AC</th>
                      <th>SPI</th>
                      <th>CPI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...e.series].reverse().slice(0, 12).map((p) => (
                      <tr key={p.date} className="border-t border-zinc-100 tabular-nums dark:border-zinc-800">
                        <td className="py-1 text-left">{p.date}</td>
                        <td>{M(p.pv)}</td>
                        <td>{M(p.ev)}</td>
                        <td>{M(p.ac)}</td>
                        <td className={cx("font-semibold", tone(p.spi))}>{idx(p.spi)}</td>
                        <td className={cx("font-semibold", tone(p.cpi))}>{idx(p.cpi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, className }: { label: string; value: string; hint: string; className?: string }) {
  return (
    <Card>
      <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={cx("mt-1 text-3xl font-extrabold tabular-nums", className)}>{value}</p>
      <p className="text-sm text-zinc-500">{hint}</p>
    </Card>
  );
}

/** Tarifas diarias por cargo y equipo, y precio por unidad de cada material (se escriben una vez). */
function RatesEditor({ projectId, data, onSaved }: { projectId: string; data: EvmData; onSaved: () => void }) {
  const toText = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]));
  const [form, setForm] = useState(() => ({ personnel: toText(data.rates.personnel), equipment: toText(data.rates.equipment), materials: toText(data.rates.materials) }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const set = (group: keyof typeof form, k: string, v: string) => setForm({ ...form, [group]: { ...form[group], [k]: v } });
  const clean = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]).filter(([, v]) => (v as number) > 0));

  async function save() {
    setBusy(true);
    setMsg(null);
    const rates: CostRates = { personnel: clean(form.personnel), equipment: clean(form.equipment), materials: clean(form.materials) };
    const { error } = await supabase.from("cost_rates").upsert({ project_id: projectId, ...rates, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: "Tarifas guardadas. El costo real se recalculó." });
    onSaved();
  }

  const group = (title: string, hint: string, k: keyof typeof form, items: { key: string; label: string }[]) => (
    <div>
      <h3 className="font-bold">{title}</h3>
      <p className="mb-2 text-xs text-zinc-500">{hint}</p>
      {items.length ? (
        <div className="space-y-1.5">
          {items.map((i) => (
            <label key={i.key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              <Input aria-label={`Tarifa de ${i.label}`} inputMode="numeric" className="w-36 py-1 text-right" value={form[k][i.key] ?? ""} placeholder="sin tarifa" onChange={(ev) => set(k, i.key, ev.target.value)} />
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No hay registros todavía.</p>
      )}
    </div>
  );

  return (
    <Card>
      <h2 className="text-lg font-bold">Tarifas y precios</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Se escriben una vez. Con ellas, el parte diario que ya llena el supervisor se convierte en costo real, sin digitar nada más en campo. Deja sin tarifa el
        personal y los equipos de subcontratistas: su costo entra por sus actas de pago.
      </p>
      <div className="grid gap-5 md:grid-cols-3">
        {group("Personal", "Pesos por persona-día (salario + prestaciones).", "personnel", data.roles.map((r) => ({ key: r, label: r })))}
        {group("Equipos", "Pesos por equipo-día (alquiler, operador y combustible).", "equipment", data.equipmentTypes.map((r) => ({ key: r, label: r })))}
        {group(
          "Materiales",
          "Pesos por unidad entregada.",
          "materials",
          data.materials.map((m) => ({ key: m.id, label: `${m.name} (${m.unit})` })),
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Guardando…" : "Guardar tarifas"}
        </Button>
        {msg ? <span className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>{msg.text}</span> : null}
      </div>
    </Card>
  );
}
