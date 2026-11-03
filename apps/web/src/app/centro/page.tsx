"use client";

import { activityControl, controlSummary, diffDays, penaltyCost, penaltyFromPercent, type ActivityControl, type ControlSummary } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LightBadge } from "@/components/dash/Light";
import { Badge, Card, cx, Field, Input, Select } from "@/components/ui";
import { loadDashboard, localToday, pct, SEVERITY_LABEL, type DashActivity, type DashData } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Constraint {
  id: string;
  activity_id: string | null;
  description: string;
  responsible: string | null;
  need_by: string | null;
}

interface Contract {
  contract_value: number;
  contract_end_date: string;
  penalty_mode: "amount" | "percent";
  penalty_per_day: number;
  penalty_percent_per_day: number;
  penalty_cap_percent: number | null;
}

const CATEGORY_LABEL: Record<string, string> = { observacion: "Hallazgo", no_conformidad: "No conformidad", punch: "Punch" };
const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
const ALL = "";

/** Una de las cuatro preguntas: la respuesta grande arriba y el detalle debajo. */
function Question({ title, answer, tone, children }: { title: string; answer: ReactNode; tone?: "good" | "warn" | "bad"; children: ReactNode }) {
  return (
    <Card>
      <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div
        className={cx(
          "mt-1 text-xl font-extrabold",
          tone === "good" && "text-green-700 dark:text-green-400",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "bad" && "text-red-700 dark:text-red-400",
        )}
      >
        {answer}
      </div>
      <div className="mt-3 text-[15px]">{children}</div>
    </Card>
  );
}

/**
 * Centro de control de producción: responde juntas cuatro preguntas — cuánto debíamos ejecutar y
 * cuánto se ejecutó, cuánto está aprobado, qué impide avanzar y quién lo resuelve, y cuál es la fecha
 * realista y lo que cuesta el atraso — para la obra entera o filtrada por empresa, frente, subcampo,
 * circuito o actividad.
 */
