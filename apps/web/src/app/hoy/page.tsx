"use client";

import { buildDailyAnalysis, buildWeeklyAnalysis, mondayOf, REPORT_STATUS_LABEL } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/report/ReportKit";
import { Badge, Button, Card, cx, Input } from "@/components/ui";
import { callAi } from "@/lib/ai";
import { askFacts, frontsWithoutReport, type ConstraintRow } from "@/lib/ask";
import { loadDashboard, localToday, LOSS_LABEL, type DashData } from "@/lib/dashboard";
import { dmy, longDate, pts, reportInput } from "@/lib/report";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Tone = "red" | "amber" | "green" | "neutral";
interface Item {
  tone: Tone;
  title: string;
  detail: string;
  href: string;
  cta: string;
}

const SUGGESTED = [
  "¿Qué actividades no reportaron avance hoy?",
  "¿Qué hallazgos críticos siguen abiertos?",
  "¿Qué actividades están más atrasadas y qué se recomienda?",
  "Compara el avance de esta semana con la anterior",
  "Prepara el resumen para la reunión de obra",
];

interface Answer {
  answer: string;
  sources: { kind: string; ref: string; label: string }[];
  missing: string;
  ungrounded: number[];
  cutoff: string | null;
}

/**
 * Inicio por rol: lo que requiere atención hoy en la obra elegida, sin recorrer menús. Cada tarjeta
 * dice el dato y lleva a la página donde se resuelve; con el asistente activo, se le pregunta a la obra.
 */
