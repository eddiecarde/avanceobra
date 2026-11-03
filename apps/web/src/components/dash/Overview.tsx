"use client";

import { weighting, type ActivityStatus, type Light, type SCurveResult, type ZoneStatus } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { SCurveChart } from "@/components/dash/Charts";
import { SiteMap, ZONE_LABEL } from "@/components/dash/SiteMap";
import { Icon, type IconName } from "@/components/icons";
import { Badge, cx } from "@/components/ui";
import { FINDING_STATUS_LABEL, FINDING_TYPE_LABEL, pct, type DashData, type DashFinding } from "@/lib/dashboard";
import { supabase } from "@/lib/supabase";

export type Status = ActivityStatus & { front: string; plannedFinish: string | null };
export type Pending = DashFinding & { overdue: boolean; ageDays: number };
export interface QtyRow {
  a: DashData["activities"][number];
  planned: number;
  reported: number;
  approved: number;
  review: number;
  balance: number;
}
export interface CompanyRow {
  key: string;
  name: string;
  kind: string | null;
  count: number;
  actual: number | null;
  planned: number | null;
  late: number;
  lost: number;
}
export type DashTab = "resumen" | "avance" | "semanal" | "subcampos" | "cantidades" | "contratistas" | "calidad" | "restricciones" | "reportes";
export type BaselineCurve = { name: string; points: { date: string; value: number }[] } | null;

const n0 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
/** "2026-07-30" → "30 jul 2026". */
export const longDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "").replace(/ de /g, " ") : "Sin fecha";

// Colores de estado (reservados: no se usan para series)
const LIGHT_BAR: Record<Light, string> = {
  green: "var(--viz-good)",
  done: "var(--viz-good)",
  amber: "#eda100",
  red: "var(--viz-critical)",
  not_started: "#a1a1aa",
  no_plan: "#a1a1aa",
};
// Categóricos en orden fijo; "Otras" en gris
const CAT = ["var(--viz-1)", "var(--viz-3)", "var(--viz-4)", "var(--viz-2)", "var(--viz-5)"];
const OTHER = "#a1a1aa";
const CATEGORY_LABEL: Record<string, string> = { no_conformidad: "No conformidad", punch: "Punch list", observacion: "Observación" };

