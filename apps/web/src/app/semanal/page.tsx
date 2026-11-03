"use client";

import { buildWeeklyAnalysis, reportWeeks, type WeeklyAnalysis } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FullTable } from "@/components/report/ActivityTables";
import { ReportSheet, Signatures } from "@/components/report/ReportKit";
import { WeeklyAnalysisView } from "@/components/report/WeeklyAnalysisView";
import { Button, cx, downloadBlob, Field, Select } from "@/components/ui";
import { loadDashboard, localToday, LOSS_LABEL, type DashData } from "@/lib/dashboard";
import { dmy, reportInput } from "@/lib/report";
import { useCurrentProject, useSession } from "@/lib/session";
import {
  buildWeeklyReport,
  emptyExtras,
  loadWeekExtras,
  loadWeekPhotos,
  num,
  pct,
  projectSpan,
  TEST_STATUS_LABEL,
  weekLabel,
  WEATHER_LABEL,
  type WeekExtras,
  type WeeklyReport,
} from "@/lib/weekly";
import { exportWeeklyXlsx } from "@/lib/weeklyXlsx";

const DAY = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const th = "border border-zinc-300 bg-[#1f4e79] px-2 py-1 text-center text-[11px] font-bold uppercase text-white";
const thLight = "border border-zinc-300 bg-[#ddebf7] px-2 py-1 text-center text-[11px] font-bold uppercase text-zinc-800";
const td = "border border-zinc-300 px-2 py-1 align-top";

/** Anexos en el formato de control del cliente (tablas completas para la trazabilidad). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="bg-[#1f4e79] px-2 py-1 text-center text-sm font-extrabold uppercase tracking-wide text-white [break-after:avoid]">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * Informe semanal: primero el análisis (resumen, situaciones, tendencias, desviaciones y riesgos) y
 * después, como anexos, las tablas del formato de control del cliente. Pantalla, impresión y Excel.
 */
const SHOWN_WEEKS = 8;

