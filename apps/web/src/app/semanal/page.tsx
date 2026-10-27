"use client";

import { reportWeeks } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, cx, downloadBlob, Field, Select } from "@/components/ui";
import { loadDashboard, localToday, type DashData } from "@/lib/dashboard";
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid-page">
      <h2 className="bg-[#1f4e79] px-2 py-1 text-center text-sm font-extrabold uppercase tracking-wide text-white">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Informe semanal en el formato del cliente (CNX-PSS-001 · Helios): pantalla, impresión y Excel. */
const SHOWN_WEEKS = 8;

export default function Semanal() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const [loaded, setLoaded] = useState<{ projectId: string; data?: DashData; error?: string } | null>(null);
  const data = loaded?.projectId === projectId ? (loaded.data ?? null) : null;
  const error = loaded?.projectId === projectId ? (loaded.error ?? null) : null;
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const [photos, setPhotos] = useState<{ key: string; list: WeeklyReport["photos"] } | null>(null);
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
  const [extras, setExtras] = useState<{ key: string; value: WeekExtras } | null>(null);
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
  const report = useMemo(
    () => (data && base ? buildWeeklyReport(data, selected, today, [], weekExtras ?? emptyExtras()) : null),
    [data, base, selected, today, weekExtras],
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
      {!report ? (
        !error ? <p className="text-zinc-500">Preparando el informe…</p> : null
      ) : (
        <Sheet r={report} photos={weekPhotos} />
      )}
    </div>
  );
}

function Sheet({ r, photos }: { r: WeeklyReport; photos: WeeklyReport["photos"] }) {
  const { data, progress, week, weekPos } = r;
  const h = data.project.header;
  // En pantalla, las últimas 8 semanas (una obra grande tiene más de cien); el Excel trae todas
  const firstShown = Math.max(0, weekPos + 1 - SHOWN_WEEKS);
  const pastWeeks = progress.weeks.slice(firstShown, weekPos + 1);
  return (
    // Hoja siempre clara, igual a como sale impresa
    <article className="mx-auto max-w-[1100px] rounded-lg bg-white p-6 text-[13px] leading-snug text-zinc-900 shadow-sm ring-1 ring-zinc-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className={cx("grid border border-zinc-400", h.logoUrl ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]")}>
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
      </header>
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

      <Section title="Control de avance por actividad">
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

      <Section title={`Ejecutado diario · semana ${week.index}`}>
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
              {progress.rows.map((a) => (
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

      <Section title={firstShown > 0 ? `Seguimiento semanal de avance · últimas ${SHOWN_WEEKS} semanas (el Excel trae todas)` : "Seguimiento semanal de avance"}>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th} rowSpan={2}>
                  Actividad
                </th>
                {pastWeeks.map((w) => (
                  <th key={w.index} className={th} colSpan={3}>
                    Semana {w.index}
                    <div className="font-normal normal-case">{weekLabel(w)}</div>
                  </th>
                ))}
              </tr>
              <tr>
                {pastWeeks.flatMap((w) => ["% prog.", "% ejec.", "Δ desv."].map((c) => <th key={`${w.index}${c}`} className={thLight}>{c}</th>))}
              </tr>
            </thead>
            <tbody>
              {progress.rows.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.name}</td>
                  {pastWeeks.flatMap((_, wi) => {
                    const dev = a.actual[firstShown + wi] == null ? null : a.actual[firstShown + wi]! - a.planned[firstShown + wi]!;
                    return [
                      <td key={`p${wi}`} className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(a.planned[firstShown + wi])}</td>,
                      <td key={`e${wi}`} className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(a.actual[firstShown + wi])}</td>,
                      <td key={`d${wi}`} className={`${td} text-right tabular-nums whitespace-nowrap ${dev != null && dev < -0.05 ? "font-bold text-red-700" : ""}`}>{pct(dev)}</td>,
                    ];
                  })}
                </tr>
              ))}
              <tr className="font-bold">
                <td className={td}>AVANCE GENERAL PONDERADO</td>
                {pastWeeks.flatMap((_, wi) => [
                  <td key={`p${wi}`} className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(progress.totalPlanned[firstShown + wi])}</td>,
                  <td key={`e${wi}`} className={`${td} text-right tabular-nums whitespace-nowrap`}>{pct(progress.totalActual[firstShown + wi])}</td>,
                  <td key={`d${wi}`} className={`${td} text-right tabular-nums whitespace-nowrap`}>
                    {progress.totalActual[firstShown + wi] == null ? "—" : pct(progress.totalActual[firstShown + wi]! - progress.totalPlanned[firstShown + wi]!)}
                  </td>,
                ])}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Clima y lluvia por día">
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
          <ul className="mt-2 list-disc pl-6 text-sm">
            {r.logs.flatMap((l, i) => (l?.observations ?? []).map((o) => <li key={`${i}${o}`}>{`${DAY[i]}: ${o}`}</li>))}
          </ul>
        ) : null}
      </Section>

      <Section title="Personal y equipos por día">
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

      <Section title="Alertas y restricciones de la semana">
        {r.alerts.length ? (
          <ol className="list-decimal space-y-1 pl-6">
            {r.alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        ) : (
          <p>Sin alertas.</p>
        )}
      </Section>

      <Section title="Ensayos y pruebas — estado">
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
        <Section title="Restricciones liberadas en la semana">
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
        <Section title="Registro fotográfico">
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

      <Section title="Firmas — reunión de seguimiento semanal">
        <div className="mt-12 grid grid-cols-2 gap-x-12 gap-y-14">
          {h.signers.map((s) => (
            <div key={s} className="border-t border-zinc-900 pt-1 text-center text-sm font-bold uppercase">
              {s}
            </div>
          ))}
        </div>
      </Section>
    </article>
  );
}
