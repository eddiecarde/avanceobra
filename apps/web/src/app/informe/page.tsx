"use client";

import { addDays, buildDailyAnalysis, reportStatusRules, summarizeDailyLogs, type DailyLogSummary } from "@avanceobra/engine";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { FullTable, PriorityTable } from "@/components/report/ActivityTables";
import { Kpi, KpiGrid, num, Observations, ReportSheet, Section, Signatures, Situations, SourceTag, StatusChip, StatusStrip, td, th } from "@/components/report/ReportKit";
import { Button, cx, Input } from "@/components/ui";
import { FINDING_STATUS_LABEL, FINDING_TYPE_LABEL, loadDashboard, localDate, localToday, LOSS_LABEL, pct, SEVERITY_LABEL, WEATHER_LABEL, type DashData } from "@/lib/dashboard";
import { dmy, longDate, n1, pts, reportInput } from "@/lib/report";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Photo {
  url: string;
  caption: string;
}

/** Actividades que se muestran en el cuerpo; el resto queda en el anexo. */
const PRIORITY_SHOWN = 15;

export default function InformePage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Informe />
    </Suspense>
  );
}

/** Informe diario de obra: hoja para pantalla e impresión (PDF desde el navegador). */
function Informe() {
  const params = useSearchParams();
  const router = useRouter();
  const { memberships, session, currentProjectId } = useSession();
  // El del enlace (?p=), si no el elegido en el menú lateral, si no el primero
  const projectId = params.get("p") ?? (currentProjectId || memberships.find((m) => m.project)?.project_id || "");
  const day = params.get("d") ?? localToday();
  const [loaded, setLoaded] = useState<{
    projectId: string;
    data?: DashData;
    error?: string;
  } | null>(null);
  const data = loaded?.projectId === projectId ? (loaded.data ?? null) : null;
  const error = loaded?.projectId === projectId ? (loaded.error ?? null) : null;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [log, setLog] = useState<{
    key: string;
    value: DailyLogSummary | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadDashboard(projectId).then(
      (d) => setLoaded({ projectId, data: d }),
      (e: Error) => setLoaded({ projectId, error: e.message }),
    );
  }, [projectId]);

  // Parte diario del día (personal y equipos reportados)
  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void supabase
      .from("daily_log_latest")
      .select("log_date, personnel, equipment, rain, observations")
      .eq("project_id", projectId)
      .eq("log_date", day)
      .then(({ data: rows }) => {
        const list = (rows ?? []) as {
          log_date: string;
          personnel: { role: string; qty: number }[];
          equipment: { name: string; qty: number }[];
          rain: { start: string; end: string }[];
          observations: string;
        }[];
        const sum = summarizeDailyLogs(
          list.map((x) => ({
            date: x.log_date,
            personnel: x.personnel ?? [],
            equipment: x.equipment ?? [],
            rain: x.rain ?? [],
            observations: x.observations,
          })),
        );
        if (!off) setLog({ key: `${projectId}:${day}`, value: sum.get(day) ?? null });
      });
    return () => {
      off = true;
    };
  }, [projectId, day]);
  const dayLog = log?.key === `${projectId}:${day}` ? log.value : null;

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
      const list = (
        (rows ?? []) as unknown as {
          storage_path: string;
          annotation: string | null;
          taken_at: string;
          entry: { work_date: string; activity_id: string } | null;
        }[]
      )
        .filter((r) => (r.entry ? r.entry.work_date === day : localDate(r.taken_at) === day))
        .slice(0, 8);
      if (!list.length) return setPhotos([]);
      const signed = await supabase.storage.from("photos").createSignedUrls(
        list.map((r) => r.storage_path),
        3600,
      );
      setPhotos(
        list.flatMap((r, i) => {
          const url = signed.data?.[i]?.signedUrl;
          const act = data.activities.find((a) => a.id === r.entry?.activity_id);
          const time = new Date(r.taken_at).toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return url
            ? [
                {
                  url,
                  caption: [act ? act.code : "Hallazgo", time, r.annotation].filter(Boolean).join(" · "),
                },
              ]
            : [];
        }),
      );
    })();
  }, [projectId, day, data]);

  const a = useMemo(() => (data ? buildDailyAnalysis(reportInput(data), day, { loss: LOSS_LABEL }) : null), [data, day]);
  const setDay = (d: string) => router.replace(`/informe?p=${projectId}&d=${d}`);

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href="/dashboard" className="font-semibold text-blue-700 hover:underline dark:text-blue-400">
          ← Dashboard
        </Link>
        <label className="ml-auto flex items-center gap-2 font-semibold">
          Fecha de corte
          <Input type="date" value={day} max={localToday()} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-44" />
        </label>
        <Button variant="secondary" onClick={() => setDay(addDays(day, -1))}>
          ◀ Día anterior
        </Button>
        <Button onClick={() => window.print()} disabled={!a}>
          Imprimir / Guardar PDF
        </Button>
      </div>

      {error ? <p className="text-red-700">No se pudo cargar el informe: {error}</p> : null}
      {!data || !a ? (
        !error ? (
          <p className="text-zinc-500">Preparando el informe…</p>
        ) : null
      ) : (
        <ReportSheet running={`${data.project.name} · Informe diario de obra · corte ${dmy(day)}`}>
          <div role="banner" className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-[#1f3a5f] pb-3">
            {data.project.header.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.project.header.logoUrl} alt="Logo de la empresa" className="h-14 w-auto max-w-[180px] object-contain" />
            ) : null}
            <div className="mr-auto">
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Informe diario de obra</div>
              <div className="text-xl font-extrabold leading-tight">{data.project.name}</div>
              <div className="text-zinc-700">
                Fecha de corte: <b>{longDate(day)}</b>
                {a.workday ? "" : " · día no laborable"}
              </div>
            </div>
            <div className="text-right text-[12px] text-zinc-600">
              {data.project.header.contractCode ? (
                <>
                  Contrato <b>{data.project.header.contractCode}</b>
                  <br />
                </>
              ) : null}
              Generado{" "}
              {new Date().toLocaleString("es-CO", {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {session?.user.email ? (
                <>
                  <br />
                  por {session.user.email}
                </>
              ) : null}
            </div>
          </div>

          <Section n="1" title="Resumen ejecutivo">
            <KpiGrid>
              <Kpi label="Avance real" value={pct(a.actual)} bar={{ actual: a.actual, planned: a.planned }} sub={`Programado ${pct(a.planned)}`} />
              <Kpi
                label="Desviación"
                value={a.planned > 0 || a.actual > 0 ? pts(a.deviationPts) : "No calculable"}
                tone={a.deviationPts <= -15 ? "critical" : a.deviationPts <= -5 ? "warning" : "good"}
                sub={a.spi != null ? `SPI ${a.spi.toLocaleString("es-CO", { maximumFractionDigits: 2 })} (real ÷ programado)` : "SPI no calculable: nada programado aún"}
              />
              <Kpi
                label="Fecha contractual"
                value={dmy(a.contractEnd) === "—" ? "No disponible" : dmy(a.contractEnd)}
                tone="neutral"
                sub={data.project.startDate ? `Inicio ${dmy(data.project.startDate)}` : undefined}
              />
              <Kpi
                label="Fin proyectado"
                value={a.projectedFinish ? dmy(a.projectedFinish) : "No calculable"}
                tone={a.finishDelay != null && a.finishDelay > 0 ? "critical" : a.projectedFinish ? "good" : "warning"}
                sub={
                  a.projectedFinish
                    ? a.finishDelay == null
                      ? "Sin fecha contractual para comparar"
                      : a.finishDelay > 0
                        ? `${a.finishDelay} días después de la contractual`
                        : a.finishDelay < 0
                          ? `${-a.finishDelay} días antes de la contractual`
                          : "En la fecha contractual"
                    : `${a.stalledCodes.length} actividad(es) con saldo sin ritmo`
                }
              />
              <Kpi
                label="Producción del día"
                value={a.entries ? `${a.entries} registro(s)` : "Sin registros"}
                tone={a.entries ? "info" : a.workday ? "warning" : "neutral"}
                sub={
                  a.entries
                    ? `Avance aportado ${pts(
                        a.production.reduce((s, p) => s + p.gainPts, 0),
                        2,
                      )} · ${a.production.length} frente(s)`
                    : a.workday
                      ? "Día laborable sin avance reportado"
                      : "Día no laborable"
                }
              />
              <Kpi
                label="Personal reportado"
                value={dayLog ? dayLog.totalPersonnel : a.entries ? a.crew : "No disponible"}
                tone="neutral"
                sub={
                  dayLog
                    ? `Parte diario · ${Object.values(dayLog.equipment).reduce((s, n) => s + n, 0)} equipo(s)`
                    : a.entries
                      ? "Suma de cuadrillas de los registros (sin parte diario)"
                      : "Sin parte diario ni registros"
                }
              />
              <Kpi
                label="Horas del día"
                value={a.entries ? `${n1(a.effectiveHours)} h` : "No disponible"}
                tone={a.lostHours > 0 ? "warning" : "neutral"}
                sub={a.entries ? `${n1(a.lostHours)} h perdidas${a.lossesToday[0] ? ` · ${LOSS_LABEL[a.lossesToday[0].cause] ?? a.lossesToday[0].cause}` : ""}` : undefined}
              />
              <Kpi
                label="Hallazgos abiertos"
                value={a.findings.open.length}
                tone={a.findings.impeditive ? "critical" : a.findings.overdue ? "warning" : "neutral"}
                sub={`${a.findings.overdue} vencido(s) · ${a.findings.impeditive} impeditivo(s) · hoy +${a.findings.opened.length} / −${a.findings.closed.length}`}
              />
            </KpiGrid>
            <StatusStrip counts={a.snapshot.counts} total={a.snapshot.rows.length} />
            <p className="mt-2 text-[12px] text-zinc-600">
              Pendientes: <b>{a.snapshot.rows.length - a.snapshot.counts.terminada}</b> de {a.snapshot.rows.length} actividades · Clima predominante:{" "}
              <b>{a.weather ? (WEATHER_LABEL[a.weather] ?? a.weather) : "No reportado"}</b>
              {dayLog?.rainMinutes ? ` · Lluvia ${dayLog.rain.map((r) => `${r.start}–${r.end}`).join(", ")} (${dayLog.rainMinutes} min)` : ""}. La herramienta no registra
              suspensiones formales: las actividades detenidas aparecen como «sin avance reciente».
            </p>
          </Section>

          <Section n="2" title="Situaciones del día" note="De la más grave a la menos">
            <Situations items={a.situations} empty="Sin situaciones que destacar." />
          </Section>

          <Section
            n="3"
            title="Actividades que requieren atención"
            note={a.priority.length > PRIORITY_SHOWN ? `${PRIORITY_SHOWN} de ${a.priority.length} · el resto en el anexo A` : `${a.priority.length} actividad(es)`}
          >
            {a.priority.length ? (
              <PriorityTable rows={a.priority.slice(0, PRIORITY_SHOWN)} />
            ) : (
              <p className="text-zinc-600">Ninguna actividad atrasada, en riesgo o sin avance.</p>
            )}
          </Section>

          <Section n="4" title="Producción del día">
            {a.entries ? (
              <>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>{data.activities.some((x) => x.workGroup) ? "Grupo de trabajo" : "Frente"}</th>
                      <th className={`${th} text-right`}>Actividades</th>
                      <th className={th}>Cantidad ejecutada</th>
                      <th className={`${th} text-right`}>Avance aportado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.production.map((p) => (
                      <tr key={p.key}>
                        <td className={`${td} font-semibold`}>{p.label}</td>
                        <td className={`${td} ${num}`}>{p.activities}</td>
                        <td className={td}>{p.qtyByUnit.map((q) => `${n1(q.qty)} ${q.unit}`).join(" · ")}</td>
                        <td className={`${td} ${num}`}>{pts(p.gainPts, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="mb-1 mt-4 font-bold">Detalle por actividad</h3>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>Actividad</th>
                      <th className={`${th} text-right`}>Hoy</th>
                      <th className={`${th} text-right`}>Ejecutado</th>
                      <th className={`${th} text-right`}>Pendiente</th>
                      <th className={`${th} text-right`}>Real / prog.</th>
                      <th className={th}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.snapshot.rows
                      .filter((r) => r.periodQty !== 0)
                      .sort((x, y) => (x.front ?? "").localeCompare(y.front ?? "") || x.code.localeCompare(y.code))
                      .map((r) => (
                        <tr key={r.id}>
                          <td className={td}>
                            <b>{r.code}</b> · {r.name}
                            {r.front ? <div className="text-[11px] text-zinc-500">{r.frontName ? `${r.front} · ${r.frontName}` : r.front}</div> : null}
                          </td>
                          <td className={`${td} ${num} font-bold`}>
                            {n1(r.periodQty)} {r.unit}
                          </td>
                          <td className={`${td} ${num}`}>
                            {n1(r.executedQty)} {r.unit}
                          </td>
                          <td className={`${td} ${num}`}>
                            {n1(r.pendingQty)} {r.unit}
                          </td>
                          <td className={`${td} ${num}`}>
                            {pct(r.actualPct, 0)} <span className="text-zinc-500">/ {r.plannedStart ? pct(r.plannedPct, 0) : "—"}</span>
                          </td>
                          <td className={td}>
                            <StatusChip status={r.status} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="text-zinc-600">{a.workday ? "No hay registros de avance enviados o aprobados con esta fecha." : "Día no laborable sin registros."}</p>
            )}
          </Section>

          <div className="grid gap-x-8 sm:grid-cols-2 print:grid-cols-2">
            <Section n="5" title="Personal y equipos">
              {dayLog ? (
                <table className="w-full">
                  <tbody>
                    {Object.entries(dayLog.personnel).map(([k, v]) => (
                      <tr key={`p${k}`}>
                        <td className={td}>{k}</td>
                        <td className={`${td} ${num}`}>{v}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className={td}>Total personal</td>
                      <td className={`${td} ${num}`}>{dayLog.totalPersonnel}</td>
                    </tr>
                    {Object.entries(dayLog.equipment).map(([k, v]) => (
                      <tr key={`e${k}`}>
                        <td className={td}>{k}</td>
                        <td className={`${td} ${num}`}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-zinc-600">
                  No hay parte diario con esta fecha.{" "}
                  {a.entries
                    ? `Las cuadrillas de los registros suman ${a.crew} persona(s) (puede contar dos veces a quien trabajó en varias actividades).`
                    : "Personal: no disponible."}
                </p>
              )}
            </Section>
            <Section n="6" title="Pérdidas de tiempo">
              <p className="mb-1">
                <SourceTag kind="registrado" />
                Hoy: {a.lossesToday.length ? a.lossesToday.map((l) => `${LOSS_LABEL[l.cause] ?? l.cause} ${n1(l.hours)} h`).join(" · ") : "sin pérdidas reportadas"}.
              </p>
              <p>
                <SourceTag kind="calculado" />
                Últimos 7 días:{" "}
                {a.weekCauses.length ? a.weekCauses.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h (${pct(c.pct, 0)})`).join(" · ") : "sin pérdidas"}.
              </p>
            </Section>
          </div>

          <Section
            n="7"
            title="Hallazgos y riesgos"
            note={`Abiertos al corte: ${a.findings.open.length} · nuevos hoy ${a.findings.opened.length} · cerrados hoy ${a.findings.closed.length}`}
          >
            {a.findings.open.length ? (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Severidad</th>
                    <th className={th}>Descripción</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Estado</th>
                    <th className={`${th} whitespace-nowrap`}>Fecha límite</th>
                  </tr>
                </thead>
                <tbody>
                  {a.findings.open.slice(0, 15).map((f) => (
                    <tr key={f.id}>
                      <td className={`${td} whitespace-nowrap font-bold`}>{SEVERITY_LABEL[f.severity] ?? f.severity}</td>
                      <td className={td}>
                        {f.description}
                        {f.impeditive ? <span className="ml-1 rounded bg-red-100 px-1 text-[10.5px] font-bold text-red-800">IMPEDITIVO</span> : null}
                        {f.createdAt === day ? <span className="ml-1 rounded bg-sky-100 px-1 text-[10.5px] font-bold text-sky-800">NUEVO</span> : null}
                      </td>
                      <td className={td}>{FINDING_TYPE_LABEL[f.type] ?? f.type}</td>
                      <td className={td}>{FINDING_STATUS_LABEL[f.status] ?? f.status}</td>
                      <td className={cx(td, "whitespace-nowrap tabular-nums", f.overdue && "font-bold text-red-700")}>
                        {f.dueDate ? `${dmy(f.dueDate)}${f.overdue ? " · vencido" : ""}` : "Sin fecha"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-zinc-600">Sin hallazgos abiertos.</p>
            )}
            {a.findings.open.length > 15 ? (
              <p className="mt-1 text-xs text-zinc-500">Y {a.findings.open.length - 15} hallazgo(s) más de menor severidad en el módulo de calidad.</p>
            ) : null}
          </Section>

          {a.notes.length || dayLog?.observations.length ? (
            <Section n="8" title="Notas de campo">
              <ul className="space-y-1">
                {a.notes.map((nt, i) => (
                  <li key={i}>
                    <b>{nt.code}</b>: {nt.text}
                  </li>
                ))}
                {dayLog?.observations.map((o) => (
                  <li key={o}>
                    <b>Parte diario</b>: {o}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {photos.length ? (
            <Section n="9" title="Registro fotográfico">
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

          <Signatures signers={["Residente de obra", "Director de obra"]} />

          <div className="print-break" />
          <Section title="Anexo A · Seguimiento completo de actividades" note={`${a.snapshot.rows.length} actividades al ${dmy(day)}`}>
            <FullTable rows={a.snapshot.rows} grouped={data.activities.some((x) => x.workGroup)} />
          </Section>
          <Section title="Anexo B · Criterios y observaciones de los datos">
            <Observations items={a.observations} rules={reportStatusRules()} />
          </Section>
        </ReportSheet>
      )}
    </div>
  );
}