export default function Hoy() {
  const { memberships, session, canUseAi } = useSession();
  const [picked] = useCurrentProject();
  const projectId = picked || memberships.find((m) => m.project)?.project_id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role ?? "field";
  const today = localToday();
  const [loaded, setLoaded] = useState<{ projectId: string; data?: DashData; constraints?: ConstraintRow[]; corrections?: number; error?: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    Promise.all([
      loadDashboard(projectId),
      supabase.from("project_constraints").select("id, description, responsible, need_by, status, created_at").eq("project_id", projectId),
      supabase.from("entry_corrections").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "pendiente"),
    ]).then(
      ([data, c, corr]) => !off && setLoaded({ projectId, data, constraints: (c.data ?? []) as ConstraintRow[], corrections: corr.count ?? 0 }),
      (e: Error) => !off && setLoaded({ projectId, error: e.message }),
    );
    return () => {
      off = true;
    };
  }, [projectId]);
  const cur = loaded?.projectId === projectId ? loaded : null;
  const data = cur?.data ?? null;

  const view = useMemo(() => {
    if (!data || !cur) return null;
    const inp = reportInput(data);
    const a = buildDailyAnalysis(inp, today, { loss: LOSS_LABEL });
    const w = buildWeeklyAnalysis(inp, mondayOf(today), today, { trendWeeks: 2, labels: { loss: LOSS_LABEL } });
    const constraints = cur.constraints ?? [];
    const open = constraints.filter((c) => c.status === "abierta");
    const overdueC = open.filter((c) => c.need_by && c.need_by < today);
    const submitted = data.entries.filter((e) => e.status === "submitted");
    const oldest = submitted.map((e) => e.workDate).sort()[0];
    const noReport = frontsWithoutReport(data, a);
    const items: (Item & { roles: string[] })[] = [];
    if (submitted.length)
      items.push({
        roles: ["resident", "director", "admin"],
        tone: oldest && oldest < today ? "amber" : "neutral",
        title: `${submitted.length} registro(s) por aprobar`,
        detail: oldest ? `El más antiguo es del ${dmy(oldest)}.` : "",
        href: "/registros",
        cta: "Revisar registros",
      });
    if (cur.corrections)
      items.push({ roles: ["resident", "director", "admin"], tone: "amber", title: `${cur.corrections} corrección(es) por decidir`, detail: "Cambios pedidos a registros ya aprobados.", href: "/registros", cta: "Decidir" });
    if (a.findings.impeditive || a.findings.overdue || a.findings.criticalHigh)
      items.push({
        roles: ["field", "resident", "director", "admin"],
        tone: a.findings.impeditive ? "red" : "amber",
        title: `${a.findings.open.length} hallazgo(s) abierto(s)`,
        detail: `${a.findings.overdue} vencido(s) · ${a.findings.impeditive} impeditivo(s) · ${a.findings.criticalHigh} crítico(s) o alto(s).`,
        href: "/calidad",
        cta: "Ver hallazgos",
      });
    if (open.length)
      items.push({
        roles: ["resident", "director", "admin"],
        tone: overdueC.length ? "red" : "amber",
        title: `${open.length} restricción(es) abierta(s)`,
        detail: overdueC.length ? `${overdueC.length} ya pasaron la fecha en que se necesitaban.` : "Ninguna vencida.",
        href: "/control",
        cta: "Ver restricciones",
      });
    if (noReport.length)
      items.push({
        roles: ["field", "resident", "director", "admin"],
        tone: "amber",
        title: `${noReport.length} frente(s) sin reporte hoy`,
        detail: noReport.slice(0, 4).join(", ") + (noReport.length > 4 ? "…" : ""),
        href: `/informe?p=${projectId}&d=${today}`,
        cta: "Ver informe del día",
      });
    if (a.finishDelay != null && a.finishDelay > 0)
      items.push({
        roles: ["director", "admin"],
        tone: "red",
        title: `Terminación proyectada ${a.finishDelay} días después de la contractual`,
        detail: `Fin proyectado ${dmy(a.projectedFinish)} frente a ${dmy(a.contractEnd)}. ¿Acelerar o asumir la multa?`,
        href: "/simulador",
        cta: "Abrir el simulador",
      });
    const mine = items.filter((i) => i.roles.includes(role));
    return { a, w, items: mine, noReport, facts: askFacts(data, a, w, constraints) };
  }, [data, cur, today, role, projectId]);

  if (!projectId) return <p className="text-zinc-500">No tienes obras asignadas.</p>;
  if (cur?.error) return <p className="text-red-700">No se pudo cargar: {cur.error}</p>;
  if (!data || !view) return <p className="text-zinc-500">Preparando lo de hoy…</p>;
  const { a, w } = view;
  const name = session?.user.user_metadata?.full_name as string | undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Hoy{name ? `, ${name.split(" ")[0]}` : ""}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {data.project.name} · {longDate(today)}
        </p>
      </div>

      <Link href="/campo" className="block rounded-xl bg-[#1f3a5f] px-4 py-3 text-center text-lg font-bold text-white sm:hidden">
        ✚ Registrar en campo (avance, parte, hallazgo)
      </Link>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Avance real" value={`${(a.actual * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`} sub={`Programado ${(a.planned * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`} />
        <Kpi label="Desviación" value={a.planned > 0 || a.actual > 0 ? pts(a.deviationPts) : "No calculable"} tone={a.deviationPts <= -15 ? "red" : a.deviationPts <= -5 ? "amber" : "green"} />
        <Kpi label="Fin proyectado" value={a.projectedFinish ? dmy(a.projectedFinish) : "No calculable"} sub={a.contractEnd ? `Contractual ${dmy(a.contractEnd)}` : "Sin fecha contractual"} tone={a.finishDelay != null && a.finishDelay > 0 ? "red" : "neutral"} />
        <Kpi label="Esta semana" value={pts(w.gainPts)} sub={w.prevGainPts == null ? "Sin semana anterior" : `Semana anterior ${pts(w.prevGainPts)}`} />
      </div>

      <section>
        <h2 className="mb-2 text-lg font-bold">Requiere tu atención</h2>
        {view.items.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {view.items.map((i) => (
              <Card key={i.title} className={cx("border-l-4", i.tone === "red" ? "border-l-red-600" : i.tone === "amber" ? "border-l-amber-500" : "border-l-zinc-300")}>
                <div className="font-bold">{i.title}</div>
                {i.detail ? <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{i.detail}</div> : null}
                <Link href={i.href} className="mt-2 inline-block font-semibold text-blue-700 hover:underline dark:text-blue-400">
                  {i.cta} →
                </Link>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <Badge tone="green">✓ Al día</Badge> <span className="ml-1">Nada pendiente por ahora.</span>
          </Card>
        )}
      </section>

      {a.priority.length ? (
        <section>
          <h2 className="mb-2 text-lg font-bold">Actividades más comprometidas</h2>
          <Card>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {a.priority.slice(0, 6).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <StatusChip status={r.status} />
                  <span className="font-semibold">{r.code}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{r.name}</span>
                  <span className="ml-auto text-sm tabular-nums text-zinc-500">{pts(r.gapPts)}</span>
                  {r.action ? <div className="w-full text-sm text-zinc-600 dark:text-zinc-400">{r.action}</div> : null}
                </li>
              ))}
            </ul>
            <Link href={`/informe?p=${projectId}&d=${today}`} className="mt-2 inline-block font-semibold text-blue-700 hover:underline dark:text-blue-400">
              Ver todas en el informe diario →
            </Link>
          </Card>
        </section>
      ) : null}

      {canUseAi(projectId) ? <AskBox projectId={projectId} facts={view.facts} /> : null}
      <p className="text-xs text-zinc-500">
        Corte: {dmy(today)}. Estados según los criterios del informe ({Object.values(REPORT_STATUS_LABEL).slice(0, 4).join(", ").toLowerCase()}…).
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <Card className={cx("border-l-4", tone === "red" ? "border-l-red-600" : tone === "amber" ? "border-l-amber-500" : tone === "green" ? "border-l-emerald-600" : "border-l-zinc-300")}>
      <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-extrabold tabular-nums">{value}</div>
      {sub ? <div className="text-sm text-zinc-600 dark:text-zinc-400">{sub}</div> : null}
    </Card>
  );
}

