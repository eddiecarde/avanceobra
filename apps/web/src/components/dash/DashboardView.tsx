"use client";

import {
  activityStatus,
  addDays,
  diffDays,
  lossPareto,
  pareto,
  plannedQtyAt,
  recentDailyRate,
  sCurve,
  weighting,
  type ActivityStatus,
  type Light,
  type ParetoMetric,
  type ZoneStatus,
} from "@avanceobra/engine";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ParetoChart, SCurveChart } from "@/components/dash/Charts";
import { LIGHT_ORDER, LightBadge } from "@/components/dash/Light";
import { longDate, Overview, type BaselineCurve, type DashTab } from "@/components/dash/Overview";
import { plural, SubfieldsView, WeeklyView, zoneLabelOf } from "@/components/dash/Planning";
import { SiteMap, ZONE_LABEL } from "@/components/dash/SiteMap";
import { Icon } from "@/components/icons";
import { Badge, Button, Card, cx, Field, Select } from "@/components/ui";
import {
  FINDING_STATUS_LABEL,
  FINDING_TYPE_LABEL,
  localToday,
  LOSS_LABEL,
  pct,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  type DashData,
} from "@/lib/dashboard";

const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <Card className="p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={cx(
          "mt-1 text-2xl font-extrabold tabular-nums",
          tone === "good" && "text-green-700 dark:text-green-400",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "bad" && "text-red-700 dark:text-red-400",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{sub}</div> : null}
    </Card>
  );
}

const DASH_TABS: { key: DashTab; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "avance", label: "Avance" },
  { key: "semanal", label: "Semanal" },
  { key: "subcampos", label: "Subcampos" },
  { key: "cantidades", label: "Cantidades" },
  { key: "contratistas", label: "Contratistas" },
  { key: "calidad", label: "Calidad" },
  { key: "restricciones", label: "Restricciones" },
  { key: "reportes", label: "Reportes" },
];

const PARETO_METRICS: { value: ParetoMetric; label: string; format: (v: number) => string }[] = [
  { value: "lost_hours", label: "Horas perdidas", format: (v) => `${n1(v)} h` },
  { value: "lost_cost", label: "Costo de recursos parados", format: M },
  { value: "events", label: "Número de eventos", format: (v) => n1(v) },
];

interface DashboardViewProps {
  data: DashData | null;
  error: string | null;
  /** Subtítulo adicional (p. ej. "Enlace para Interventoría · vence …"). */
  note?: ReactNode;
  /** Controles extra en la cabecera, según la fecha de corte (selector de proyecto, informe). */
  actions?: (cutoff: string) => ReactNode;
  /** El enlace compartido puede excluir los hallazgos: entonces no se muestran como "0 abiertos". */
  showFindings?: boolean;
  /** Bloques bajo la cabecera (lista de puesta a punto, enlaces para compartir). */
  top?: ReactNode;
}