export default function Centro() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const [loaded, setLoaded] = useState<{ projectId: string; data: DashData; constraints: Constraint[]; contract: Contract | null; corrections: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState(localToday());
  const [f, setF] = useState({ company: ALL, front: ALL, subfield: ALL, circuit: ALL, activity: ALL });

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    Promise.all([
      loadDashboard(projectId),
      supabase.from("project_constraints").select("id, activity_id, description, responsible, need_by").eq("project_id", projectId).eq("status", "abierta"),
      supabase.from("contracts").select("contract_value, contract_end_date, penalty_mode, penalty_per_day, penalty_percent_per_day, penalty_cap_percent").eq("project_id", projectId).maybeSingle(),
      supabase.from("entry_corrections").select("id").eq("project_id", projectId).eq("status", "pendiente"),
    ]).then(
      ([data, c, k, cor]) => {
        if (off) return;
        setLoaded({ projectId, data, constraints: (c.data ?? []) as Constraint[], contract: (k.data as Contract | null) ?? null, corrections: cor.data?.length ?? 0 });
      },
      (e: Error) => !off && setError(e.message),
    );
    return () => {
      off = true;
    };
  }, [projectId]);

  const data = loaded?.projectId === projectId ? loaded.data : null;
  const cal = data?.project.calendar;

  // Filtros: cada uno restringe las actividades; la comparación por empresa ignora solo el de empresa
  const matches = (a: DashActivity, ignoreCompany = false) =>
    (ignoreCompany || f.company === ALL || (a.companyId ?? "none") === f.company) &&
    (f.front === ALL || a.frontId === f.front) &&
    (f.subfield === ALL || (a.subfield ?? "") === f.subfield) &&
    (f.circuit === ALL || (a.circuit ?? "") === f.circuit) &&
    (f.activity === ALL || a.id === f.activity);

  const all = useMemo(() => {
    if (!data) return [] as (ActivityControl & { a: DashActivity })[];
    const entries = data.entries.map((e) => ({ activityId: e.activityId, date: e.workDate, quantity: e.quantity, status: e.status }));
    return activityControl(data.activities, entries, cutoff, cal).map((r) => ({ ...r, a: r.activity as DashActivity }));
  }, [data, cutoff, cal]);
  const rows = all.filter((r) => matches(r.a));
  const sum: ControlSummary | null = rows.length ? controlSummary(rows) : null;

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  if (error) return <Card className="text-red-700">No se pudo cargar: {error}</Card>;
  if (!data || !loaded) return <p className="text-zinc-500">Cargando el centro de control…</p>;

  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((x, y) => x.localeCompare(y, "es"));
  const fronts = [...new Map(data.activities.map((a) => [a.frontId, `${a.frontCode} · ${a.frontName}`])).entries()];
  const subfields = uniq(data.activities.map((a) => a.subfield));
  const circuits = uniq(data.activities.map((a) => a.circuit));
  const companyName = (id: string | null) => data.companies.find((c) => c.id === id)?.name ?? "Sin empresa";
  const ids = new Set(rows.map((r) => r.a.id));

  // 1. Programado vs. ejecutado
  const gap = sum && sum.executedPct != null && sum.plannedPct != null ? (sum.executedPct - sum.plannedPct) * 100 : null;
  const behind = rows
    .filter((r) => r.planned > r.reported)
    .sort((x, y) => (y.planned - y.reported) / (y.activity.contractQty || 1) - (x.planned - x.reported) / (x.activity.contractQty || 1))
    .slice(0, 5);

  // 2. Verificado y aprobado
  const submitted = data.entries.filter((e) => e.status === "submitted" && e.workDate <= cutoff && ids.has(e.activityId));
  const oldest = submitted.map((e) => e.workDate).sort()[0];
  const toReview = rows.filter((r) => r.review > 0).sort((x, y) => y.review / (y.activity.contractQty || 1) - x.review / (x.activity.contractQty || 1));

  // 3. Qué impide avanzar y quién lo resuelve
  const blockers = [
    ...loaded.constraints
      .filter((c) => !c.activity_id || ids.has(c.activity_id))
      .map((c) => ({
        key: c.id,
        what: c.description,
        who: c.responsible || "Sin responsable",
        when: c.need_by,
        overdue: !!c.need_by && c.need_by < cutoff,
        kind: "Restricción",
        act: data.activities.find((a) => a.id === c.activity_id)?.code,
      })),
    // Hallazgos que frenan: impeditivos (NC o punch) o de severidad alta o crítica
    ...data.findings
      .filter(
        (x) =>
          x.status !== "closed" &&
          (x.impeditive || x.severity === "critical" || x.severity === "high") &&
          (x.activityId ? ids.has(x.activityId) : !x.frontId || rows.some((r) => r.a.frontId === x.frontId)),
      )
      .map((x) => ({
        key: x.id,
        what: x.description,
        who: x.companyId ? companyName(x.companyId) : "Responsable del hallazgo",
        when: x.dueDate,
        overdue: !!x.dueDate && x.dueDate < cutoff,
        kind: `${CATEGORY_LABEL[x.category] ?? "Hallazgo"}${x.impeditive ? " impeditivo" : ` ${SEVERITY_LABEL[x.severity]?.toLowerCase() ?? ""}`}`,
        act: data.activities.find((a) => a.id === x.activityId)?.code,
      })),
  ].sort((x, y) => Number(y.overdue) - Number(x.overdue) || (x.when ?? "9").localeCompare(y.when ?? "9"));
  const stalled = sum?.stalled.map((id) => rows.find((r) => r.a.id === id)!).filter(Boolean) ?? [];

  // 4. Fecha realista y costo del atraso
  const contractEnd = loaded.contract?.contract_end_date ?? data.project.contractEnd;
  const delay = sum?.projectedFinish && contractEnd ? diffDays(contractEnd, sum.projectedFinish) : null;
  const k = loaded.contract;
  const terms = k
    ? k.penalty_mode === "percent"
      ? { ...penaltyFromPercent(Number(k.contract_value), Number(k.penalty_percent_per_day), k.penalty_cap_percent == null ? undefined : Number(k.penalty_cap_percent)), dailyIndirectCost: 0 }
      : { penaltyPerDay: Number(k.penalty_per_day), penaltyCap: k.penalty_cap_percent == null ? null : Number(k.contract_value) * Number(k.penalty_cap_percent), dailyIndirectCost: 0 }
    : null;
  const exposure = terms && delay != null && delay > 0 ? penaltyCost(delay, terms) : 0;
  const needMore = rows
    .filter((r) => r.status.requiredRate != null && Number.isFinite(r.status.requiredRate) && r.status.requiredRate > r.status.dailyRate && r.status.light !== "done")
    .sort((x, y) => x.status.dailyRate / x.status.requiredRate! - y.status.dailyRate / y.status.requiredRate!)
    .slice(0, 5);

  // Comparación por empresa (con los demás filtros)
  const byCompany = [...data.companies.map((c) => ({ id: c.id, name: c.name, kind: c.kind as string | null })), { id: "none", name: "Sin empresa asignada", kind: null }]
    .map((c) => {
      const rs = all.filter((r) => matches(r.a, true) && (r.a.companyId ?? "none") === c.id);
      return { ...c, rows: rs, s: rs.length ? controlSummary(rs) : null };
    })
    .filter((c) => c.rows.length);

  const sel = (key: keyof typeof f, label: string, options: [string, string][], all = "Todos") => (
    <Field label={label}>
      <Select value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
        <option value={ALL}>{all}</option>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Centro de control</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            {data.project.name} · {rows.length} de {data.activities.length} actividades con estos filtros
          </p>
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
        <Field label="Fecha de corte">
          <Input type="date" value={cutoff} max={localToday()} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
        </Field>
      </div>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {sel("company", "Empresa", [...data.companies.map((c) => [c.id, c.name] as [string, string]), ["none", "Sin empresa"]], "Todas")}
          {sel("front", "Frente", fronts)}
          {sel("subfield", "Subcampo", subfields.map((x) => [x, x]))}
          {sel("circuit", "Circuito", circuits.map((x) => [x, x]))}
          {sel("activity", "Actividad", data.activities.map((a) => [a.id, `${a.code} · ${a.name}`]), "Todas")}
        </div>
        {!subfields.length && !circuits.length ? (
          <p className="mt-2 text-sm text-zinc-500">
            Para filtrar por subcampo o circuito, asígnalos a cada actividad en <Link href="/proyecto" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">Ajustes → Proyecto</Link>.
          </p>
        ) : null}
      </Card>

      {!sum ? (
        <Card className="text-zinc-500">Ninguna actividad cumple estos filtros.</Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Question
              title="1 · ¿Cuánto debíamos ejecutar y cuánto se ejecutó?"
              answer={
                sum.executedPct == null || sum.plannedPct == null
                  ? "Sin programa con fechas"
                  : `${pct(sum.executedPct)} ejecutado de ${pct(sum.plannedPct)} programado`
              }
              tone={gap == null ? undefined : gap >= -2 ? "good" : gap >= -10 ? "warn" : "bad"}
            >
              {gap != null ? <p className="mb-2 text-zinc-600 dark:text-zinc-400">{gap >= 0 ? `Adelantado ${n1(gap)} puntos.` : `Atrasado ${n1(-gap)} puntos frente al programa.`}</p> : null}
              {behind.length ? (
                <ul className="space-y-1">
                  {behind.map((r) => (
                    <li key={r.a.id}>
                      <b>{r.a.code}</b> {r.a.name}: faltan <b>{n1(r.planned - r.reported)}</b> {r.a.unit} para ir al día
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-500">Todas las actividades van al día o adelantadas.</p>
              )}
            </Question>

            <Question
              title="2 · ¿Cuánto está verificado y aprobado?"
              answer={sum.approvedPct == null ? "—" : `${pct(sum.approvedPct)} aprobado`}
              tone={submitted.length ? "warn" : "good"}
            >
              <p className="mb-2 text-zinc-600 dark:text-zinc-400">
                {submitted.length ? `${submitted.length} registro(s) por aprobar, el más antiguo del ${oldest}.` : "No hay registros por aprobar."}{" "}
                {loaded.corrections ? `${loaded.corrections} corrección(es) pendiente(s). ` : ""}
                <Link href="/registros" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                  Ir a Registros →
                </Link>
              </p>
              {toReview.length ? (
                <ul className="space-y-1">
                  {toReview.slice(0, 5).map((r) => (
                    <li key={r.a.id}>
                      <b>{r.a.code}</b> {r.a.name}: {n1(r.review)} {r.a.unit} ejecutados sin aprobar
                    </li>
                  ))}
                </ul>
              ) : null}
            </Question>

            <Question
              title="3 · ¿Qué impide avanzar y quién debe resolverlo?"
              answer={blockers.length || stalled.length ? `${blockers.length} impedimento(s) abiertos · ${stalled.length} actividad(es) paradas` : "Nada bloquea el avance"}
              tone={blockers.some((b) => b.overdue) || stalled.length ? "bad" : blockers.length ? "warn" : "good"}
            >
              {blockers.length ? (
                <ul className="space-y-1.5">
                  {blockers.slice(0, 6).map((b) => (
                    <li key={b.key}>
                      <Badge tone={b.overdue ? "red" : "amber"}>{b.kind}</Badge> {b.what}
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        <b>{b.who}</b>
                        {b.act ? ` · ${b.act}` : ""}
                        {b.when ? ` · para el ${b.when}${b.overdue ? " (vencida)" : ""}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {stalled.length ? (
                <p className="mt-2 text-sm">
                  Sin avance en 14 días pese a estar programadas:{" "}
                  {stalled.map((r) => `${r.a.code} (${companyName(r.a.companyId)})`).join(", ")}.
                </p>
              ) : null}
            </Question>

            <Question
              title="4 · ¿Cuánto cuesta el atraso y cuál es la fecha realista?"
              answer={
                sum.projectedFinish
                  ? `Termina el ${sum.projectedFinish}${delay != null ? (delay > 0 ? `, ${delay} días tarde` : delay < 0 ? `, ${-delay} días antes` : ", a tiempo") : ""}`
                  : "Sin fecha realista: hay actividades sin ritmo"
              }
              tone={!sum.projectedFinish || (delay ?? 0) > 3 ? "bad" : (delay ?? 0) > 0 ? "warn" : "good"}
            >
              <p className="mb-2 text-zinc-600 dark:text-zinc-400">
                {contractEnd ? `Fecha contractual ${contractEnd}. ` : ""}
                {exposure > 0 ? (
                  <>
                    Multa expuesta si sigue así: <b className="text-red-700 dark:text-red-400">{M(exposure)}</b>.{" "}
                  </>
                ) : null}
                {sum.paceRatio != null ? `El ritmo actual es el ${pct(sum.paceRatio, 0)} del necesario. ` : ""}
                <Link href="/simulador" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                  Simular cuánto cuesta acelerar →
                </Link>
              </p>
              {needMore.length ? (
                <ul className="space-y-1">
                  {needMore.map((r) => (
                    <li key={r.a.id}>
                      <b>{r.a.code}</b> {r.a.name}: necesita {n1(r.status.requiredRate!)} {r.a.unit}/día y va a {n1(r.status.dailyRate)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Question>
          </div>

          <Card>
            <h2 className="text-lg font-bold">Contratista y subcontratistas</h2>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Avance ponderado de las actividades de cada empresa, con los filtros de arriba (salvo el de empresa).</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3">Empresa</th>
                    <th className="pr-3 text-right">Actividades</th>
                    <th className="pr-3 text-right">Programado</th>
                    <th className="pr-3 text-right">Ejecutado</th>
                    <th className="pr-3 text-right">Aprobado</th>
                    <th className="pr-3 text-right">Faltante</th>
                    <th className="pr-3 text-right">Ritmo / necesario</th>
                    <th className="pr-3">Fecha prevista</th>
                    <th className="text-right">Atrasadas</th>
                  </tr>
                </thead>
                <tbody>
                  {byCompany.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-3">
                        {c.kind ? <Badge tone={c.kind === "contratista" ? "blue" : "neutral"}>{c.kind === "contratista" ? "Contratista" : "Subcontratista"}</Badge> : null}{" "}
                        <span className={cx("font-semibold", !c.kind && "font-normal text-zinc-500")}>{c.name}</span>
                      </td>
                      <td className="pr-3 text-right tabular-nums">{c.rows.length}</td>
                      <td className="pr-3 text-right tabular-nums">{c.s?.plannedPct == null ? "—" : pct(c.s.plannedPct)}</td>
                      <td className="pr-3 text-right tabular-nums">{c.s?.executedPct == null ? "—" : pct(c.s.executedPct)}</td>
                      <td className="pr-3 text-right font-semibold tabular-nums">{c.s?.approvedPct == null ? "—" : pct(c.s.approvedPct)}</td>
                      <td className="pr-3 text-right tabular-nums">{c.s?.approvedPct == null ? "—" : pct(1 - c.s.approvedPct)}</td>
                      <td className={cx("pr-3 text-right tabular-nums", c.s?.paceRatio != null && c.s.paceRatio < 0.9 && "font-semibold text-red-700 dark:text-red-400")}>
                        {c.s?.paceRatio == null ? "—" : pct(c.s.paceRatio, 0)}
                      </td>
                      <td className="pr-3 tabular-nums">{c.s?.projectedFinish ?? <span className="text-red-700 dark:text-red-400">sin ritmo</span>}</td>
                      <td className={cx("text-right tabular-nums", (c.s?.late ?? 0) > 0 && "font-semibold text-red-700 dark:text-red-400")}>{c.s?.late ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-bold">Detalle por actividad</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3">Actividad</th>
                    <th className="pr-3">Empresa</th>
                    <th className="pr-3">Subcampo / circuito</th>
                    <th className="pr-3 text-right">Contratada</th>
                    <th className="pr-3 text-right">Programada</th>
                    <th className="pr-3 text-right">Ejecutada</th>
                    <th className="pr-3 text-right">Aprobada</th>
                    <th className="pr-3 text-right">Saldo</th>
                    <th className="pr-3 text-right">Ritmo / necesario</th>
                    <th className="pr-3">Fin previsto</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-3">
                        <b>{r.a.code}</b> · {r.a.name}
                      </td>
                      <td className="pr-3">{companyName(r.a.companyId)}</td>
                      <td className="pr-3">{[r.a.subfield, r.a.circuit].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="pr-3 text-right tabular-nums">
                        {n1(r.a.contractQty)} {r.a.unit}
                      </td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.planned)}</td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.reported)}</td>
                      <td className="pr-3 text-right font-semibold tabular-nums">{n1(r.approved)}</td>
                      <td className="pr-3 text-right tabular-nums">{n1(r.balance)}</td>
                      <td className="pr-3 text-right tabular-nums">
                        {n1(r.status.dailyRate)}
                        {r.status.requiredRate != null && Number.isFinite(r.status.requiredRate) ? ` / ${n1(r.status.requiredRate)}` : ""}
                      </td>
                      <td className="pr-3 tabular-nums">{r.status.projectedFinish ?? "—"}</td>
                      <td>
                        <LightBadge light={r.status.light} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