/** Preguntas en lenguaje natural sobre los datos de la obra; la respuesta cita de dónde sale. */
function AskBox({ projectId, facts }: { projectId: string; facts: ReturnType<typeof askFacts> }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ q: string; a?: Answer; error?: string } | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 4) return;
    setQ(text);
    setBusy(true);
    const r = await callAi<Answer>("ask", { project_id: projectId, question: text, facts });
    setBusy(false);
    setRes(r.error ? { q: text, error: r.error } : { q: text, a: r.data! });
  }

  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">Pregúntale a tu obra</h2>
      <Card>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué compromisos de esta semana están en riesgo?" aria-label="Pregunta sobre la obra" className="min-w-0 flex-1" />
          <Button variant="primary" type="submit" disabled={busy || q.trim().length < 4}>
            {busy ? "Pensando…" : "Preguntar"}
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => void ask(s)} className="rounded-full border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {s}
            </button>
          ))}
        </div>
        {res ? (
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800" aria-live="polite">
            <div className="text-sm font-semibold text-zinc-500">{res.q}</div>
            {res.error ? (
              <p className="mt-1 text-red-700">{res.error}</p>
            ) : res.a ? (
              <>
                <p className="mt-1 whitespace-pre-line">{res.a.answer}</p>
                {res.a.sources.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="text-zinc-500">Sustento:</span>
                    {res.a.sources.map((s) => (
                      <Badge key={`${s.kind}${s.ref}`} tone="neutral">
                        {s.kind}: {s.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {res.a.missing ? <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Falta en los datos: {res.a.missing}</p> : null}
                {res.a.ungrounded.length ? (
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Ojo: la respuesta trae cifras que no están en los datos ({res.a.ungrounded.join(", ")}); verifícalas.</p>
                ) : null}
                <p className="mt-1 text-xs text-zinc-500">
                  Datos al {dmy(res.a.cutoff)} · calculados por el motor de AvanceObra; Muse Spark (Meta) solo redacta. Las decisiones son del equipo.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