/** Dashboard de obra: indicadores, curva S, semáforos, Pareto, pendientes y plano coloreado. Se usa con sesión y en el enlace de solo lectura. */
export function DashboardView({ data, error, note, actions, showFindings = true, top }: DashboardViewProps) {
  const [cutoff, setCutoff] = useState(localToday());
  const [tab, setTab] = useState<DashTab>("resumen");

  // Pareto
  const [paretoSource, setParetoSource] = useState<"losses" | "findings">("losses");
  const [metric, setMetric] = useState<ParetoMetric>("lost_hours");
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");
  const [paretoCompany, setParetoCompany] = useState("");

  // Plano
  const [mapActivity, setMapActivity] = useState("");
  const [mapDate, setMapDate] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [zoneCounts, setZoneCounts] = useState<Record<ZoneStatus, number> | null>(null);

  const cal = data?.project.calendar;

  const curve = useMemo(() => {
    if (!data) return null;
    const daily = data.daily.filter((d) => d.date <= cutoff);
    const starts = data.activities.map((a) => a.plannedStart).filter(Boolean) as string[];
    const ends = data.activities.map((a) => a.plannedFinish).filter(Boolean) as string[];
    const from = data.project.startDate ?? starts.sort()[0] ?? daily[0]?.date ?? cutoff;
    const to = data.project.contractEnd ?? ends.sort().at(-1) ?? cutoff;
    // Planta por grupos de trabajo: la proyección sigue el ritmo de cada grupo (últimas 3 semanas)
    const groups = data.activities.some((a) => a.workGroup) ? new Map(data.activities.map((a) => [a.id, a.workGroup])) : null;
    return sCurve({
      activities: data.activities,
      daily,
      from,
      to: to < cutoff ? cutoff : to,
      today: cutoff,
      calendar: cal,
      ...(groups ? { groupOf: (id: string) => groups.get(id) ?? null, rateWindowDays: 21 } : {}),
    });
  }, [data, cutoff, cal]);

  // Línea base guardada (contractual): el programado con sus fechas, en las mismas fechas de la curva
  const baselineCurve = useMemo<BaselineCurve>(() => {
    const bl = data?.baselines[0];
    if (!data || !bl || !curve?.points.length) return null;
    const acts = data.activities.map((a) => {
      const d = bl.dates[a.id];
      return d ? { ...a, plannedStart: d.start ?? a.plannedStart, plannedFinish: d.finish ?? a.plannedFinish } : a;
    });
    const r = sCurve({ activities: acts, daily: [], from: curve.points[0]!.date, to: curve.points.at(-1)!.date, today: cutoff, calendar: cal });
    return { name: `Línea base: ${bl.name}`, points: r.points.map((p) => ({ date: p.date, value: p.planned })) };
  }, [data, curve, cutoff, cal]);

  const statuses = useMemo(() => {
    if (!data) return [];
    const daily = data.daily.filter((d) => d.date <= cutoff);
    return data.activities.map((a) => {
      const executed = daily.filter((d) => d.activityId === a.id).reduce((s, d) => s + d.quantity, 0);
      return {
        ...activityStatus(a, executed, recentDailyRate(daily, a.id, cutoff, 14, cal), cutoff, cal),
        front: `${a.frontCode} · ${a.frontName}`,
        plannedFinish: a.plannedFinish,
      };
    });
  }, [data, cutoff, cal]);

  const lightCounts = useMemo(() => {
    const c = Object.fromEntries(LIGHT_ORDER.map((l) => [l, 0])) as Record<Light, number>;
    statuses.forEach((s) => c[s.light]++);
    return c;
  }, [statuses]);

  const paretoRows = useMemo(() => {
    if (!data) return [];
    const from = period === "all" ? "0000-01-01" : addDays(cutoff, -(Number(period) - 1));
    if (paretoSource === "findings") {
      const items = data.findings
        .filter((f) => f.createdAt.slice(0, 10) >= from && f.createdAt.slice(0, 10) <= cutoff)
        .map((f) => ({ key: f.type, value: 1 }));
      return pareto(items).map((r) => ({ ...r, name: FINDING_TYPE_LABEL[r.key] ?? r.key }));
    }
    const inCompany = (activityId: string) => !paretoCompany || data.activities.find((a) => a.id === activityId)?.companyId === paretoCompany;
    const recs = data.losses.filter((l) => l.date >= from && l.date <= cutoff && inCompany(l.activityId));
    return lossPareto(recs, metric === "lost_cost" && !data.losses.some((l) => l.idleCostPerHour != null) ? "lost_hours" : metric).map((r) => ({ ...r, name: LOSS_LABEL[r.key] ?? r.key }));
  }, [data, cutoff, period, paretoSource, metric, paretoCompany]);

  // Cantidades verificables: lo ejecutado en campo (enviado + aprobado) separado de lo aprobado por el residente
  const quantities = useMemo(() => {
    if (!data) return { rows: [], approvedPct: null as number | null };
    const rows = data.activities.map((a) => {
      const es = data.entries.filter((e) => e.activityId === a.id && e.workDate <= cutoff);
      const reported = es.reduce((t, e) => t + e.quantity, 0);
      const approved = es.filter((e) => e.status === "approved").reduce((t, e) => t + e.quantity, 0);
      return { a, planned: plannedQtyAt(a, cutoff, cal), reported, approved, review: reported - approved, balance: Math.max(0, a.contractQty - approved) };
    });
    // Avance aprobado ponderado igual que la curva S
    const { acts, w } = weighting(data.activities);
    const approvedPct = acts.length
      ? acts.reduce((t, a) => t + w(a) * Math.min(1, (rows.find((r) => r.a.id === a.id)?.approved ?? 0) / a.contractQty), 0)
      : null;
    return { rows, approvedPct };
  }, [data, cutoff, cal]);

  // Avance por empresa: mismo ponderado de la curva S, restringido a las actividades de cada una
  const byCompany = useMemo(() => {
    if (!data || !data.companies.length || !data.activities.some((a) => a.companyId)) return [];
    const { w } = weighting(data.activities);
    const from = addDays(cutoff, -6);
    const groups = [...data.companies.map((c) => ({ key: c.id, name: c.name, kind: c.kind as string | null })), { key: "", name: "Sin empresa asignada", kind: null }];
    return groups
      .map((g) => {
        const acts = data.activities.filter((a) => (a.companyId ?? "") === g.key);
        const sts = statuses.filter((st) => acts.some((a) => a.id === st.id));
        const tw = acts.reduce((t, a) => t + w(a), 0);
        const avg = (k: "actualPct" | "plannedPct") => (tw ? sts.reduce((t, st) => t + w(acts.find((a) => a.id === st.id)!) * st[k], 0) / tw : null);
        const lost = data.losses.filter((l) => l.date >= from && l.date <= cutoff && acts.some((a) => a.id === l.activityId)).reduce((t, l) => t + l.lostHours, 0);
        return { ...g, count: acts.length, actual: avg("actualPct"), planned: avg("plannedPct"), late: sts.filter((st) => st.light === "red").length, lost };
      })
      .filter((g) => g.count > 0);
  }, [data, statuses, cutoff]);

  const pending = useMemo(() => {
    if (!data) return [];
    return data.findings
      .filter((f) => f.status !== "closed")
      .map((f) => ({ ...f, overdue: f.dueDate != null && f.dueDate < cutoff, ageDays: diffDays(f.createdAt.slice(0, 10), cutoff) }))
      .sort((a, b) => SEVERITY_RANK[a.severity]! - SEVERITY_RANK[b.severity]! || Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  }, [data, cutoff]);

  const lostWeek = useMemo(() => {
    if (!data) return { hours: 0, main: null as string | null };
    const from = addDays(cutoff, -6);
    const recs = data.losses.filter((l) => l.date >= from && l.date <= cutoff);
    const top = lossPareto(recs, "lost_hours")[0];
    return { hours: recs.reduce((s, l) => s + l.lostHours, 0), main: top ? (LOSS_LABEL[top.key] ?? top.key) : null };
  }, [data, cutoff]);

  // Reproducción del avance en el plano: días con registros hasta el corte
  const replayDates = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.elementLinks.map((l) => l.date).concat(data.areas.map((a) => a.date)));
    return [...set].filter((d) => d <= cutoff).sort();
  }, [data, cutoff]);
  const shownDate = mapDate ?? cutoff;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) return;
    let i = 0;
    timer.current = setInterval(() => {
      i++;
      if (i >= replayDates.length) {
        setPlaying(false);
        setMapDate(null);
        return;
      }
      setMapDate(replayDates[i]!);
    }, 600);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, replayDates]);
  const onCounts = useCallback((c: Record<ZoneStatus, number>) => setZoneCounts(c), []);

  const contractEnd = data?.project.contractEnd ?? null;
  const finishDelay = curve?.projectedFinish && contractEnd ? diffDays(contractEnd, curve.projectedFinish) : null;
  const spiTone = curve?.spi == null ? undefined : curve.spi >= 0.95 ? "good" : curve.spi >= 0.85 ? "warn" : "bad";
  const critical = pending.filter((f) => f.severity === "critical").length;
  // Sin costos (enlace compartido) no se ofrece el Pareto por costo
  const hasCosts = data?.losses.some((l) => l.idleCostPerHour != null) ?? false;
  const metrics = PARETO_METRICS.filter((m) => m.value !== "lost_cost" || hasCosts);
  const metricDef = metrics.find((m) => m.value === metric) ?? metrics[0]!;
  const fronts = [...new Set(statuses.map((s) => s.front))];

  const withLinks = actions != null;
  // Pestaña por zona: con el nombre de las zonas de la obra (Subcampos, Tramos, Frentes…)
  const zonesTab = data ? plural(zoneLabelOf(data)) : "Zonas";
  const tabs = DASH_TABS.filter((t) => (showFindings || (t.key !== "calidad" && t.key !== "restricciones")) && (withLinks || t.key !== "reportes")).map((t) =>
    t.key === "subcampos" ? { ...t, label: zonesTab } : t,
  );
  const impeditive = pending.filter((f) => f.impeditive);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <div className="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">Dashboard de obra</div>
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">{data?.project.name ?? "Cargando…"}</h1>
          <p className="flex items-center gap-1 text-sm text-zinc-500">
            <Icon name="pin" size={15} />
            {[data?.project.locationName, contractEnd ? `Fecha contractual ${longDate(contractEnd)}` : "Sin fecha contractual"].filter(Boolean).join(" · ")}
          </p>
          {note ? <p className="text-sm text-zinc-500">{note}</p> : null}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Icon name="calendar" size={18} className="text-zinc-500" />
          <span className="sr-only">Fecha de corte</span>
          <input
            type="date"
            className="bg-transparent text-[15px] font-semibold outline-none"
            value={cutoff}
            max={localToday()}
            onChange={(e) => e.target.value && setCutoff(e.target.value)}
          />
        </label>
        {actions?.(cutoff)}
      </div>

      <div role="tablist" aria-label="Vistas del dashboard" className="-mx-1 flex gap-1 overflow-x-auto border-b border-zinc-200 px-1 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "-mb-px shrink-0 border-b-[3px] px-3 py-2.5 text-[15px] font-semibold whitespace-nowrap",
              tab === t.key ? "border-blue-600 text-blue-700 dark:text-blue-400" : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {top}
      {error ? <Card className="text-red-700">No se pudo cargar el dashboard: {error}</Card> : null}
      {!data || !curve ? (
        !error ? <p className="text-zinc-500">Cargando datos de la obra…</p> : null
      ) : tab === "resumen" ? (
        <Overview
          data={data}
          curve={curve}
          cutoff={cutoff}
          statuses={statuses}
          quantities={quantities}
          byCompany={byCompany}
          pending={pending}
          finishDelay={finishDelay}
          showFindings={showFindings}
          withLinks={withLinks}
          goTo={setTab}
          baseline={baselineCurve}
        />
      ) : tab === "semanal" ? (
        <WeeklyView data={data} cutoff={cutoff} />
      ) : tab === "subcampos" ? (
        <SubfieldsView data={data} cutoff={cutoff} statuses={statuses} />
      ) : tab === "avance" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Avance ejecutado"
              value={pct(curve.actualToday)}
              sub={`Aprobado ${quantities.approvedPct == null ? "—" : pct(quantities.approvedPct)} · programado ${pct(curve.plannedToday)}`}
            />
            <Kpi label="Desempeño (SPI)" value={pct(curve.spi, 0)} sub="real ÷ programado" tone={spiTone} />
            <Kpi
              label="Terminación proyectada"
              value={curve.projectedFinish ?? "Sin fecha"}
              sub={
                (finishDelay == null
                  ? "ninguna actividad con saldo avanza"
                  : finishDelay > 0
                    ? `${finishDelay} días después de la contractual`
                    : `${-finishDelay} días antes de la contractual`) +
                (curve.stalled.length
                  ? ` · sin ritmo: ${curve.stalled.map((id) => data.activities.find((a) => a.id === id)?.code).join(", ")}`
                  : "")
              }
              tone={finishDelay == null || finishDelay > 0 || curve.stalled.length ? "bad" : "good"}
            />
            <Kpi label="Actividades atrasadas" value={`${lightCounts.red}`} sub={`${lightCounts.amber} en riesgo · ${lightCounts.green} al día`} tone={lightCounts.red ? "bad" : "good"} />
            {showFindings ? (
              <Kpi label="Hallazgos abiertos" value={`${pending.length}`} sub={`${critical} crítico(s) · ${pending.filter((p) => p.overdue).length} vencido(s)`} tone={critical ? "bad" : pending.length ? "warn" : "good"} />
            ) : null}
            <Kpi label="Horas perdidas (7 días)" value={`${n1(lostWeek.hours)} h`} sub={lostWeek.main ? `Principal: ${lostWeek.main}` : "Sin pérdidas"} />
          </div>

          <Card>
            <h2 className="text-lg font-bold">Curva S</h2>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              {data.activities.some((a) => a.weight != null)
                ? "Avance global ponderado con los pesos del contrato."
                : "Avance global ponderado por igual entre actividades (sin pesos definidos)."}{" "}
              La proyección sigue el ritmo de los últimos 14 días de cada actividad.
              {curve.excluded.length
                ? ` Sin fechas programadas (fuera de la curva): ${curve.excluded.map((id) => data.activities.find((a) => a.id === id)?.code).join(", ")}.`
                : ""}
            </p>
            <SCurveChart points={curve.points} today={cutoff} contractEnd={contractEnd} baseline={baselineCurve} />
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-lg font-bold">Semáforo por actividad</h2>
              {LIGHT_ORDER.filter((l) => lightCounts[l]).map((l) => (
                <span key={l} className="inline-flex items-center gap-1 text-sm">
                  <LightBadge light={l} /> <b className="tabular-nums">{lightCounts[l]}</b>
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3">Actividad</th>
                    <th className="pr-3">Estado</th>
                    <th className="pr-3">Real vs. programado</th>
                    <th className="pr-3 text-right">Ritmo / necesario</th>
                    <th className="pr-3">Fin planeado → proyectado</th>
                    <th>Por qué</th>
                  </tr>
                </thead>
                {fronts.map((front) => (
                  <tbody key={front}>
                    <tr>
                      <td colSpan={6} className="pt-3 pb-1 text-sm font-bold text-zinc-500">
                        {front}
                      </td>
                    </tr>
                    {statuses
                      .filter((s) => s.front === front)
                      .sort((a, b) => LIGHT_ORDER.indexOf(a.light) - LIGHT_ORDER.indexOf(b.light))
                      .map((s) => (
                        <StatusRow key={s.id} s={s} />
                      ))}
                  </tbody>
                ))}
              </table>
            </div>
          </Card>

          <Card>
            <Card>
              <h2 className="mb-2 text-lg font-bold">Pareto de causas</h2>
              {/* Filtros en una sola fila (en el celular, uno bajo otro) */}
              <div className={cx("mb-3 grid gap-2 sm:grid-cols-3", paretoSource === "losses" && data.companies.length > 0 && "sm:grid-cols-2 2xl:grid-cols-4")}>
                <Select value={paretoSource} onChange={(e) => setParetoSource(e.target.value as "losses" | "findings")} aria-label="Fuente">
                  <option value="losses">Pérdidas de tiempo</option>
                  {showFindings ? <option value="findings">Hallazgos por tipo</option> : null}
                </Select>
                {paretoSource === "losses" ? (
                  <Select value={metricDef.value} onChange={(e) => setMetric(e.target.value as ParetoMetric)} aria-label="Métrica">
                    {metrics.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Select value={period} onChange={(e) => setPeriod(e.target.value as "7" | "30" | "all")} aria-label="Periodo">
                  <option value="7">Últimos 7 días</option>
                  <option value="30">Últimos 30 días</option>
                  <option value="all">Todo el proyecto</option>
                </Select>
                {paretoSource === "losses" && data.companies.length ? (
                  <Select value={paretoCompany} onChange={(e) => setParetoCompany(e.target.value)} aria-label="Empresa">
                    <option value="">Todas las empresas</option>
                    {data.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
              <ParetoChart
                rows={paretoRows}
                label={paretoSource === "findings" ? "Hallazgos" : metricDef.label}
                format={paretoSource === "findings" ? (v) => n1(v) : metricDef.format}
              />
              {paretoRows.length ? (
                <>
                  <table className="mt-3 w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="text-left">Causa</th>
                        <th className="text-right">{paretoSource === "findings" ? "Hallazgos" : metricDef.label}</th>
                        <th className="text-right">%</th>
                        <th className="text-right">Acumulado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paretoRows.map((r) => (
                        <tr key={r.key} className={cx("border-t border-zinc-100 dark:border-zinc-800", r.vital && "font-semibold")}>
                          <td className="py-1">{r.name}</td>
                          <td className="text-right tabular-nums">{paretoSource === "findings" ? n1(r.value) : metricDef.format(r.value)}</td>
                          <td className="text-right tabular-nums">{pct(r.pct)}</td>
                          <td className="text-right tabular-nums">{pct(r.cumulativePct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <b>{paretoRows.filter((r) => r.vital).map((r) => r.name).join(", ")}</b> explican el 80 %: atacar primero estas causas.
                    {paretoSource === "losses" ? " Clima, permisos y diseño/cliente suman días reclamables en el simulador." : ""}
                  </p>
                </>
              ) : null}
            </Card>
          </Card>

          {!data.elements.length && !data.areas.length && !data.plan ? (
            <Card>
              <h2 className="text-lg font-bold">Plano de avance</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Aún no hay plano ni elementos georreferenciados del proyecto. Cuando se carguen, aquí se verá el avance coloreado por estado y se podrá reproducir día a
                día.
              </p>
            </Card>
          ) : (
          <Card>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="mr-auto">
                <h2 className="text-lg font-bold">Plano de avance</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Elementos marcados desde campo y áreas trabajadas, al {shownDate}. Toca un elemento para ver su detalle.</p>
              </div>
              <Field label="Actividad">
                <Select value={mapActivity} onChange={(e) => setMapActivity(e.target.value)}>
                  <option value="">Todas</option>
                  {data.activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary" onClick={() => {
                  setMapDate(playing ? null : (replayDates[0] ?? null));
                  setPlaying(!playing);
                }} disabled={!replayDates.length}>
                {playing ? "Detener" : "▶ Reproducir avance"}
              </Button>
            </div>
            {replayDates.length ? (
              <div className="mb-3 flex items-center gap-3">
                <input
                  type="range"
                  className="flex-1 accent-blue-700"
                  min={0}
                  max={replayDates.length}
                  value={mapDate ? Math.max(0, replayDates.indexOf(mapDate)) : replayDates.length}
                  onChange={(e) => {
                    setPlaying(false);
                    const i = Number(e.target.value);
                    setMapDate(i >= replayDates.length ? null : replayDates[i]!);
                  }}
                  aria-label="Fecha del plano"
                />
                <span className="w-28 text-right font-semibold tabular-nums">{shownDate}</span>
              </div>
            ) : null}
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {(["not_started", "in_progress", "done"] as ZoneStatus[]).map((z) => (
                <span key={z} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm border border-zinc-900/40" style={{ background: { not_started: "#9CA3AF", in_progress: "#F59E0B", done: "#16A34A" }[z] }} />
                  {ZONE_LABEL[z]} {zoneCounts ? <b className="tabular-nums">{zoneCounts[z]}</b> : null}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-zinc-900 bg-amber-400/30" /> Área trabajada
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-red-600" /> Hallazgo abierto
              </span>
            </div>
            <SiteMap data={data} until={shownDate} activityId={mapActivity || null} onCounts={onCounts} />
          </Card>
          )}
        </>
      ) : tab === "cantidades" ? (
          <Card>
            <h2 className="text-lg font-bold">Cantidades por actividad</h2>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              Ejecutada = lo reportado en campo (enviado y aprobado). Aprobada = lo verificado por el residente. Saldo = contratada menos aprobada, al {cutoff}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3">Actividad</th>
                    <th className="pr-3">Unidad</th>
                    <th className="pr-3 text-right">Contratada</th>
                    <th className="pr-3 text-right">Programada</th>
                    <th className="pr-3 text-right">Ejecutada</th>
                    <th className="pr-3 text-right">Aprobada</th>
                    <th className="pr-3 text-right">Por aprobar</th>
                    <th className="pr-3 text-right">Saldo</th>
                    <th className="text-right">% aprobado</th>
                  </tr>
                </thead>
                <tbody>
                  {quantities.rows.map((r) => (
                    <tr key={r.a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-3">
                        <b>{r.a.code}</b> · {r.a.name}
                      </td>
                      <td className="pr-3">{r.a.unit}</td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.a.contractQty)}</td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.planned)}</td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.reported)}</td>
                      <td className="pr-3 text-right font-semibold tabular-nums">{n1(r.approved)}</td>
                      <td className={cx("pr-3 text-right tabular-nums", r.review > 0 && "font-semibold text-amber-700 dark:text-amber-400")}>{n1(r.review)}</td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.balance)}</td>
                      <td className="text-right tabular-nums">{r.a.contractQty > 0 ? pct(r.approved / r.a.contractQty) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
      ) : tab === "contratistas" ? (
        <>
          {byCompany.length ? (
            <Card>
              <h2 className="text-lg font-bold">Avance por empresa</h2>
              <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Contratista y subcontratistas, según la empresa responsable de cada actividad (se asigna en Ajustes → Proyecto).</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      <th className="py-2 pr-3">Empresa</th>
                      <th className="pr-3 text-right">Actividades</th>
                      <th className="pr-3 text-right">Real</th>
                      <th className="pr-3 text-right">Programado</th>
                      <th className="pr-3 text-right">Desviación</th>
                      <th className="pr-3 text-right">Atrasadas</th>
                      <th className="text-right">Horas perdidas (7 días)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCompany.map((g) => {
                      const gap = g.actual != null && g.planned != null ? (g.actual - g.planned) * 100 : null;
                      return (
                        <tr key={g.key || "none"} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-2 pr-3">
                            {g.kind ? <Badge tone={g.kind === "contratista" ? "blue" : "neutral"}>{g.kind === "contratista" ? "Contratista" : "Subcontratista"}</Badge> : null}{" "}
                            <span className={cx("font-semibold", !g.kind && "font-normal text-zinc-500")}>{g.name}</span>
                          </td>
                          <td className="pr-3 text-right tabular-nums">{g.count}</td>
                          <td className="pr-3 text-right tabular-nums">{g.actual == null ? "—" : pct(g.actual)}</td>
                          <td className="pr-3 text-right tabular-nums">{g.planned == null ? "—" : pct(g.planned)}</td>
                          <td className={cx("pr-3 text-right tabular-nums", gap != null && gap < -0.5 && "font-semibold text-red-700 dark:text-red-400")}>
                            {gap == null ? "—" : `${gap > 0 ? "+" : ""}${n1(gap)} pts`}
                          </td>
                          <td className={cx("pr-3 text-right tabular-nums", g.late > 0 && "font-semibold text-red-700 dark:text-red-400")}>{g.late}</td>
                          <td className="text-right tabular-nums">{n1(g.lost)} h</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          {!byCompany.length ? (
            <Card>
              <h2 className="text-lg font-bold">Avance por empresa</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Ninguna actividad tiene empresa asignada todavía: se asigna en Ajustes → Proyecto.</p>
            </Card>
          ) : null}
        </>
      ) : tab === "calidad" ? (
        <>
            {showFindings ? (
            <Card>
              <h2 className="mb-2 text-lg font-bold">Pendientes ({pending.length})</h2>
              {pending.length === 0 ? (
                <p className="text-zinc-500">No hay hallazgos abiertos.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {pending.slice(0, 10).map((f) => (
                    <li key={f.id} className="flex flex-wrap items-start gap-2 py-2">
                      <Badge tone={f.severity === "critical" || f.severity === "high" ? "red" : f.severity === "medium" ? "amber" : "neutral"}>
                        {SEVERITY_LABEL[f.severity]}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{f.description}</div>
                        <div className="text-sm text-zinc-500">
                          {FINDING_TYPE_LABEL[f.type]} · {FINDING_STATUS_LABEL[f.status]} · hace {f.ageDays} día(s)
                          {f.dueDate ? (
                            <span className={cx(f.overdue && "font-bold text-red-700 dark:text-red-400")}> · límite {f.dueDate}{f.overdue ? " (vencido)" : ""}</span>
                          ) : (
                            " · sin fecha límite"
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            ) : null}
        </>
      ) : tab === "restricciones" ? (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Restricciones impeditivas ({impeditive.length})</h2>
          {impeditive.length === 0 && !curve.stalled.length ? <p className="text-zinc-500">Nada detiene la obra en este momento.</p> : null}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {impeditive.map((f) => (
              <li key={f.id} className="py-2">
                <div className="font-medium">{f.description}</div>
                <div className="text-sm text-zinc-500">
                  {FINDING_STATUS_LABEL[f.status]} · hace {f.ageDays} día(s){f.dueDate ? ` · límite ${f.dueDate}` : ""}
                </div>
              </li>
            ))}
            {curve.stalled.map((id) => {
              const a = data.activities.find((x) => x.id === id);
              return a ? (
                <li key={id} className="py-2">
                  <div className="font-medium">
                    Sin ritmo: {a.code} · {a.name}
                  </div>
                  <div className="text-sm text-zinc-500">Sin avance en los últimos 14 días: con ella la obra no termina al ritmo actual.</div>
                </li>
              ) : null;
            })}
          </ul>
          {withLinks ? (
            <Link href="/control" className="mt-3 inline-block font-semibold text-blue-700 hover:underline dark:text-blue-400">
              Ver ensayos y restricciones →
            </Link>
          ) : null}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { href: `/informe?p=${data.project.id}&d=${cutoff}`, title: "Informe diario (PDF)", text: "Parte del día de corte para imprimir o enviar." },
            { href: "/semanal", title: "Informe semanal", text: "Seguimiento semanal de avance, personal y equipos." },
            { href: "/centro", title: "Centro de control", text: "Cantidades, correcciones y comparación de contratistas." },
          ].map((r) => (
            <Link key={r.href} href={r.href} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-blue-400 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="font-bold text-blue-700 dark:text-blue-400">{r.title} →</div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{r.text}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusRow({ s }: { s: ActivityStatus & { plannedFinish: string | null } }) {
  return (
    <tr className="border-b border-zinc-100 align-top dark:border-zinc-800">
      <td className="py-2 pr-3">
        <b>{s.code}</b> · {s.name}
      </td>
      <td className="py-2 pr-3">
        <LightBadge light={s.light} />
      </td>
      <td className="py-2 pr-3">
        <div className="relative h-3 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min(100, s.actualPct * 100)}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-[var(--viz-text)]" style={{ left: `${Math.min(100, s.plannedPct * 100)}%` }} />
        </div>
        <div className="mt-0.5 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
          {pct(s.actualPct, 0)} de {pct(s.plannedPct, 0)}
          {s.gapPts < -0.5 ? <span className="text-red-700 dark:text-red-400"> ({n1(s.gapPts)} pts)</span> : null}
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {n1(s.dailyRate)}
        {s.requiredRate != null ? <> / {Number.isFinite(s.requiredRate) ? n1(s.requiredRate) : "∞"}</> : null}
        <div className="text-sm text-zinc-500">{s.unit}/día</div>
      </td>
      <td className="py-2 pr-3 tabular-nums">
        {s.light === "done" || !s.plannedFinish ? (
          "—"
        ) : (
          <>
            {s.plannedFinish} → <b className={cx((s.delayDays ?? 0) > 0 && "text-red-700 dark:text-red-400")}>{s.projectedFinish ?? "sin fecha"}</b>
            {s.delayDays != null && s.delayDays !== 0 ? (
              <div className="text-sm text-zinc-500">{s.delayDays > 0 ? `+${s.delayDays} días` : `${-s.delayDays} días antes`}</div>
            ) : null}
          </>
        )}
      </td>
      <td className="py-2 text-sm text-zinc-700 dark:text-zinc-300">{s.reason}</td>
    </tr>
  );
}
