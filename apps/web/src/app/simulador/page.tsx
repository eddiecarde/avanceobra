"use client";

import Link from "next/link";
import {
  addWorkingDays,
  compareScenarios,
  describePlan,
  projectSensitivity,
  SCENARIO_LABEL,
  type ScenarioKey,
} from "@avanceobra/engine";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { CostCurveChart, ScenarioStackChart } from "@/components/sim/Charts";
import { Badge, Button, Card, cx, downloadBlob, Field, Input, Select, Textarea } from "@/components/ui";
import { DEFAULT_WORKDAY, money, qty } from "@/lib/library";
import { useSession } from "@/lib/session";
import { availableFrom, loadSimInputs, toProjectSim, type SimInputs, type SimRow } from "@/lib/simulator";
import { supabase } from "@/lib/supabase";

const ORDER: ScenarioKey[] = ["base", "uniform", "optimal", "claim"];
const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

interface SavedSim {
  id: string;
  name: string;
  chosen_scenario: string | null;
  best_scenario: string | null;
  total_base: number | null;
  total_chosen: number | null;
  rationale: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Simulador "acelerar vs. multa": 4 escenarios, curva de costo, sensibilidad y decisión guardada. */
export default function Simulador() {
  const { memberships, session } = useSession();
  const projects = useMemo(
    () => [...new Map(memberships.filter((m) => m.project && ["admin", "director", "resident"].includes(m.role)).map((m) => [m.project_id, m.project!])).values()],
    [memberships],
  );
  const [projectId, setProjectId] = useState<string>("");
  const [inputs, setInputs] = useState<SimInputs | null>(null);
  const [saved, setSaved] = useState<SavedSim[]>([]);
  const [simName, setSimName] = useState("");
  const [chosen, setChosen] = useState<ScenarioKey | "">("");
  const [rationale, setRationale] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(true);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const loadSaved = useCallback(async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from("simulations")
      .select("id, name, chosen_scenario, best_scenario, total_base, total_chosen, rationale, created_by_name, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    setSaved((data ?? []) as SavedSim[]);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setInputs(null);
    void loadSimInputs(projectId, DEFAULT_WORKDAY).then(setInputs);
    void loadSaved();
  }, [projectId, loadSaved]);

  const deferred = useDeferredValue(inputs);
  const result = useMemo(() => {
    if (!deferred) return null;
    try {
      const sim = toProjectSim(deferred);
      if (sim.activities.length === 0) return { error: "No hay actividades con saldo pendiente para simular." } as const;
      const cmp = compareScenarios(sim);
      return { sim, cmp, sens: projectSensitivity(sim), avail: availableFrom(deferred) } as const;
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [deferred]);

  if (!projects.length) return <p className="text-zinc-500">El simulador está disponible para residente, director y administrador.</p>;
  if (!inputs) return <p className="text-zinc-500">Cargando datos del proyecto…</p>;

  const setRow = (id: string, patch: Partial<SimRow>) => setInputs({ ...inputs, rows: inputs.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const setContract = (patch: Partial<SimInputs["contract"]>) => setInputs({ ...inputs, contract: { ...inputs.contract, ...patch } });
  const ok = result && !("error" in result) ? result : null;
  const best = ok?.cmp.best;
  // Sin ningún costo de aceleración los 4 escenarios dan lo mismo: en vez de compararlos se guía a cargar costos
  const included = inputs.rows.filter((r) => r.include);
  const missingCost = included.filter((r) => (r.equipmentDailyCost ?? 0) + (r.laborDailyCost ?? 0) <= 0);
  const noCosts = included.length > 0 && missingCost.length === included.length;

  async function save() {
    if (!ok || !session) return;
    const choice = (chosen || ok.cmp.best) as ScenarioKey;
    const name = simName.trim() || `Simulación ${new Date().toLocaleDateString("es-CO")}`;
    const results = {
      best: ok.cmp.best,
      recommendation: ok.cmp.recommendation,
      actions: ok.cmp.actions,
      warnings: ok.cmp.warnings,
      breakEven: ok.cmp.breakEven,
      curve: ok.cmp.curve,
      sensitivity: ok.sens,
      scenarios: Object.fromEntries(
        ORDER.map((k) => {
          const s = ok.cmp.scenarios[k];
          return [k, { projectDuration: s.projectDuration, delayDays: s.delayDays, total: s.total, penalty: s.penalty, acceleration: s.acceleration, indirect: s.indirect, plan: s.plan }];
        }),
      ),
    };
    const { error } = await supabase.from("simulations").insert({
      project_id: projectId,
      name,
      assumptions: { inputs, availableDays: ok.sim.availableDays, simulatedOn: today() },
      results,
      chosen_scenario: choice,
      best_scenario: ok.cmp.best,
      rationale: rationale.trim() || null,
      total_base: Math.round(ok.cmp.scenarios.base.total),
      total_chosen: Math.round(ok.cmp.scenarios[choice].total),
      created_by: session.user.id,
    });
    if (error) return setMsg({ tone: "error", text: `No se pudo guardar: ${error.message}` });
    setMsg({ tone: "ok", text: "✓ Simulación guardada con todos sus supuestos. No se puede modificar: queda como soporte de la decisión." });
    setSimName("");
    setRationale("");
    await loadSaved();
  }

  async function exportExcel() {
    if (!ok) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const r = wb.addWorksheet("Escenarios");
    r.addRow([`Simulación acelerar vs. multa — ${inputs!.projectName} — ${today()}`]).font = { bold: true, size: 14 };
    r.addRow([ok.cmp.recommendation]);
    r.addRow([]);
    r.addRow(["Escenario", "Días de obra", "Retraso (días)", "Recursos actuales", "Aceleración", "Calidad", "Multa", "Indirectos", "Bono", "Total", "Diferencia vs. base"]).font = { bold: true };
    for (const k of ORDER) {
      const s = ok.cmp.scenarios[k];
      r.addRow([SCENARIO_LABEL[k], s.projectDuration, s.delayDays, s.currentResources, s.acceleration, s.quality, s.penalty, s.indirect, s.bonus, s.total, s.total - ok.cmp.scenarios.base.total]);
    }
    r.getColumn(1).width = 30;
    for (let c = 4; c <= 11; c++) r.getColumn(c).numFmt = '"$"#,##0';
    const a = wb.addWorksheet("Supuestos");
    a.addRow(["Actividad", "Pendiente", "Unidad", "Rend./unidad/día", "Origen", "Unidades", "Máx. unidades", "Máx. turnos", "Equipo/día", "Mano de obra/día", "Movilización", "Predecesoras"]).font = { bold: true };
    for (const x of inputs!.rows.filter((x) => x.include))
      a.addRow([x.name, x.pendingQty, x.unit, x.perUnitDaily, x.rateSource, x.currentUnits, x.maxUnits, x.maxShifts, x.equipmentDailyCost, x.laborDailyCost, x.mobilization, x.predecessors.map((p) => inputs!.rows.find((y) => y.id === p)?.code).join(", ")]);
    a.addRow([]);
    const c = inputs!.contract;
    a.addRows([
      ["Días disponibles", ok.sim.availableDays],
      ["Lluvia estimada", inputs!.rainPct],
      ["Multa por día", c.penaltyPerDay],
      ["Tope de multa", c.penaltyCap ?? "sin tope"],
      ["Indirectos por día", c.dailyIndirectCost],
      ["Días reclamables", c.claimableDays],
    ]);
    const cv = wb.addWorksheet("Curva");
    cv.addRow(["Días de retraso", "Días de obra", "Costo total", "Paso"]).font = { bold: true };
    ok.cmp.curve.forEach((p) => cv.addRow([p.delayDays, p.projectDuration, p.total, p.step]));
    const se = wb.addWorksheet("Sensibilidad");
    se.addRow(["Caso", "Mejor escenario", "Total", "Ahorro vs. base", "Retraso base"]).font = { bold: true };
    ok.sens.forEach((s) => se.addRow([s.name, SCENARIO_LABEL[s.best], s.bestTotal, s.saving, s.baseDelay]));
    downloadBlob(`simulacion_${today()}.xlsx`, await wb.xlsx.writeBuffer(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">¿Acelerar o pagar la multa?</h1>
          <p className="text-zinc-500">
            {inputs.projectName} · fecha contractual {inputs.contract.contractEnd}
            {ok ? ` · ${ok.avail.available} días laborables disponibles (${ok.avail.workingDays} − ${ok.avail.rainDays} por lluvia)` : ""}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {projects.length > 1 ? (
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-56">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Button onClick={() => void exportExcel()} disabled={!ok || noCosts}>
            Exportar Excel
          </Button>
          <Button onClick={() => window.print()} disabled={!ok || noCosts}>
            Imprimir / PDF
          </Button>
        </div>
      </div>

      {result && "error" in result ? <Card className="font-semibold text-red-700">{result.error}</Card> : null}

      {ok && noCosts ? (
        <Card className="border-l-8 border-l-amber-500">
          <span className="text-xs font-bold uppercase tracking-wide text-zinc-500">Faltan costos para comparar</span>
          <p className="mt-1 text-lg font-semibold leading-snug">
            Si sigues igual: {ok.cmp.scenarios.base.delayDays > 0 ? `${ok.cmp.scenarios.base.delayDays} días de retraso, multa de ${M(ok.cmp.scenarios.base.penalty)}` : "terminas a tiempo, sin multa"} y
            un costo total de {M(ok.cmp.scenarios.base.total)}.
          </p>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Para saber si conviene acelerar hace falta lo que cuesta poner más equipos o turnos. Ninguna actividad lo tiene todavía, así que los escenarios saldrían iguales.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5">
            <li>
              En{" "}
              <Link href="/biblioteca" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                Rendimientos y costos
              </Link>
              , crea los recursos (equipo o cuadrilla) con su costo por día y asígnalos a cada actividad.
            </li>
            <li>O escribe el costo directo en <b>Supuestos</b>, más abajo: columnas Equipo/día y M. de obra/día.</li>
          </ol>
          <p className="mt-3 text-sm text-zinc-500">Sin costo: {missingCost.map((r) => r.code).join(", ")}.</p>
        </Card>
      ) : null}

      {ok && !noCosts ? (
        <>
          <Card className="border-l-8 border-l-blue-700">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-zinc-500">Recomendación</span>
              <Badge tone="blue">{SCENARIO_LABEL[ok.cmp.best]}</Badge>
            </div>
            <p className="text-lg font-semibold leading-snug">{ok.cmp.recommendation}</p>
            {ok.cmp.breakEven && ok.cmp.scenarios.base.delayDays > 0 ? (
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                Punto de equilibrio:{" "}
                {ok.cmp.breakEven.delayDays === 0 ? (
                  <b>conviene acelerar hasta cumplir la fecha contractual</b>
                ) : (
                  <>
                    conviene acelerar hasta quedar con <b>{ok.cmp.breakEven.delayDays} día(s) de retraso</b>
                  </>
                )}
                {ok.cmp.breakEven.nextStepExtraCost !== null ? (
                  <>
                    ; el siguiente paso de aceleración cuesta <b>{M(ok.cmp.breakEven.nextStepExtraCost)}</b> más de lo que evita.
                  </>
                ) : (
                  "."
                )}
              </p>
            ) : null}
            {ok.cmp.warnings.length ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-800 dark:text-amber-300">
                {ok.cmp.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            ) : null}
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ORDER.map((k) => {
              const s = ok.cmp.scenarios[k];
              const delta = s.total - ok.cmp.scenarios.base.total;
              const actions = describePlan(ok.sim, s);
              return (
                <Card key={k} className={cx(k === best && "ring-2 ring-blue-600")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold">{SCENARIO_LABEL[k]}</div>
                    {k === best ? <Badge tone="blue">Menor costo</Badge> : null}
                  </div>
                  <div className="mt-2 text-3xl font-extrabold tabular-nums">{M(s.total)}</div>
                  <div className={cx("text-sm font-semibold", delta < 0 ? "text-green-700 dark:text-green-400" : delta > 0 ? "text-red-700 dark:text-red-400" : "text-zinc-500")}>
                    {k === "base" ? "Referencia" : delta < 0 ? `Ahorra ${M(-delta)}` : delta > 0 ? `Cuesta ${M(delta)} más` : "Igual al base"}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-zinc-500">Termina</dt>
                    <dd className="text-right tabular-nums">{s.projectDuration > 0 && s.projectDuration < 3000 ? addWorkingDays(today(), s.projectDuration) : "—"}</dd>
                    <dt className="text-zinc-500">Retraso</dt>
                    <dd className={cx("text-right tabular-nums", s.delayDays > 0 && "font-semibold text-red-700 dark:text-red-400")}>{s.delayDays} días</dd>
                    <dt className="text-zinc-500">Multa</dt>
                    <dd className="text-right tabular-nums">{M(s.penalty)}</dd>
                    <dt className="text-zinc-500">Aceleración</dt>
                    <dd className="text-right tabular-nums">{M(s.acceleration + s.quality)}</dd>
                    <dt className="text-zinc-500">Indirectos</dt>
                    <dd className="text-right tabular-nums">{M(s.indirect)}</dd>
                    {s.totalPV !== null ? (
                      <>
                        <dt className="text-zinc-500">Valor presente</dt>
                        <dd className="text-right tabular-nums">{M(s.totalPV)}</dd>
                      </>
                    ) : null}
                  </dl>
                  {actions.length ? (
                    <ul className="mt-3 border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
                      {actions.map((a) => (
                        <li key={a}>• {a}</li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-bold">Costo total vs. días de retraso</h2>
              <p className="mb-2 text-sm text-zinc-500">Cada punto es un paso de aceleración sobre la ruta crítica (escenario mixto).</p>
              <CostCurveChart curve={ok.cmp.curve} />
            </Card>
            <Card>
              <h2 className="font-bold">Composición del costo por escenario</h2>
              <p className="mb-2 text-sm text-zinc-500">Pasa el cursor por una barra para ver el detalle.</p>
              <ScenarioStackChart scenarios={ok.cmp.scenarios} labels={SCENARIO_LABEL} />
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <h2 className="mb-2 font-bold">Plan por actividad · {SCENARIO_LABEL[ok.cmp.best]}</h2>
            <table className="w-full min-w-[720px] text-left text-[15px]">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1.5">Actividad</th>
                  <th>Ruta crítica</th>
                  <th className="text-right">Días (base → plan)</th>
                  <th className="text-right">Rinde/día (plan)</th>
                  <th className="pl-4">Acción</th>
                </tr>
              </thead>
              <tbody>
                {ok.cmp.scenarios[ok.cmp.best].activities.map((a) => {
                  const b = ok.cmp.scenarios.base.activities.find((x) => x.id === a.id)!;
                  const row = inputs.rows.find((r) => r.id === a.id)!;
                  const act = [a.plan.extraUnits ? `+${a.plan.extraUnits} ${row.resourceName ?? "unid."}` : "", a.plan.shifts > 1 ? `${a.plan.shifts} turnos` : ""].filter(Boolean).join(", ");
                  return (
                    <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5">
                        <b>{row.code}</b> · {row.name}
                      </td>
                      <td>
                        {!Number.isFinite(a.duration) ? (
                          <Badge tone="amber">Sin rendimiento</Badge>
                        ) : a.critical ? (
                          <Badge tone="red">Crítica</Badge>
                        ) : (
                          <span className="text-sm text-zinc-500">holgura {a.totalFloat} d</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {Number.isFinite(a.duration) ? (
                          <>
                            {b.duration} → <b>{a.duration}</b>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {qty(a.dailyOutput)} {row.unit}
                      </td>
                      <td className="pl-4">{act || <span className="text-zinc-500">sin cambios</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      <Card className="no-print space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Supuestos</h2>
          <Button size="sm" variant="ghost" onClick={() => setShowAssumptions((x) => !x)}>
            {showAssumptions ? "Ocultar" : "Mostrar"}
          </Button>
        </div>
        {showAssumptions ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Multa por día" hint="(contrato)">
                <Input value={inputs.contract.penaltyPerDay} onChange={(e) => setContract({ penaltyPerDay: num(e.target.value) })} />
              </Field>
              <Field label="Tope de multa">
                <Input value={inputs.contract.penaltyCap ?? ""} placeholder="sin tope" onChange={(e) => setContract({ penaltyCap: e.target.value.trim() ? num(e.target.value) : null })} />
              </Field>
              <Field label="Indirectos por día">
                <Input value={inputs.contract.dailyIndirectCost} onChange={(e) => setContract({ dailyIndirectCost: num(e.target.value) })} />
              </Field>
              <Field label="Bono por día anticipado">
                <Input value={inputs.contract.earlyBonusPerDay} onChange={(e) => setContract({ earlyBonusPerDay: num(e.target.value) })} />
              </Field>
              <Field label="Días reclamables" hint="(real)">
                <Input value={inputs.contract.claimableDays} onChange={(e) => setContract({ claimableDays: num(e.target.value) })} />
              </Field>
              <Field label="Fecha contractual">
                <Input type="date" value={inputs.contract.contractEnd} onChange={(e) => setContract({ contractEnd: e.target.value })} />
              </Field>
              <Field label="Lluvia estimada" hint="(% días)">
                <Input value={Math.round(inputs.rainPct * 100)} onChange={(e) => setInputs({ ...inputs, rainPct: num(e.target.value) / 100 })} />
              </Field>
              <Field label="Reproceso esperado" hint="(%)">
                <Input value={Math.round(inputs.contract.reworkPct * 1000) / 10} onChange={(e) => setContract({ reworkPct: num(e.target.value) / 100 })} />
              </Field>
              <Field label="Inspección extra / día">
                <Input value={inputs.contract.inspectionPerDay} onChange={(e) => setContract({ inspectionPerDay: num(e.target.value) })} />
              </Field>
              <Field label="Recargo nocturno" hint="(%)">
                <Input value={Math.round(inputs.nightSurcharge * 100)} onChange={(e) => setInputs({ ...inputs, nightSurcharge: num(e.target.value) / 100 })} />
              </Field>
              <Field label="Rinde 2.º turno" hint="(%)">
                <Input value={Math.round(inputs.secondShiftProductivity * 100)} onChange={(e) => setInputs({ ...inputs, secondShiftProductivity: num(e.target.value) / 100 })} />
              </Field>
              <Field label="Tasa anual" hint="(valor presente, %)">
                <Input
                  value={inputs.contract.annualDiscountRate !== null ? Math.round(inputs.contract.annualDiscountRate * 1000) / 10 : ""}
                  placeholder="no aplica"
                  onChange={(e) => setContract({ annualDiscountRate: e.target.value.trim() ? num(e.target.value) / 100 : null })}
                />
              </Field>
            </div>
            <p className="text-sm text-zinc-500">Días reclamables calculados del registro de campo: {inputs.contract.claimableSource}.</p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px] text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="py-1.5">Incluir</th>
                    <th>Actividad</th>
                    <th>Pendiente</th>
                    <th>Rinde/unidad/día</th>
                    <th>Unid.</th>
                    <th>Máx. unid.</th>
                    <th>Turnos</th>
                    <th>Equipo/día</th>
                    <th>M. de obra/día</th>
                    <th>Movilización</th>
                    <th>Depende de</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.rows.map((r) => (
                    <tr key={r.id} className={cx("border-t border-zinc-100 align-top dark:border-zinc-800", !r.include && "opacity-50")}>
                      <td className="py-1.5">
                        <input type="checkbox" checked={r.include} onChange={(e) => setRow(r.id, { include: e.target.checked })} />
                      </td>
                      <td className="pr-2">
                        <b>{r.code}</b> · {r.name}
                        <div className="text-xs text-zinc-500">{r.resourceName ?? "sin recurso en la biblioteca"}</div>
                      </td>
                      <td>
                        <input className="w-24 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.pendingQty} onChange={(e) => setRow(r.id, { pendingQty: num(e.target.value) })} />
                        <div className="text-xs text-zinc-500">{r.unit}</div>
                      </td>
                      <td>
                        <input
                          className="w-20 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                          value={Math.round(r.perUnitDaily * 100) / 100}
                          onChange={(e) => setRow(r.id, { perUnitDaily: num(e.target.value), rateSource: "manual" })}
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.realPerUnit !== null ? (
                            <button className={cx("rounded px-1 text-xs", r.rateSource === "real" ? "bg-blue-700 text-white" : "bg-zinc-100 dark:bg-zinc-800")} onClick={() => setRow(r.id, { perUnitDaily: r.realPerUnit!, rateSource: "real" })}>
                              real {qty(r.realPerUnit)}
                            </button>
                          ) : null}
                          {r.referencePerUnit !== null ? (
                            <button className={cx("rounded px-1 text-xs", r.rateSource === "reference" ? "bg-blue-700 text-white" : "bg-zinc-100 dark:bg-zinc-800")} onClick={() => setRow(r.id, { perUnitDaily: r.referencePerUnit!, rateSource: "reference" })}>
                              ref. {qty(r.referencePerUnit)}
                            </button>
                          ) : null}
                        </div>
                        {r.rateSource === "real" && !r.realReliable ? <div className="text-xs text-amber-700">pocos datos ({r.realSamples} d)</div> : null}
                        {r.rateSource === "real" && r.realSamples > 0 ? (
                          <div className="text-xs text-zinc-500">
                            {r.realMachineDays
                              ? `máquinas del parte en ${r.realMachineDays} de ${r.realSamples} d`
                              : "por máquina asignada (el parte no dice en qué actividad trabajaron)"}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <input className="w-12 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.currentUnits} onChange={(e) => setRow(r.id, { currentUnits: Math.max(1, num(e.target.value)) })} />
                      </td>
                      <td>
                        <input className="w-12 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.maxUnits} onChange={(e) => setRow(r.id, { maxUnits: Math.max(r.currentUnits, num(e.target.value)) })} />
                      </td>
                      <td>
                        <select className="rounded border border-zinc-300 bg-white px-1 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.maxShifts} onChange={(e) => setRow(r.id, { maxShifts: Number(e.target.value) as 1 | 2 | 3 })}>
                          <option value={1}>1</option>
                          <option value={2}>hasta 2</option>
                          <option value={3}>hasta 3</option>
                        </select>
                      </td>
                      <td>
                        <input className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.equipmentDailyCost ?? ""} placeholder="—" aria-label={`Equipo por día de ${r.code}`} onChange={(e) => setRow(r.id, { equipmentDailyCost: e.target.value.trim() ? num(e.target.value) : null })} />
                      </td>
                      <td>
                        <input className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.laborDailyCost ?? ""} placeholder="—" onChange={(e) => setRow(r.id, { laborDailyCost: e.target.value.trim() ? num(e.target.value) : null })} />
                      </td>
                      <td>
                        <input className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={r.mobilization} onChange={(e) => setRow(r.id, { mobilization: num(e.target.value) })} />
                      </td>
                      <td>
                        <details>
                          <summary className="cursor-pointer text-xs text-blue-700">
                            {r.predecessors.length ? r.predecessors.map((p) => inputs.rows.find((x) => x.id === p)?.code).join(", ") : "ninguna"}
                          </summary>
                          <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded border border-zinc-200 bg-white p-1.5 dark:border-zinc-700 dark:bg-zinc-950">
                            {inputs.rows
                              .filter((x) => x.id !== r.id)
                              .map((x) => (
                                <label key={x.id} className="flex items-center gap-1 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={r.predecessors.includes(x.id)}
                                    onChange={(e) => setRow(r.id, { predecessors: e.target.checked ? [...r.predecessors, x.id] : r.predecessors.filter((p) => p !== x.id) })}
                                  />
                                  {x.code}
                                </label>
                              ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-500">
              Costos por unidad y día de turno diurno (de la biblioteca, editables). El 2.º y 3.º turno rinden menos y llevan recargo nocturno sobre la mano de obra.
            </p>
          </>
        ) : null}
      </Card>

      {ok && !noCosts ? (
        <Card className="overflow-x-auto">
          <h2 className="mb-2 font-bold">Sensibilidad</h2>
          <table className="w-full min-w-[600px] text-left text-[15px]">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-1.5">Caso</th>
                <th>Mejor escenario</th>
                <th className="text-right">Costo total</th>
                <th className="text-right">Ahorro vs. seguir igual</th>
                <th className="text-right">Retraso si no se hace nada</th>
              </tr>
            </thead>
            <tbody>
              {ok.sens.map((s) => (
                <tr key={s.name} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5">{s.name}</td>
                  <td>
                    <Badge tone={s.best === ok.cmp.best ? "green" : "amber"}>{SCENARIO_LABEL[s.best]}</Badge>
                  </td>
                  <td className="text-right tabular-nums">{M(s.bestTotal)}</td>
                  <td className="text-right tabular-nums">{M(s.saving)}</td>
                  <td className="text-right tabular-nums">{s.baseDelay} días</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-zinc-500">
            {ok.sens.every((s) => s.best === ok.cmp.best) ? "✓ La recomendación se mantiene en todos los casos: es una decisión robusta." : "⚠ En algunos casos cambia la mejor opción: revisa los supuestos marcados antes de decidir."}
          </p>
        </Card>
      ) : null}

      {ok && !noCosts ? (
        <Card className="no-print space-y-3">
          <h2 className="text-lg font-bold">Guardar la decisión</h2>
          {msg ? <div className={cx("rounded-lg px-3 py-2 font-semibold", msg.tone === "ok" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300")}>{msg.text}</div> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nombre">
              <Input value={simName} onChange={(e) => setSimName(e.target.value)} placeholder="Comité de obra 21/10" />
            </Field>
            <Field label="Escenario elegido">
              <Select value={chosen || ok.cmp.best} onChange={(e) => setChosen(e.target.value as ScenarioKey)}>
                {ORDER.map((k) => (
                  <option key={k} value={k}>
                    {SCENARIO_LABEL[k]} — {M(ok.cmp.scenarios[k].total)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Justificación" className="md:col-span-3">
              <Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Por qué se elige este escenario (si no es el de menor costo, explica el motivo)" />
            </Field>
          </div>
          <Button variant="primary" onClick={() => void save()}>
            Guardar simulación
          </Button>
          {saved.length ? (
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1.5">Fecha</th>
                  <th>Nombre</th>
                  <th>Elegido</th>
                  <th className="text-right">Base → elegido</th>
                  <th>Por</th>
                </tr>
              </thead>
              <tbody>
                {saved.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-1.5 whitespace-nowrap">{new Date(s.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>
                      {s.name}
                      {s.rationale ? <div className="text-xs text-zinc-500">{s.rationale}</div> : null}
                    </td>
                    <td>
                      {SCENARIO_LABEL[(s.chosen_scenario as ScenarioKey) ?? "base"] ?? s.chosen_scenario}
                      {s.chosen_scenario !== s.best_scenario ? <div className="text-xs text-amber-700">(no era el de menor costo)</div> : null}
                    </td>
                    <td className="text-right tabular-nums">
                      {money(Number(s.total_base))} → {money(Number(s.total_chosen))}
                    </td>
                    <td>{s.created_by_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
