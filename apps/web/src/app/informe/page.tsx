"use client";

import { activityStatus, addDays, lossPareto, recentDailyRate, sCurve, diffDays } from "@avanceobra/engine";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { LightBadge } from "@/components/dash/Light";
import { Button, Input } from "@/components/ui";
import {
  FINDING_STATUS_LABEL,
  FINDING_TYPE_LABEL,
  loadDashboard,
  localDate,
  localToday,
  LOSS_LABEL,
  pct,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  WEATHER_LABEL,
  type DashData,
} from "@/lib/dashboard";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const longDate = (d: string) => {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

interface Photo {
  url: string;
  caption: string;
}

export default function InformePage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Informe />
    </Suspense>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid-page">
      <h2 className="mb-2 border-b-2 border-zinc-900 pb-1 text-base font-extrabold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

const th = "border-b border-zinc-300 py-1.5 pr-2 text-left text-xs font-bold uppercase tracking-wide text-zinc-600";
const td = "border-b border-zinc-200 py-1.5 pr-2 align-top";

/** Informe diario de obra: hoja para imprimir o guardar como PDF desde el navegador. */
function Informe() {
  const params = useSearchParams();
  const router = useRouter();
  const { memberships, session, currentProjectId } = useSession();
  // El del enlace (?p=), si no el elegido en el menú lateral, si no el primero
  const projectId = params.get("p") ?? (currentProjectId || memberships.find((m) => m.project)?.project_id || "");
  const day = params.get("d") ?? localToday();
  const [loaded, setLoaded] = useState<{ projectId: string; data?: DashData; error?: string } | null>(null);
  const data = loaded?.projectId === projectId ? (loaded.data ?? null) : null;
  const error = loaded?.projectId === projectId ? (loaded.error ?? null) : null;
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    if (!projectId) return;
    loadDashboard(projectId).then(
      (d) => setLoaded({ projectId, data: d }),
      (e: Error) => setLoaded({ projectId, error: e.message }),
    );
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !data) return;
    void (async () => {
      const { data: rows } = await supabase
        .from("photos")
        .select("storage_path, annotation, taken_at, entry:progress_entries(work_date, activity_id)")
        .eq("project_id", projectId)
        .eq("uploaded", true)
        .gte("taken_at", `${addDays(day, -1)}T00:00:00Z`)
        .lte("taken_at", `${addDays(day, 1)}T23:59:59Z`)
        .order("taken_at")
        .limit(60);
      const list = ((rows ?? []) as unknown as { storage_path: string; annotation: string | null; taken_at: string; entry: { work_date: string; activity_id: string } | null }[])
        .filter((r) => (r.entry ? r.entry.work_date === day : localDate(r.taken_at) === day))
        .slice(0, 8);
      if (!list.length) return setPhotos([]);
      const signed = await supabase.storage.from("photos").createSignedUrls(list.map((r) => r.storage_path), 3600);
      setPhotos(
        list.flatMap((r, i) => {
          const url = signed.data?.[i]?.signedUrl;
          const act = data.activities.find((a) => a.id === r.entry?.activity_id);
          const time = new Date(r.taken_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
          return url ? [{ url, caption: [act ? act.code : "Hallazgo", time, r.annotation].filter(Boolean).join(" · ") }] : [];
        }),
      );
    })();
  }, [projectId, day, data]);

  const report = useMemo(() => {
    if (!data) return null;
    const cal = data.project.calendar;
    const upTo = data.daily.filter((d) => d.date <= day);
    const starts = data.activities.map((a) => a.plannedStart).filter(Boolean) as string[];
    const from = data.project.startDate ?? starts.sort()[0] ?? day;
    const to = data.project.contractEnd ?? day;
    const curve = sCurve({ activities: data.activities, daily: upTo, from, to: to < day ? day : to, today: day, calendar: cal });
    const todays = data.entries.filter((e) => e.workDate === day);
    const rows = data.activities
      .map((a) => {
        const dayQty = todays.filter((e) => e.activityId === a.id).reduce((s, e) => s + e.quantity, 0);
        const executed = upTo.filter((d) => d.activityId === a.id).reduce((s, d) => s + d.quantity, 0);
        return { ...activityStatus(a, executed, recentDailyRate(upTo, a.id, day, 14, cal), day, cal), dayQty, front: a.frontCode };
      })
      .filter((r) => r.dayQty > 0 || (r.light !== "done" && r.light !== "not_started"));
    const weatherCount = new Map<string, number>();
    todays.forEach((e) => e.weather && weatherCount.set(e.weather, (weatherCount.get(e.weather) ?? 0) + 1));
    const weather = [...weatherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const losses = todays.filter((e) => e.lossCause !== "none" && e.lostHours > 0);
    const week = lossPareto(
      data.losses.filter((l) => l.date >= addDays(day, -6) && l.date <= day),
      "lost_hours",
    ).slice(0, 3);
    const opened = data.findings.filter((f) => f.createdAt === day);
    const closed = data.findings.filter((f) => f.closedAt === day);
    const overdue = data.findings
      .filter((f) => f.status !== "closed" && f.dueDate && f.dueDate < day && f.createdAt <= day)
      .sort((a, b) => SEVERITY_RANK[a.severity]! - SEVERITY_RANK[b.severity]!);
    const finishDelay = curve.projectedFinish && data.project.contractEnd ? diffDays(data.project.contractEnd, curve.projectedFinish) : null;
    return {
      curve,
      rows,
      todays,
      weather,
      losses,
      week,
      opened,
      closed,
      overdue,
      finishDelay,
      crew: todays.reduce((s, e) => s + e.crewSize, 0),
      hours: todays.reduce((s, e) => s + e.effectiveHours, 0),
      lost: losses.reduce((s, e) => s + e.lostHours, 0),
      notes: todays.filter((e) => e.notes.trim()),
    };
  }, [data, day]);

  const setDay = (d: string) => router.replace(`/informe?p=${projectId}&d=${d}`);

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href="/dashboard" className="font-semibold text-blue-700 hover:underline dark:text-blue-400">
          ← Dashboard
        </Link>
        <label className="ml-auto flex items-center gap-2 font-semibold">
          Fecha
          <Input type="date" value={day} max={localToday()} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-44" />
        </label>
        <Button variant="secondary" onClick={() => setDay(addDays(day, -1))}>
          ◀ Día anterior
        </Button>
        <Button onClick={() => window.print()} disabled={!report}>
          Imprimir / Guardar PDF
        </Button>
      </div>

      {error ? <p className="text-red-700">No se pudo cargar el informe: {error}</p> : null}
      {!data || !report ? (
        !error ? <p className="text-zinc-500">Preparando el informe…</p> : null
      ) : (
        // Hoja siempre clara (también en modo oscuro), igual a como sale impresa
        <article className="mx-auto max-w-[900px] rounded-lg bg-white p-8 text-[14px] leading-snug text-zinc-900 shadow-sm ring-1 ring-zinc-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-blue-700 pb-3">
            <div>
              <div className="text-xl font-extrabold">
                Avance<span className="text-blue-700">Obra</span> · Informe diario de obra
              </div>
              <div className="text-lg font-bold">{data.project.name}</div>
              <div className="text-zinc-700">{longDate(day)}</div>
            </div>
            <div className="text-right text-sm text-zinc-600">
              Generado {new Date().toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
              <br />
              por {session?.user.email}
              {data.project.contractEnd ? (
                <>
                  <br />
                  Fecha contractual {data.project.contractEnd}
                </>
              ) : null}
            </div>
          </header>

          <Section title="Resumen">
            <div className="grid grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-6 print:grid-cols-6">
              {[
                ["Avance real", pct(report.curve.actualToday)],
                ["Programado", pct(report.curve.plannedToday)],
                ["SPI", pct(report.curve.spi, 0)],
                [
                  "Fin proyectado",
                  report.curve.projectedFinish
                    ? `${report.curve.projectedFinish}${report.finishDelay != null && report.finishDelay > 0 ? ` (+${report.finishDelay} d)` : ""}`
                    : "Sin fecha",
                ],
                ["Personal", `${report.crew}`],
                ["Clima", report.weather ? WEATHER_LABEL[report.weather] ?? report.weather : "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs font-bold uppercase text-zinc-500">{k}</div>
                  <div className="text-base font-extrabold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-zinc-700">
              {report.todays.length} registro(s) de avance · {n1(report.hours)} h efectivas · {n1(report.lost)} h perdidas.
              {report.curve.stalled.length
                ? ` Sin avance en los últimos 14 días: ${report.curve.stalled.map((id) => data.activities.find((a) => a.id === id)?.code).join(", ")}.`
                : ""}
            </p>
          </Section>

          <Section title="Producción del día por actividad">
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Actividad</th>
                    <th className={`${th} text-right`}>Hoy</th>
                    <th className={`${th} text-right`}>Acumulado</th>
                    <th className={`${th} text-right`}>Ritmo / necesario</th>
                    <th className={th}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.rows]
                    .sort((a, b) => a.code.localeCompare(b.code))
                    .map((r) => (
                      <tr key={r.id}>
                        <td className={td}>
                          <b>{r.code}</b> · {r.name}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {r.dayQty > 0 ? (
                            <b>
                              {n1(r.dayQty)} {r.unit}
                            </b>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {pct(r.actualPct, 0)} <span className="text-zinc-500">de {pct(r.plannedPct, 0)}</span>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {n1(r.dailyRate)}
                          {r.requiredRate != null ? ` / ${Number.isFinite(r.requiredRate) ? n1(r.requiredRate) : "∞"}` : ""} {r.unit}/día
                        </td>
                        <td className={td}>
                          <LightBadge light={r.light} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Estado: ■ atrasada · ▲ en riesgo · ● al día. Ritmo = promedio de los últimos 14 días; necesario = para terminar en la fecha planeada.
            </p>
          </Section>

          <div className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
            <Section title="Pérdidas de tiempo del día">
              {report.losses.length === 0 ? (
                <p className="text-zinc-600">Sin pérdidas reportadas.</p>
              ) : (
                <ul className="space-y-1">
                  {report.losses.map((e) => (
                    <li key={e.id}>
                      <b>{LOSS_LABEL[e.lossCause] ?? e.lossCause}</b>: {n1(e.lostHours)} h · {data.activities.find((a) => a.id === e.activityId)?.code}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Principales causas (7 días)">
              {report.week.length === 0 ? (
                <p className="text-zinc-600">Sin pérdidas en la semana.</p>
              ) : (
                <ol className="list-decimal space-y-1 pl-5">
                  {report.week.map((r) => (
                    <li key={r.key}>
                      <b>{LOSS_LABEL[r.key] ?? r.key}</b>: {n1(r.value)} h ({pct(r.pct, 0)})
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>

          <Section title="Hallazgos">
            <p className="mb-1">
              Abiertos hoy: <b>{report.opened.length}</b> · Cerrados hoy: <b>{report.closed.length}</b> · Vencidos sin cerrar: <b>{report.overdue.length}</b>
            </p>
            {[...report.opened, ...report.overdue.filter((f) => !report.opened.includes(f))].length ? (
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>Severidad</th>
                      <th className={th}>Descripción</th>
                      <th className={th}>Tipo</th>
                      <th className={th}>Estado</th>
                      <th className={th}>Límite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.opened, ...report.overdue.filter((f) => !report.opened.includes(f))].map((f) => (
                      <tr key={f.id}>
                        <td className={`${td} font-bold`}>{SEVERITY_LABEL[f.severity]}</td>
                        <td className={td}>{f.description}</td>
                        <td className={td}>{FINDING_TYPE_LABEL[f.type]}</td>
                        <td className={td}>{FINDING_STATUS_LABEL[f.status]}</td>
                        <td className={`${td} tabular-nums ${f.dueDate && f.dueDate < day ? "font-bold text-red-700" : ""}`}>{f.dueDate ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          {report.notes.length ? (
            <Section title="Notas de campo">
              <ul className="space-y-1">
                {report.notes.map((e) => (
                  <li key={e.id}>
                    <b>{data.activities.find((a) => a.id === e.activityId)?.code}</b>: {e.notes}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {photos.length ? (
            <Section title="Registro fotográfico">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
                {photos.map((p) => (
                  <figure key={p.url} className="break-inside-avoid">
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Storage */}
                    <img src={p.url} alt={p.caption} className="aspect-[4/3] w-full rounded object-cover ring-1 ring-zinc-300" />
                    <figcaption className="mt-0.5 text-xs text-zinc-600">{p.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </Section>
          ) : null}

          <section className="mt-12 grid grid-cols-2 gap-12 break-inside-avoid">
            {["Residente de obra", "Director de obra"].map((r) => (
              <div key={r} className="border-t border-zinc-900 pt-1 text-center text-sm">
                {r}
                <div className="text-xs text-zinc-500">Nombre, firma y fecha</div>
              </div>
            ))}
          </section>
        </article>
      )}
    </div>
  );
}