export default function Semanal() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const [loaded, setLoaded] = useState<{
    projectId: string;
    data?: DashData;
    error?: string;
  } | null>(null);
  const data = loaded?.projectId === projectId ? (loaded.data ?? null) : null;
  const error = loaded?.projectId === projectId ? (loaded.error ?? null) : null;
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const [photos, setPhotos] = useState<{
    key: string;
    list: WeeklyReport["photos"];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const today = localToday();

  useEffect(() => {
    if (!projectId) return;
    loadDashboard(projectId).then(
      (d) => setLoaded({ projectId, data: d }),
      (e: Error) => setLoaded({ projectId, error: e.message }),
    );
  }, [projectId]);

  const weeks = useMemo(() => {
    if (!data) return [];
    const { from, to } = projectSpan(data, today);
    return reportWeeks(from, to, data.project.calendar);
  }, [data, today]);
  // Por defecto, la semana en curso (o la última si el proyecto ya terminó)
  const currentWeek = weeks.find((w) => w.start <= today && today <= w.end)?.index ?? weeks.at(-1)?.index ?? 1;
  const selected = weekIndex ?? currentWeek;

  // Primero el avance (rápido); luego, por semana, parte diario, ensayos, restricciones y fotos
  const base = useMemo(() => (data ? buildWeeklyReport(data, selected, today) : null), [data, selected, today]);
  const weekKey = base ? `${projectId}:${base.week.start}` : "";
  const [extras, setExtras] = useState<{
    key: string;
    value: WeekExtras;
  } | null>(null);
  useEffect(() => {
    if (!base || !projectId) return;
    let off = false;
    const key = `${projectId}:${base.week.start}`;
    void loadWeekExtras(projectId, base.week).then((value) => !off && setExtras({ key, value }));
    void loadWeekPhotos(projectId, base.week, base.data.activities).then((list) => !off && setPhotos({ key, list }));
    return () => {
      off = true;
    };
  }, [projectId, base]);
  const weekPhotos = photos?.key === weekKey ? photos.list : [];
  const weekExtras = extras?.key === weekKey ? extras.value : null;
  const report = useMemo(() => (data && base ? buildWeeklyReport(data, selected, today, [], weekExtras ?? emptyExtras()) : null), [data, base, selected, today, weekExtras]);
  const analysis = useMemo(
    () =>
      data && base
        ? buildWeeklyAnalysis(reportInput(data), base.week.start, today, {
            labels: { loss: LOSS_LABEL },
          })
        : null,
    [data, base, today],
  );

  async function exportXlsx() {
    if (!report) return;
    setBusy(true);
    try {
      const buf = await exportWeeklyXlsx({ ...report, photos: weekPhotos });
      const code = report.data.project.header.reportCode ?? "informe-semanal";
      downloadBlob(`${code}_semana-${report.week.index}_${report.week.lastWorkday}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } finally {
      setBusy(false);
    }
  }

  if (!projects.length) return <p className="text-zinc-500">No tienes proyectos asignados.</p>;

  const missingHeader = data && (!data.project.header.clientName || !data.project.header.contractCode);

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Informe semanal</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Formato del cliente: control de avance, ejecutado diario, seguimiento por semana, alertas, fotos y firmas.</p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => (setPicked(e.target.value), setWeekIndex(null))}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Semana">
          <Select value={selected} onChange={(e) => setWeekIndex(Number(e.target.value))}>
            {weeks.map((w) => (
              <option key={w.index} value={w.index}>
                Semana {w.index} · {weekLabel(w)}
                {w.index === currentWeek ? " (en curso)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" disabled={!report || busy} onClick={() => void exportXlsx()}>
          {busy ? "Generando…" : "Exportar Excel (formato cliente)"}
        </Button>
        <Button disabled={!report} onClick={() => window.print()}>
          Imprimir / PDF
        </Button>
      </div>

      {missingHeader ? (
        <p className="no-print mb-3 rounded-lg bg-amber-50 px-4 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Faltan datos de la cabecera (cliente o contrato). Complétalos en{" "}
          <Link href="/proyecto" className="font-semibold underline">
            Proyecto
          </Link>
          .
        </p>
      ) : null}
      {error ? <p className="text-red-700">No se pudo cargar: {error}</p> : null}
      {!report || !analysis ? !error ? <p className="text-zinc-500">Preparando el informe…</p> : null : <Sheet r={report} a={analysis} photos={weekPhotos} />}
    </div>
  );
}

function Sheet({ r, a, photos }: { r: WeeklyReport; a: WeeklyAnalysis; photos: WeeklyReport["photos"] }) {
  const { data, progress, week, weekPos } = r;
  const h = data.project.header;
  // En pantalla, las últimas 8 semanas (una obra grande tiene más de cien); el Excel trae todas
  const firstShown = Math.max(0, weekPos + 1 - SHOWN_WEEKS);
  const pastWeeks = progress.weeks.slice(firstShown, weekPos + 1);
  // Impresas, solo las últimas 4 semanas (más columnas no caben en A4 sin encoger la hoja)
  const printFrom = Math.max(0, pastWeeks.length - 4);
  // Filas con movimiento: el ejecutado diario solo con producción en la semana; el seguimiento,
  // solo actividades que cambian o siguen abiertas en las semanas mostradas (el Excel trae todas)
  const producedRows = progress.rows.filter((a) => r.dailyQty.get(a.id)!.some((q) => q !== 0));
  const trackedRows = progress.rows.filter((a) =>
    pastWeeks.some((_, wi) => {
      const k = firstShown + wi;
      const act = a.actual[k] ?? 0;
      const closedBefore = k > 0 && (a.actual[k - 1] ?? 0) >= 1 - 1e-9 && a.planned[k - 1]! >= 1 - 1e-9;
      return (a.planned[k]! > 0 || act > 0) && !closedBefore;
    }),
  );
  const omitted = (n: number) =>
    n < progress.rows.length ? (
      <p className="mb-1 text-xs text-zinc-500">{`${n} de ${progress.rows.length} actividades: se omiten las que no tienen movimiento en el periodo (el Excel trae todas).`}</p>
    ) : null;
  return (
    <ReportSheet wide running={`${data.project.name} · Informe semanal N.° ${week.index} · ${dmy(week.start)} – ${dmy(week.end)}`}>
      <div role="banner" className={cx("grid border border-zinc-400", h.logoUrl ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]")}>
        {h.logoUrl ? (
          <div className="flex items-center border-r border-zinc-400 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={h.logoUrl} alt="Logo de la empresa" className="h-10 w-auto max-w-[140px] object-contain" />
          </div>
        ) : null}
        <div className="bg-[#1f4e79] px-3 py-2 text-center text-lg font-extrabold text-white">INFORME SEMANAL DE CONSTRUCCIÓN</div>
        <div className="border-l border-zinc-400 px-3 py-1 text-xs">
          Código: <b>{h.reportCode ?? "—"}</b>
          <br />
          Fecha: <b>{week.lastWorkday.split("-").reverse().join("/")}</b>
        </div>
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="mt-2 w-full border-collapse">
          <tbody>
            {[
              ["Nombre del proyecto", data.project.name],
              ["Nombre a quien se le reporta", h.clientName ?? "—"],
              ["Reporta", h.contractorName ?? "—"],
              ["Contrato", h.contractCode ?? "—"],
              ["No. reporte", `${week.index} · semana ${weekLabel(week)}`],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className={`${td} w-64 font-bold uppercase`}>{k}</td>
                <td className={td}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <WeeklyAnalysisView a={a} alerts={r.risks} startDate={data.project.startDate} />

      <section className="mt-7">
        <h2 className="border-b-2 border-[#1f3a5f] pb-1 text-[15px] font-extrabold uppercase tracking-wide text-[#1f3a5f]">Firmas — reunión de seguimiento semanal</h2>
        <Signatures signers={h.signers.length ? h.signers : ["Residente de obra", "Director de obra"]} />
      </section>

      <div className="print-break" />
      <h2 className="mt-10 text-[17px] font-extrabold uppercase tracking-wide text-[#1f3a5f]">Anexos · detalle para la trazabilidad</h2>
      <Section title="Anexo A · Seguimiento de actividades al corte">
        <FullTable rows={a.end.rows} grouped={data.activities.some((x) => x.workGroup)} />
      </Section>

      <Section title="Anexo B · Control de avance por actividad">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["N°", "Actividad", "Und", "Total", "Ejecutado semana", "Acumulado", "% Ejecución", "% Programado", "Desviación"].map((c) => (
                  <th key={c} className={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {progress.rows.map((a, i) => {
                const dev = (a.actual[weekPos] ?? 0) - a.planned[weekPos]!;
                return (
                  <tr key={a.id}>
                    <td className={`${td} text-center`}>{i + 1}</td>
                    <td className={td}>{a.name}</td>
                    <td className={`${td} text-center`}>{a.unit}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{num(a.contractQty)}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{a.executed[weekPos] ? num(a.executed[weekPos]!) : "—"}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{num((a.actual[weekPos] ?? 0) * a.contractQty)}</td>
                    <td className={`${td} text-right font-semibold tabular-nums whitespace-nowrap`}>{pct(a.actual[weekPos])}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(a.planned[weekPos])}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap ${dev < -0.05 ? "font-bold text-red-700" : ""}`}>{pct(dev)}</td>
                  </tr>
                );
              })}
              <tr className="font-bold">
                <td className={td} colSpan={6}>
                  AVANCE GENERAL PONDERADO {progress.weighted ? "" : "(sin pesos: todas pesan igual)"}
                </td>
                <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(progress.totalActual[weekPos])}</td>
                <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(progress.totalPlanned[weekPos])}</td>
                <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct((progress.totalActual[weekPos] ?? 0) - progress.totalPlanned[weekPos]!)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Anexo C · Ejecutado diario · semana ${week.index}`}>
        {producedRows.length ? omitted(producedRows.length) : <p className="text-sm text-zinc-600">Sin producción registrada en la semana.</p>}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Actividad</th>
                {r.days.map((d, i) => (
                  <th key={d} className={thLight}>
                    {DAY[i]} {d.slice(8, 10)}/{d.slice(5, 7)}
                  </th>
                ))}
                <th className={th}>Avance % sem.</th>
              </tr>
            </thead>
            <tbody>
              {producedRows.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.name}</td>
                  {r.dailyQty.get(a.id)!.map((q, i) => (
                    <td key={i} className={`${td} text-right tabular-nums whitespace-nowrap`}>
                      {q ? num(q) : ""}
                    </td>
                  ))}
                  <td className={`${td} text-right font-semibold tabular-nums whitespace-nowrap`}>{a.contractQty ? pct(a.executed[weekPos]! / a.contractQty) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={firstShown > 0 ? `Anexo D · Seguimiento semanal de avance · últimas ${SHOWN_WEEKS} semanas (el Excel trae todas)` : "Anexo D · Seguimiento semanal de avance"}
      >
        {omitted(trackedRows.length)}
        {printFrom > 0 ? <p className="mb-1 hidden text-xs text-zinc-500 print:block">Impreso con las últimas 4 semanas; en pantalla y en el Excel están todas.</p> : null}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th} rowSpan={2}>
                  Actividad
                </th>
                {pastWeeks.map((w, wi) => (
                  <th key={w.index} className={cx(th, wi < printFrom && "print:hidden")} colSpan={3}>
                    Semana {w.index}
                    <div className="font-normal normal-case">{weekLabel(w)}</div>
                  </th>
                ))}
              </tr>
              <tr>
                {pastWeeks.flatMap((w, wi) =>
                  ["% prog.", "% ejec.", "Δ desv."].map((c) => (
                    <th key={`${w.index}${c}`} className={cx(thLight, wi < printFrom && "print:hidden")}>
                      {c}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {trackedRows.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.name}</td>
                  {pastWeeks.flatMap((_, wi) => {
                    const hide = wi < printFrom ? "print:hidden" : "";
                    const dev = a.actual[firstShown + wi] == null ? null : a.actual[firstShown + wi]! - a.planned[firstShown + wi]!;
                    return [
                      <td key={`p${wi}`} className={`${td} ${hide} text-right tabular-nums whitespace-nowrap`}>
                        {pct(a.planned[firstShown + wi])}
                      </td>,
                      <td key={`e${wi}`} className={`${td} ${hide} text-right tabular-nums whitespace-nowrap`}>
                        {pct(a.actual[firstShown + wi])}
                      </td>,
                      <td key={`d${wi}`} className={`${td} ${hide} text-right tabular-nums whitespace-nowrap ${dev != null && dev < -0.05 ? "font-bold text-red-700" : ""}`}>
                        {pct(dev)}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
              <tr className="font-bold">
                <td className={td}>AVANCE GENERAL PONDERADO</td>
                {pastWeeks.flatMap((_, wi) => [
                  <td key={`p${wi}`} className={cx(td, wi < printFrom && "print:hidden", "text-right tabular-nums whitespace-nowrap")}>
                    {pct(progress.totalPlanned[firstShown + wi])}
                  </td>,
                  <td key={`e${wi}`} className={cx(td, wi < printFrom && "print:hidden", "text-right tabular-nums whitespace-nowrap")}>
                    {pct(progress.totalActual[firstShown + wi])}
                  </td>,
                  <td key={`d${wi}`} className={cx(td, wi < printFrom && "print:hidden", "text-right tabular-nums whitespace-nowrap")}>
                    {progress.totalActual[firstShown + wi] == null ? "—" : pct(progress.totalActual[firstShown + wi]! - progress.totalPlanned[firstShown + wi]!)}
                  </td>,
                ])}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Anexo E · Clima y lluvia por día">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Día", "Condición", "Lluvia (parte diario)", "Min. de lluvia", "Horas perdidas por clima", "Otras pérdidas (h)", "Registros"].map((c) => (
                  <th key={c} className={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.dayInfo.map((d, i) => (
                <tr key={d.date}>
                  <td className={td}>
                    {DAY[i]} {d.date.split("-").reverse().join("/")}
                  </td>
                  <td className={td}>{d.weather ? (WEATHER_LABEL[d.weather] ?? d.weather) : "—"}</td>
                  <td className={td}>{r.logs[i]?.rain.length ? r.logs[i]!.rain.map((x) => `${x.start}–${x.end}`).join(", ") : "—"}</td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{r.logs[i]?.rainMinutes || "—"}</td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{d.rainHours ? num(d.rainHours) : "—"}</td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{d.lostHours - d.rainHours ? num(d.lostHours - d.rainHours) : "—"}</td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{d.entries || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.logs.some((l) => l?.observations.length) ? (
          <ul className="mt-2 list-disc pl-6 text-sm">{r.logs.flatMap((l, i) => (l?.observations ?? []).map((o) => <li key={`${i}${o}`}>{`${DAY[i]}: ${o}`}</li>))}</ul>
        ) : null}
      </Section>

      <Section title="Anexo F · Personal y equipos por día">
        {r.roles.length || r.equipment.length ? (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Cargo / equipo</th>
                  {r.days.map((d, i) => (
                    <th key={d} className={thLight}>
                      {DAY[i]} {d.slice(8, 10)}/{d.slice(5, 7)}
                    </th>
                  ))}
                  <th className={th}>Máx. semana</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["PERSONAL", r.roles, "personnel"],
                    ["EQUIPOS", r.equipment, "equipment"],
                  ] as const
                ).flatMap(([title, names, kind]) =>
                  names.length
                    ? [
                        <tr key={title}>
                          <td className={`${td} bg-zinc-100 font-bold`} colSpan={9}>
                            {title}
                          </td>
                        </tr>,
                        ...names.map((n) => {
                          const vals = r.logs.map((l) => l?.[kind][n] ?? 0);
                          return (
                            <tr key={`${kind}${n}`}>
                              <td className={td}>{n}</td>
                              {vals.map((v, i) => (
                                <td key={i} className={`${td} text-right tabular-nums whitespace-nowrap`}>
                                  {v || ""}
                                </td>
                              ))}
                              <td className={`${td} text-right font-semibold tabular-nums whitespace-nowrap`}>{Math.max(...vals)}</td>
                            </tr>
                          );
                        }),
                      ]
                    : [],
                )}
                <tr className="font-bold">
                  <td className={td}>TOTAL PERSONAL</td>
                  {r.dayInfo.map((d) => (
                    <td key={d.date} className={`${td} text-right tabular-nums whitespace-nowrap`}>
                      {d.crew || ""}
                    </td>
                  ))}
                  <td className={td} />
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-600">
            Aún no hay partes diarios esta semana. El supervisor lo envía desde el teléfono en Registrar → Parte diario. Mientras tanto, el personal es la suma de las cuadrillas
            reportadas: {r.dayInfo.map((d, i) => `${DAY[i]} ${d.crew || 0}`).join(" · ")}.
          </p>
        )}
      </Section>

      <Section title="Anexo G · Ensayos y pruebas — estado">
        {r.tests.length ? (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["N°", "Ensayo / prueba", "Norma", "Toma", "Envío", "Estado / resultado", "Observación"].map((c) => (
                    <th key={c} className={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.tests.map((t, i) => (
                  <tr key={`${t.name}${i}`}>
                    <td className={`${td} text-center`}>{i + 1}</td>
                    <td className={td}>
                      {t.name}
                      {t.lab ? <div className="text-xs text-zinc-500">{t.lab}</div> : null}
                    </td>
                    <td className={td}>{t.standard ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>{t.sample_date ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>{t.sent_date ?? "—"}</td>
                    <td className={`${td} ${t.status === "rechazado" ? "font-bold text-red-700" : ""}`}>
                      {TEST_STATUS_LABEL[t.status] ?? t.status}
                      {t.result ? ` · ${t.result}` : ""}
                    </td>
                    <td className={td}>{t.observation ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-600">Sin ensayos en curso esta semana.</p>
        )}
      </Section>

      {r.constraints.some((c) => c.status === "liberada") ? (
        <Section title="Anexo H · Restricciones liberadas en la semana">
          <ul className="list-disc pl-6">
            {r.constraints
              .filter((c) => c.status === "liberada")
              .map((c) => (
                <li key={c.description}>
                  {c.description} · liberada el {c.released_at}
                  {c.responsible ? ` (${c.responsible})` : ""}
                </li>
              ))}
          </ul>
        </Section>
      ) : null}

      {photos.length ? (
        <Section title="Anexo I · Registro fotográfico">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
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
    </ReportSheet>
  );
}