/** Tarjeta del panel: blanca, borde suave y sombra ligera. */
export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900", className)}>
      {title ? (
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto text-base font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function IconTile({ name, tone = "blue" }: { name: IconName; tone?: "blue" | "red" }) {
  return (
    <span
      className={cx(
        "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
        tone === "blue" ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400",
      )}
    >
      <Icon name={name} size={24} />
    </span>
  );
}

function Ring({ value }: { value: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="h-[88px] w-[88px] shrink-0 -rotate-90" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--viz-grid)" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--viz-1)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${Math.min(1, value) * c} ${c}`} />
      <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-zinc-900 text-[19px] font-extrabold dark:fill-zinc-100">
        {pct(value, 0)}
      </text>
    </svg>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full min-w-12 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}

interface OverviewProps {
  data: DashData;
  curve: SCurveResult;
  cutoff: string;
  statuses: Status[];
  quantities: { rows: QtyRow[]; approvedPct: number | null };
  byCompany: CompanyRow[];
  pending: Pending[];
  finishDelay: number | null;
  showFindings: boolean;
  /** Con sesión: enlaces a otras páginas (no en el enlace compartido). */
  withLinks: boolean;
  goTo: (t: DashTab) => void;
  baseline?: BaselineCurve;
}

/** Pestaña "Resumen": indicadores, curva S, avance por actividad, alertas, cantidades, faltantes, resumen ejecutivo, plano y punch list. */
export function Overview({ data, curve, cutoff, statuses, quantities, byCompany, pending, finishDelay, showFindings, withLinks, goTo, baseline }: OverviewProps) {
  const contractEnd = data.project.contractEnd;
  const impeditive = pending.filter((f) => f.impeditive);
  const critical = pending.filter((f) => f.severity === "critical");
  const companyName = (id: string | null) => data.companies.find((c) => c.id === id)?.name ?? null;

  // Cantidades totales: en unidades si todas las actividades usan la misma; si no, en % ponderado
  const units = [...new Set(data.activities.map((a) => a.unit))];
  const totReported = quantities.rows.reduce((t, r) => t + r.reported, 0);
  const totApproved = quantities.rows.reduce((t, r) => t + r.approved, 0);
  const totContract = quantities.rows.reduce((t, r) => t + r.a.contractQty, 0);

  const grouped = data.activities.some((a) => a.workGroup);

  // Cantidades del resumen: por actividad o, en una planta por grupos, por grupo de trabajo
  const qtyRows = useMemo(() => {
    const lightOf = new Map(statuses.map((s) => [s.id, s.light]));
    if (!grouped)
      return quantities.rows.map((r) => ({
        key: r.a.id,
        name: r.a.name,
        title: r.a.code,
        unit: r.a.unit as string | null,
        planned: r.planned,
        reported: r.reported,
        approved: r.approved,
        balance: r.balance,
        share: r.a.contractQty ? r.approved / r.a.contractQty : 0,
        light: lightOf.get(r.a.id) ?? ("no_plan" as Light),
      }));
    const groups = [...new Set(quantities.rows.map((r) => r.a.workGroup ?? "Sin grupo"))];
    return groups.map((g) => {
      const rs = quantities.rows.filter((r) => (r.a.workGroup ?? "Sin grupo") === g);
      const units = [...new Set(rs.map((r) => r.a.unit.trim().toLowerCase()))];
      const W = rs.reduce((t, r) => t + (r.a.weight ?? 1), 0) || 1;
      const frac = (f: (r: QtyRow) => number) => rs.reduce((t, r) => t + ((r.a.weight ?? 1) / W) * (r.a.contractQty ? Math.min(1, f(r) / r.a.contractQty) : 0), 0);
      const share = frac((r) => r.approved);
      const gap = share - frac((r) => r.planned);
      return {
        key: g,
        name: g,
        title: `${rs.length} actividad(es)`,
        unit: units.length === 1 ? rs[0]!.a.unit : null,
        planned: rs.reduce((t, r) => t + r.planned, 0),
        reported: rs.reduce((t, r) => t + r.reported, 0),
        approved: rs.reduce((t, r) => t + r.approved, 0),
        balance: rs.reduce((t, r) => t + r.balance, 0),
        share,
        light: (share >= 0.999 ? "done" : gap >= -0.02 ? "green" : gap >= -0.1 ? "amber" : "red") as Light,
      };
    });
  }, [grouped, quantities.rows, statuses]);

  // Avance por actividad: el tamaño de cada parte es su peso en el proyecto
  // Con muchos grupos se elige cómo verlos: lista completa o gráfico (los 5 de más peso y el resto)
  const [groupView, setGroupView] = useState<"lista" | "grafico">("lista");
  // Dona con los 5 de más peso; todos los grupos aparte (con muchos se muestran en lista)
  const { donut, allGroups } = useMemo(() => {
    const { acts, w } = weighting(data.activities);
    const actualOf = new Map(statuses.map((s) => [s.id, s.actualPct]));
    const leaves = acts.map((a) => ({ id: a.id, name: a.name, group: (a as DashData["activities"][number]).workGroup, weight: w(a), actual: actualOf.get(a.id) ?? 0 }));
    // Planta por grupos de trabajo: una parte por grupo (Hincas, Módulos…), no por subcampo
    const rows = (
      grouped
        ? [...new Set(leaves.map((l) => l.group ?? "Sin grupo"))].map((g) => {
            const ls = leaves.filter((l) => (l.group ?? "Sin grupo") === g);
            const W = ls.reduce((t, l) => t + l.weight, 0);
            return { id: g, name: g, weight: W, actual: W ? ls.reduce((t, l) => t + l.weight * l.actual, 0) / W : 0 };
          })
        : leaves
    ).sort((a, b) => b.weight - a.weight);
    const top = rows.slice(0, 5).map((r, i) => ({ ...r, color: CAT[i]! }));
    const rest = rows.slice(5);
    const restW = rest.reduce((t, r) => t + r.weight, 0);
    if (rest.length) top.push({ id: "otras", name: `${grouped ? "Otros grupos" : "Otras actividades"} (${rest.length})`, weight: restW, actual: rest.reduce((t, r) => t + r.weight * r.actual, 0) / (restW || 1), color: OTHER });
    return { donut: top, allGroups: rows };
  }, [data.activities, statuses, grouped]);

  // Alertas reales: las que generó el sistema (y llegaron por Telegram) en los últimos 14 días
  const [sent, setSent] = useState<AlertRow[] | null>(null);
  useEffect(() => {
    if (!withLinks) return;
    let off = false;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    void supabase
      .from("alerts")
      .select("id, kind, severity, title, body, created_at")
      .eq("project_id", data.project.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data: rows, error }) => {
        if (!off) setSent(error ? [] : ((rows ?? []) as AlertRow[]));
      });
    return () => {
      off = true;
    };
  }, [withLinks, data.project.id]);

  // Sin alertas enviadas (o en el enlace compartido): las que se deducen de los datos al corte
  const derived = useMemo(() => {
    const out: { tone: "bad" | "warn" | "info"; title: string; sub: string; when?: string }[] = [];
    const red = statuses.filter((s) => s.light === "red").sort((a, b) => (b.delayDays ?? 0) - (a.delayDays ?? 0));
    if (grouped) {
      // Una alerta por grupo de trabajo con cuántas actividades atrasa y el peor atraso
      const groupOf = new Map(data.activities.map((a) => [a.id, a.workGroup ?? "Sin grupo"]));
      for (const g of [...new Set(red.map((s) => groupOf.get(s.id)!))]) {
        const list = red.filter((s) => groupOf.get(s.id) === g);
        out.push({ tone: "warn", title: `Retraso en ${g}`, sub: `${list.length} actividad(es) atrasadas${list[0]!.delayDays ? ` · la peor +${list[0]!.delayDays} días` : ""}` });
      }
    } else red.forEach((s) => out.push({ tone: "warn", title: `Retraso en actividad: ${s.name}`, sub: `${s.front}${s.delayDays ? ` · +${s.delayDays} días` : ""}` }));
    if (showFindings) {
      pending.filter((f) => f.impeditive).forEach((f) => out.push({ tone: "bad", title: `Restricción impeditiva: ${f.description}`, sub: FINDING_STATUS_LABEL[f.status] ?? f.status, when: `Hace ${f.ageDays} d` }));
      pending
        .filter((f) => f.overdue && !f.impeditive)
        .forEach((f) => out.push({ tone: "bad", title: `Hallazgo vencido: ${f.description}`, sub: `Límite ${longDate(f.dueDate)}`, when: `Hace ${f.ageDays} d` }));
    }
    const stalledActs = curve.stalled.map((id) => data.activities.find((x) => x.id === id)).filter(Boolean) as DashData["activities"];
    if (grouped)
      for (const g of [...new Set(stalledActs.map((a) => a.workGroup ?? "Sin grupo"))])
        out.push({ tone: "warn", title: `Sin ritmo: ${g}`, sub: `${stalledActs.filter((a) => (a.workGroup ?? "Sin grupo") === g).length} actividad(es) sin avance reciente` });
    else stalledActs.forEach((a) => out.push({ tone: "warn", title: `Sin ritmo: ${a.name}`, sub: "Sin avance en los últimos 14 días" }));
    return out;
  }, [statuses, pending, showFindings, curve.stalled, data.activities, grouped]);
  const real = (sent ?? []).map((a) => ({
    tone: (a.severity === "critical" || a.severity === "high" ? "bad" : a.severity === "medium" ? "warn" : "info") as "bad" | "warn" | "info",
    title: a.title,
    sub: a.body,
    when: timeAgo(a.created_at),
  }));
  const alerts = real.length ? real : derived;

  // Faltantes por contratista o por subcampo
  const [gapBy, setGapBy] = useState<"company" | "subfield">("company");
  const gaps = useMemo(() => {
    const key = (a: DashData["activities"][number]) => (gapBy === "company" ? (a.companyId ?? "") : (a.subfield ?? ""));
    const names =
      gapBy === "company"
        ? [...data.companies.map((c) => ({ key: c.id, name: c.name })), { key: "", name: "Sin empresa asignada" }]
        : [...new Set(data.activities.map((a) => a.subfield).filter(Boolean) as string[])].sort().map((s) => ({ key: s, name: s })).concat({ key: "", name: "Sin subcampo" });
    const { w } = weighting(data.activities);
    return names
      .map((g) => {
        const rows = quantities.rows.filter((r) => key(r.a) === g.key);
        const us = [...new Set(rows.map((r) => r.a.unit))];
        const executed = rows.reduce((t, r) => t + r.reported, 0);
        const missing = rows.reduce((t, r) => t + Math.max(0, r.a.contractQty - r.reported), 0);
        const tw = rows.reduce((t, r) => t + w(r.a), 0);
        const progress = tw ? rows.reduce((t, r) => t + w(r.a) * (statuses.find((s) => s.id === r.a.id)?.actualPct ?? 0), 0) / tw : null;
        return { ...g, count: rows.length, unit: us.length === 1 ? us[0]! : null, executed, missing, progress };
      })
      .filter((g) => g.count > 0);
  }, [gapBy, data.companies, data.activities, quantities.rows, statuses]);

  const companiesAlert = byCompany.filter((g) => g.key && (g.late > 0 || (g.actual != null && g.planned != null && g.actual - g.planned < -0.05)));
  const worst = [...statuses].filter((s) => s.light === "red").sort((a, b) => (b.delayDays ?? 0) - (a.delayDays ?? 0))[0];
  const insight =
    finishDelay == null
      ? "No hay ritmo suficiente para proyectar la terminación: revisa las actividades sin avance."
      : finishDelay <= 0
        ? `El proyecto mantiene una tendencia positiva: al ritmo actual termina ${finishDelay < 0 ? `${-finishDelay} días antes de` : "en"} la fecha contractual${impeditive.length ? ", si se resuelven las restricciones actuales" : ""}.`
        : `Al ritmo actual el proyecto termina ${finishDelay} días después de la fecha contractual.${worst ? ` Prioriza ${worst.name}.` : ""}`;

  // Punch list: lo abierto primero (por fecha límite), luego lo cerrado más reciente
  const punch = useMemo(() => {
    const open = data.findings.filter((f) => f.status !== "closed").sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
    const closed = data.findings.filter((f) => f.status === "closed").sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
    return [...open, ...closed].slice(0, 6);
  }, [data.findings]);

  const [zoneCounts, setZoneCounts] = useState<Record<ZoneStatus, number> | null>(null);
  const hasMap = data.elements.length > 0 || data.areas.length > 0 || data.plan != null;
  const late = statuses.filter((s) => s.light === "red").length;

  return (
    <div className="space-y-4">
      {/* Indicadores */}
      <div className={cx("grid gap-4 sm:grid-cols-2", showFindings ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
        <Panel className="flex items-center gap-3">
          <Ring value={curve.actualToday ?? 0} />
          <div className="min-w-0 flex-1">
            <div className="font-bold">Avance físico</div>
            <div className="text-sm text-zinc-500">Real vs. programado</div>
            <dl className="mt-2 space-y-0.5 text-sm">
              {(
                [
                  ["Real", pct(curve.actualToday)],
                  ["Programado", pct(curve.plannedToday)],
                  ["Aprobado", quantities.approvedPct == null ? "—" : pct(quantities.approvedPct)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="font-bold whitespace-nowrap tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>

        <Panel className="flex gap-4">
          <IconTile name="calendar" />
          <div>
            <div className="font-bold">Fecha proyectada de terminación</div>
            <div className="mt-2 text-xl font-extrabold whitespace-nowrap tabular-nums">{longDate(curve.projectedFinish)}</div>
            <div className="text-sm text-zinc-500">Contractual: {longDate(contractEnd)}</div>
            <div className="mt-2">
              {finishDelay == null ? (
                <Badge tone="red">Sin ritmo para proyectar</Badge>
              ) : finishDelay <= 0 ? (
                <Badge tone="green">✓ A tiempo</Badge>
              ) : (
                <Badge tone="red">■ {finishDelay} días de atraso</Badge>
              )}
            </div>
          </div>
        </Panel>

        <Panel className="flex gap-4">
          <IconTile name="doc" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">Cantidades totales</div>
            <div className="text-sm text-zinc-500">Ejecutadas / Aprobadas</div>
            <div className="mt-2 text-xl font-extrabold whitespace-nowrap tabular-nums">
              {units.length === 1 ? `${n0(totReported)} / ${n0(totApproved)} ${units[0]}` : `${pct(curve.actualToday, 0)} / ${quantities.approvedPct == null ? "—" : pct(quantities.approvedPct, 0)}`}
            </div>
            <div className="text-sm text-zinc-500">
              {units.length === 1 && totContract ? `(${pct(totReported / totContract, 0)} / ${pct(totApproved / totContract, 0)})` : "ponderado por peso"}
            </div>
            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
              <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min(100, (curve.actualToday ?? 0) * 100)}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-3)]" style={{ width: `${Math.min(100, (quantities.approvedPct ?? 0) * 100)}%` }} />
            </div>
          </div>
        </Panel>

        {showFindings ? (
          <>
            <Panel className="flex gap-4">
              <IconTile name="alert" tone="red" />
              <div>
                <div className="font-bold">Hallazgos abiertos</div>
                <div className="mt-3 text-3xl font-extrabold tabular-nums">{pending.length}</div>
                <div className={cx("text-sm", critical.length ? "font-semibold text-red-700 dark:text-red-400" : "text-zinc-500")}>
                  ({critical.length} crítico{critical.length === 1 ? "" : "s"} · {pending.filter((p) => p.overdue).length} vencido(s))
                </div>
              </div>
            </Panel>
            <Panel className="flex gap-4">
              <IconTile name="hardhat" tone="red" />
              <div>
                <div className="font-bold">Restricciones impeditivas</div>
                <div className="mt-3 text-3xl font-extrabold tabular-nums">{impeditive.length}</div>
                <div className={cx("text-sm", impeditive.length ? "font-semibold text-red-700 dark:text-red-400" : "text-zinc-500")}>
                  {impeditive.length ? "(requieren acción inmediata)" : "Nada detiene la obra"}
                </div>
              </div>
            </Panel>
          </>
        ) : (
          <Panel className="flex gap-4">
            <IconTile name="alert" tone="red" />
            <div>
              <div className="font-bold">Actividades atrasadas</div>
              <div className="mt-3 text-3xl font-extrabold tabular-nums">{late}</div>
              <div className="text-sm text-zinc-500">de {statuses.length} actividades</div>
            </div>
          </Panel>
        )}
      </div>

      {/* Curva S · avance por actividad · alertas */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel title="Curva S del proyecto">
          <SCurveChart points={curve.points} today={cutoff} contractEnd={contractEnd} compact baseline={baseline} />
        </Panel>

        <Panel
          title={grouped ? "Avance por grupo de trabajo" : "Avance por actividad"}
          action={
            allGroups.length > 6 ? (
              <div role="group" aria-label="Forma de ver el avance" className="flex rounded-lg border border-zinc-200 p-0.5 text-xs font-semibold dark:border-zinc-700">
                {(
                  [
                    ["lista", "Lista"],
                    ["grafico", "Gráfico"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    aria-pressed={groupView === k}
                    onClick={() => setGroupView(k)}
                    className={cx("rounded-md px-2.5 py-1", groupView === k ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          {allGroups.length > 6 && groupView === "lista" ? (
            <>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tabular-nums">{pct(curve.actualToday, 0)}</span>
                <span className="text-sm text-zinc-500">{`total del proyecto · ${allGroups.length} ${grouped ? "grupos" : "actividades"}`}</span>
              </div>
              <div className="mb-1 flex text-xs text-zinc-500">
                <span className="flex-1">{grouped ? "Grupo" : "Actividad"}</span>
                <span className="w-14 text-right">Peso</span>
                <span className="w-36 text-right">Avance</span>
              </div>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-sm [scrollbar-color:var(--viz-grid)_transparent] [scrollbar-width:thin]">
                {allGroups.map((g) => (
                  <li key={g.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate" title={g.name}>
                      {g.name}
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs text-zinc-500 tabular-nums">{pct(g.weight, 1)}</span>
                    <span className="w-24 shrink-0">
                      <Bar value={g.actual} color={g.actual >= 0.999 ? "var(--viz-good)" : "var(--viz-1)"} />
                    </span>
                    <b className="w-11 shrink-0 text-right tabular-nums">{pct(g.actual, 0)}</b>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">Ordenados por peso en el proyecto.</p>
            </>
          ) : allGroups.length > 6 ? (
            <AllGroupsDonut groups={allGroups} total={curve.actualToday ?? 0} />
          ) : (
          <>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative h-52 w-52 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={donut} dataKey="weight" nameKey="name" innerRadius="62%" outerRadius="98%" paddingAngle={1.5} stroke="var(--viz-surface)" strokeWidth={2} isAnimationActive={false}>
                    {donut.map((d) => (
                      <Cell key={d.id} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]!.payload as (typeof donut)[number];
                      return (
                        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-bold">{d.name}</div>
                          <div>Avance {pct(d.actual)}</div>
                          <div className="text-zinc-500">Peso {pct(d.weight)}</div>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="text-3xl font-extrabold tabular-nums">{pct(curve.actualToday, 0)}</div>
                  <div className="text-xs text-zinc-500">Total del proyecto</div>
                </div>
              </div>
            </div>
            <ul className="w-full min-w-0 space-y-2.5 text-sm">
              {donut.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: d.color }} />
                  <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
                  <b className="shrink-0 tabular-nums">{pct(d.actual, 0)}</b>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-xs text-zinc-500">El tamaño de cada parte es su peso en el proyecto; el porcentaje, su avance.</p>
          </>
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <span className="relative text-zinc-700 dark:text-zinc-300">
                <Icon name="bell" size={20} />
                {alerts.length ? (
                  <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{alerts.length}</span>
                ) : null}
              </span>
              Alertas y notificaciones
            </span>
          }
          action={
            withLinks ? (
              <Link href="/centro" className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">
                Ver todas
              </Link>
            ) : null
          }
        >
          <p className="-mt-2 mb-1 text-xs text-zinc-500">
            {real.length ? "Enviadas por el sistema en los últimos 14 días (también por Telegram)." : "Calculadas con los datos al corte: no hay alertas enviadas en los últimos 14 días."}
          </p>
          {alerts.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-zinc-500">
              <Icon name="info" className="text-blue-600" /> Sin alertas: todo al día.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {alerts.slice(0, 5).map((a, i) => (
                <li key={i} className="flex gap-3 py-2.5">
                  <Icon
                    name={a.tone === "bad" ? "danger" : a.tone === "warn" ? "alert" : "info"}
                    size={22}
                    className={cx("mt-0.5 shrink-0", a.tone === "bad" ? "text-red-600" : a.tone === "warn" ? "text-amber-500" : "text-blue-600")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" title={a.title}>
                      {a.title}
                    </div>
                    <div className="truncate text-xs text-zinc-500" title={a.sub}>
                      {a.sub}
                    </div>
                  </div>
                  {a.when ? <span className="shrink-0 text-xs text-zinc-400">{a.when}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Cantidades · faltantes · resumen ejecutivo */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel
          title="Cantidades ejecutadas y aprobadas"
          action={
            <button className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => goTo("cantidades")}>
              Ver detalle
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
                <tr>
                  <th className="rounded-l-lg px-2 py-2 font-semibold">Actividad</th>
                  <th className="px-2 font-semibold">Unidad</th>
                  <th className="px-2 text-right font-semibold">Programado</th>
                  <th className="px-2 text-right font-semibold">Ejecutado</th>
                  <th className="px-2 text-right font-semibold">Aprobado</th>
                  <th className="rounded-r-lg px-2 font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {qtyRows.slice(0, 7).map((r) => (
                  <tr key={r.key} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-2" title={r.title}>
                      {r.name}
                    </td>
                    <td className="px-2">{r.unit ?? "varias"}</td>
                    <td className="px-2 text-right tabular-nums">{r.unit ? n1(r.planned) : "—"}</td>
                    <td className="px-2 text-right tabular-nums">{r.unit ? n1(r.reported) : "—"}</td>
                    <td className="px-2 text-right tabular-nums">{r.unit ? n1(r.approved) : "—"}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-2">
                        <span className="w-16">
                          <Bar value={r.share} color={LIGHT_BAR[r.light]} />
                        </span>
                        <span className="tabular-nums">{r.unit ? n1(r.balance) : pct(1 - r.share, 0)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {qtyRows.length > 7 ? (
            <p className="mt-2 text-xs text-zinc-500">{`${qtyRows.length - 7} ${grouped ? "grupo(s)" : "actividad(es)"} más en la pestaña Cantidades.`}</p>
          ) : null}
        </Panel>

        <Panel title="Faltantes por contratista y subcampo">
          <div role="tablist" aria-label="Agrupar faltantes" className="mb-3 flex gap-4 border-b border-zinc-200 text-sm dark:border-zinc-800">
            {(
              [
                ["company", "Por contratista"],
                ["subfield", "Por subcampo"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={gapBy === k}
                onClick={() => setGapBy(k)}
                className={cx("-mb-px border-b-2 px-1 pb-2 font-semibold", gapBy === k ? "border-blue-600 text-blue-700 dark:text-blue-400" : "border-transparent text-zinc-500")}
              >
                {label}
              </button>
            ))}
          </div>
          {gaps.length <= 1 && gaps[0]?.key === "" ? (
            <p className="text-sm text-zinc-500">
              {gapBy === "company" ? "Ninguna actividad tiene empresa asignada todavía" : "Ninguna actividad tiene subcampo todavía"}: se asigna en Ajustes → Proyecto.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
                  <tr>
                    <th className="rounded-l-lg px-2 py-2 font-semibold">{gapBy === "company" ? "Contratista / Subcontratista" : "Subcampo"}</th>
                    <th className="px-2 text-right font-semibold">Ejecutado</th>
                    <th className="px-2 text-right font-semibold">Faltante</th>
                    <th className="rounded-r-lg px-2 font-semibold">% avance</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((g) => (
                    <tr key={g.key || "none"} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className={cx("px-2 py-2", !g.key && "text-zinc-500")}>{g.name}</td>
                      <td className="px-2 text-right whitespace-nowrap tabular-nums">{g.unit ? `${n0(g.executed)} ${g.unit}` : `${g.count} act.`}</td>
                      <td className="px-2 text-right">
                        {g.unit ? <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-semibold whitespace-nowrap tabular-nums text-red-700 dark:bg-red-950 dark:text-red-300">{`${n0(g.missing)} ${g.unit}`}</span> : "—"}
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <span className="w-10 tabular-nums">{g.progress == null ? "—" : pct(g.progress, 0)}</span>
                          <span className="w-16">
                            <Bar value={g.progress ?? 0} color="var(--viz-3)" />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Icon name="list" /> Resumen ejecutivo
            </span>
          }
        >
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            <SummaryRow icon="trend" label="Avance real vs. programado">
              {pct(curve.actualToday, 0)} vs. {pct(curve.plannedToday, 0)}{" "}
              <span className={(curve.actualToday ?? 0) >= (curve.plannedToday ?? 0) ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                {(curve.actualToday ?? 0) >= (curve.plannedToday ?? 0) ? "▲" : "▼"}
              </span>
            </SummaryRow>
            <SummaryRow icon="calendar" label="Fecha proyectada de terminación">
              {longDate(curve.projectedFinish)}
            </SummaryRow>
            {showFindings ? (
              <>
                <SummaryRow icon="clock" label="Hallazgos abiertos" bad={pending.length > 0}>
                  {pending.length}
                </SummaryRow>
                <SummaryRow icon="alert" label="Restricciones impeditivas" bad={impeditive.length > 0}>
                  {impeditive.length}
                </SummaryRow>
              </>
            ) : null}
            <SummaryRow icon="users" label="Contratistas en alerta" bad={companiesAlert.length > 0}>
              {companiesAlert.length}
            </SummaryRow>
          </ul>
          <div className="mt-3 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
            <Icon name="bulb" size={26} className="shrink-0" />
            <p>{insight}</p>
          </div>
        </Panel>
      </div>

      {/* Plano · punch list */}
      <div className={cx("grid gap-4", showFindings && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <Panel
          title="Plano de avance"
          action={
            <button className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => goTo("avance")}>
              Reproducir por días
            </button>
          }
        >
          {hasMap ? (
            <>
              <SiteMap data={data} until={cutoff} activityId={null} onCounts={setZoneCounts} compact />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {(["done", "in_progress", "not_started"] as ZoneStatus[]).map((z) => (
                  <span key={z} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: { not_started: "#9CA3AF", in_progress: "#F59E0B", done: "#16A34A" }[z] }} />
                    {ZONE_LABEL[z]} {zoneCounts ? <b className="tabular-nums">{zoneCounts[z]}</b> : null}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Aún no hay plano ni elementos georreferenciados: se cargan en Ajustes → Planos.</p>
          )}
        </Panel>

        {showFindings ? (
          <Panel
            title="Punch list de calidad"
            action={
              <button className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => goTo("calidad")}>
                Ver todos
              </button>
            }
          >
            {punch.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay hallazgos registrados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
                    <tr>
                      <th className="rounded-l-lg px-2 py-2 font-semibold">Elemento</th>
                      <th className="px-2 font-semibold">Tipo</th>
                      <th className="px-2 font-semibold">Responsable</th>
                      <th className="px-2 font-semibold">Fecha límite</th>
                      <th className="rounded-r-lg px-2 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {punch.map((f) => {
                      const overdue = f.status !== "closed" && f.dueDate != null && f.dueDate < cutoff;
                      return (
                        <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="max-w-56 truncate px-2 py-2" title={f.description}>
                            {f.description}
                          </td>
                          <td className={cx("px-2", f.category === "no_conformidad" && "text-red-700 dark:text-red-400")}>
                            {CATEGORY_LABEL[f.category] && f.category !== "observacion" ? CATEGORY_LABEL[f.category] : (FINDING_TYPE_LABEL[f.type] ?? f.type)}
                          </td>
                          <td className="px-2">{companyName(f.companyId) ?? "—"}</td>
                          <td className={cx("px-2 tabular-nums", overdue && "font-semibold text-red-700 dark:text-red-400")}>{f.dueDate ? longDate(f.dueDate) : "—"}</td>
                          <td className="px-2">
                            <Badge tone={f.status === "closed" ? "green" : f.status === "open" ? "red" : "amber"}>{FINDING_STATUS_LABEL[f.status] ?? f.status}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  created_at: string;
}

/** "Hace 3 h", "Hace 2 d". */
function timeAgo(iso: string) {
  const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "Hace minutos" : h < 24 ? `Hace ${Math.floor(h)} h` : `Hace ${Math.floor(h / 24)} d`;
}

// Escala de avance de un solo tono (azul): más oscuro = más avance; terminado en verde
const PROGRESS_STEPS = ["#c9d3df", "#a6c6f0", "#6fa3e6", "#3c7fd9", "#1f5fb3"];
const progressColor = (p: number) => (p >= 0.999 ? "var(--viz-good)" : PROGRESS_STEPS[Math.min(PROGRESS_STEPS.length - 1, Math.floor(p * PROGRESS_STEPS.length))]!);

/**
 * Dona con todos los grupos: cada parte mide su peso y su color dice cuánto avanzó (con muchos
 * grupos no alcanzan los colores para distinguirlos; la lista de abajo dice cuál es cuál).
 */
function AllGroupsDonut({ groups, total }: { groups: { id: string; name: string; weight: number; actual: number }[]; total: number }) {
  return (
    <div>
      <div className="relative mx-auto h-60 w-60">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={groups} dataKey="weight" nameKey="name" innerRadius="60%" outerRadius="98%" paddingAngle={0.6} stroke="var(--viz-surface)" strokeWidth={1.5} isAnimationActive={false}>
              {groups.map((g) => (
                <Cell key={g.id} fill={progressColor(g.actual)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
                if (!active || !payload?.length) return null;
                const g = payload[0]!.payload as (typeof groups)[number];
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="font-bold">{g.name}</div>
                    <div>Avance {pct(g.actual)}</div>
                    <div className="text-zinc-500">Peso {pct(g.weight)}</div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-3xl font-extrabold tabular-nums">{pct(total, 0)}</div>
            <div className="text-xs text-zinc-500">{`${groups.length} grupos`}</div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500" aria-hidden>
        <span>Avance:</span>
        {PROGRESS_STEPS.map((c, i) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm" style={{ background: c }} />
            {`${i * 20}-${(i + 1) * 20} %`}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: "var(--viz-good)" }} />
          Terminado
        </span>
      </div>
      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1 text-sm [scrollbar-color:var(--viz-grid)_transparent] [scrollbar-width:thin]">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: progressColor(g.actual) }} />
            <span className="min-w-0 flex-1 truncate" title={g.name}>
              {g.name}
            </span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{pct(g.weight, 1)}</span>
            <b className="w-11 shrink-0 text-right tabular-nums">{pct(g.actual, 0)}</b>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">El tamaño de cada parte es su peso; el color, su avance. Pasa el mouse por el círculo para ver cada grupo.</p>
    </div>
  );
}

function SummaryRow({ icon, label, bad, children }: { icon: IconName; label: string; bad?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon name={icon} size={18} className={cx("shrink-0", bad ? "text-red-600" : "text-blue-600")} />
      <span className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">{label}</span>
      <b className={cx("whitespace-nowrap tabular-nums", bad && "text-red-700 dark:text-red-400")}>{children}</b>
    </li>
  );
}
