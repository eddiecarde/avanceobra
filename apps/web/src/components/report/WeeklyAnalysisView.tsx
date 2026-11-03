"use client";

import { reportStatusRules, type WeeklyAnalysis } from "@avanceobra/engine";
import { cx } from "@/components/ui";
import { LOSS_LABEL, pct } from "@/lib/dashboard";
import { dmy, n1, pts } from "@/lib/report";
import { PriorityTable } from "./ActivityTables";
import { CAT, ceil4, ChartFrame, GroupedBarsLine, LinesChart, OTHER, RatioBars, StackedBars } from "./ReportCharts";
import { Kpi, KpiGrid, num, Observations, Section, Situations, SourceTag, StatusChip, StatusStrip, td, th } from "./ReportKit";

const DAY = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const short = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const pctAxis = (v: number) => `${Math.round(v * 100)} %`;
const ptsAxis = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: v < 1 ? 2 : 1 });
const TREND = {
  mejora: ["▲ Mejora", "text-emerald-700"],
  empeora: ["▼ Empeora", "text-red-700"],
  igual: ["= Igual", "text-zinc-600"],
  nueva: ["Nueva", "text-zinc-600"],
} as const;

function vsPrev(cur: number, prev: number | null, unit: string, better: "up" | "down") {
  if (prev == null) return "Sin semana anterior comparable";
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return `Igual que la semana anterior (${n1(prev)}${unit})`;
  const good = better === "up" ? d > 0 : d < 0;
  return (
    <span>
      <span className={good ? "text-emerald-700" : "text-red-700"}>{d > 0 ? "▲" : "▼"}</span> {d > 0 ? "+" : ""}
      {n1(d)}
      {unit} frente a la semana anterior ({n1(prev)}
      {unit})
    </span>
  );
}

/** Parte analítica del informe semanal: resumen, situaciones, tendencias, desviaciones, riesgos y criterios. */
export function WeeklyAnalysisView({ a, alerts, startDate }: { a: WeeklyAnalysis; alerts: string[]; startDate?: string | null }) {
  // Curva S muestreada por semana (una obra larga tiene cientos de días)
  const pts0 = a.curve.points;
  const step = Math.max(1, Math.ceil(pts0.length / 60));
  const sampled = pts0.filter((p, i) => i % step === 0 || p.date === a.cutoff || i === pts0.length - 1);
  const cutIdx = sampled.findIndex((p) => p.date === a.cutoff);
  const contractIdx = a.contractEnd ? sampled.findIndex((p) => p.date >= a.contractEnd!) : -1;
  const groups = a.groups.slice(0, 5);
  const others = a.groups.slice(5).map((g) => g.key);
  const stacks = [
    ...groups.map((g, i) => ({
      label: g.label,
      color: CAT[i]!,
      values: a.days.map((d) => d.gainBy[g.key] ?? 0),
    })),
    ...(others.length
      ? [
          {
            label: `Otros (${others.length})`,
            color: OTHER,
            values: a.days.map((d) => others.reduce((s, k) => s + (d.gainBy[k] ?? 0), 0)),
          },
        ]
      : []),
  ];
  const plannedDaily = a.days.map((d, i) => (d.workday ? (d.planned - (i ? a.days[i - 1]!.planned : a.plannedStart)) * 100 : null));
  const trendLabels = a.trend.map((t) => short(t.weekEnd));
  const devShown = a.deviations.slice(0, 12);
  const trendPlannedGain = a.trend.map((t, i) => (i ? (t.planned - a.trend[i - 1]!.planned) * 100 : null));

  return (
    <>
      <Section n="1" title="Resumen semanal" note={`Periodo ${dmy(a.weekStart)} – ${dmy(a.weekEnd)}${a.inProgress ? ` · semana en curso, corte ${dmy(a.cutoff)}` : ""}`}>
        <KpiGrid>
          <Kpi label="Avance al cierre" value={pct(a.actualEnd)} bar={{ actual: a.actualEnd, planned: a.plannedEnd }} sub={`Al inicio de la semana ${pct(a.actualStart)}`} />
          <Kpi label="Programado al cierre" value={pct(a.plannedEnd)} tone="neutral" sub={`Al inicio ${pct(a.plannedStart)}`} />
          <Kpi
            label="Desviación"
            value={a.plannedEnd > 0 || a.actualEnd > 0 ? pts(a.deviationEndPts) : "No calculable"}
            tone={a.deviationEndPts <= -15 ? "critical" : a.deviationEndPts <= -5 ? "warning" : "good"}
            sub={`Al inicio ${pts(a.deviationStartPts)} · SPI ${a.spi != null ? a.spi.toLocaleString("es-CO", { maximumFractionDigits: 2 }) : "no calculable"}`}
          />
          <Kpi
            label="Avance de la semana"
            value={pts(a.gainPts, 2)}
            tone={a.gainPts >= a.plannedGainPts ? "good" : "warning"}
            sub={
              <>
                Programado {pts(a.plannedGainPts, 2)} · {vsPrev(a.gainPts, a.prevGainPts, " pts", "up")}
              </>
            }
          />
          <Kpi label="Fecha contractual" value={a.contractEnd ? dmy(a.contractEnd) : "No disponible"} tone="neutral" sub={startDate ? `Inicio ${dmy(startDate)}` : undefined} />
          <Kpi
            label="Fin proyectado"
            value={a.projectedFinish ? dmy(a.projectedFinish) : "No calculable"}
            tone={a.finishDelay != null && a.finishDelay > 0 ? "critical" : a.projectedFinish ? "good" : "warning"}
            sub={
              a.projectedFinish
                ? `${a.finishDelay == null ? "Sin fecha contractual" : a.finishDelay > 0 ? `+${a.finishDelay} días frente a la contractual` : a.finishDelay < 0 ? `${-a.finishDelay} días antes de la contractual` : "En la fecha contractual"}${a.prevProjectedFinish ? ` · semana anterior ${dmy(a.prevProjectedFinish)}` : ""}`
                : "Hay actividades con saldo sin ritmo reciente"
            }
          />
          <Kpi label="Registros de avance" value={a.entries} tone="neutral" sub={vsPrev(a.entries, a.prevEntries, "", "up")} />
          <Kpi
            label="Horas perdidas"
            value={`${n1(a.lostHours)} h`}
            tone={a.lostHours > a.prevLostHours ? "warning" : "neutral"}
            sub={
              a.causes[0]
                ? `Principal: ${LOSS_LABEL[a.causes[0].cause] ?? a.causes[0].cause} ${n1(a.causes[0].hours)} h · antes ${n1(a.prevLostHours)} h`
                : `Sin pérdidas registradas · antes ${n1(a.prevLostHours)} h`
            }
          />
        </KpiGrid>
        <StatusStrip counts={a.end.counts} total={a.end.rows.length} />
        <p className="mt-2 text-[12.5px] text-zinc-700">
          <SourceTag kind="calculado" />
          Terminadas en la semana: <b>{a.completed.length}</b>
          {a.completed.length
            ? ` (${a.completed
                .slice(0, 8)
                .map((r) => r.code)
                .join(", ")}${a.completed.length > 8 ? "…" : ""})`
            : ""}{" "}
          · Pendientes al cierre: <b>{a.end.rows.length - a.end.counts.terminada}</b> · Atrasadas: <b>{a.start.counts.atrasada}</b> al inicio → <b>{a.end.counts.atrasada}</b> al
          cierre · Hallazgos: {a.findings.opened} nuevos, {a.findings.closed} cerrados, <b>{a.findings.open}</b> abiertos al cierre ({a.findings.overdue} vencidos).
        </p>
      </Section>

      <Section n="2" title="Situaciones de la semana" note="De la más grave a la menos">
        <Situations items={a.situations} empty="Sin situaciones que destacar." />
      </Section>

      <Section n="3" title="Gráficos y tendencias">
        <div className="grid gap-3">
          <ChartFrame
            title="Curva S: avance acumulado real frente al programado"
            subtitle={`Avance global ponderado (%), del ${dmy(sampled[0]?.date)} al ${dmy(sampled.at(-1)?.date)} · proyección al ritmo de las últimas semanas`}
            legend={[
              { label: "Programado", color: "var(--viz-2)" },
              { label: "Real", color: "var(--viz-1)" },
              { label: "Proyectado", color: "var(--viz-1)", dashed: true },
            ]}
          >
            <LinesChart
              labels={sampled.map((p) => short(p.date))}
              series={[
                {
                  label: "Programado",
                  color: "var(--viz-2)",
                  values: sampled.map((p) => p.planned),
                },
                {
                  label: "Real",
                  color: "var(--viz-1)",
                  values: sampled.map((p) => p.actual),
                  width: 3,
                },
                {
                  label: "Proyectado",
                  color: "var(--viz-1)",
                  values: sampled.map((p) => p.projected),
                  dashed: true,
                },
              ]}
              max={1}
              fmt={pctAxis}
              marks={[
                ...(cutIdx >= 0 ? [{ at: cutIdx, label: "Corte", color: "var(--viz-text-2)" }] : []),
                ...(contractIdx >= 0
                  ? [
                      {
                        at: contractIdx,
                        label: "Contractual",
                        color: "var(--viz-critical)",
                      },
                    ]
                  : []),
              ]}
              ariaLabel={`Curva S al ${a.cutoff}: real ${pct(a.actualEnd)}, programado ${pct(a.plannedEnd)}`}
            />
          </ChartFrame>

          <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
            <ChartFrame
              title="Avance diario por frente"
              subtitle={`Puntos de avance global aportados por día · ${dmy(a.weekStart)} – ${dmy(a.weekEnd)}`}
              legend={[
                ...stacks.map((s) => ({
                  label: s.label,
                  color: s.color,
                  bar: true,
                })),
                {
                  label: "Programado por día",
                  color: "var(--viz-text-2)",
                  dashed: true,
                },
              ]}
            >
              <StackedBars
                labels={a.days.map((d, i) => `${DAY[i]} ${Number(d.date.slice(8, 10))}`)}
                stacks={stacks}
                line={{
                  label: "Programado",
                  color: "var(--viz-text-2)",
                  values: plannedDaily,
                }}
                fmt={ptsAxis}
                ariaLabel="Avance aportado por día y frente"
              />
            </ChartFrame>
            <ChartFrame
              title="Avance por semana: real frente al programado"
              subtitle={`Puntos de avance global ganados por semana · últimas ${a.trend.length} semanas`}
              legend={[
                { label: "Real", color: "var(--viz-1)", bar: true },
                {
                  label: "Programado",
                  color: "var(--viz-text-2)",
                  dashed: true,
                },
              ]}
            >
              <StackedBars
                labels={trendLabels}
                stacks={[
                  {
                    label: "Real",
                    color: "var(--viz-1)",
                    values: a.trend.map((t) => Math.max(0, t.gainPts)),
                  },
                ]}
                line={{
                  label: "Programado",
                  color: "var(--viz-text-2)",
                  values: trendPlannedGain,
                }}
                fmt={ptsAxis}
                ariaLabel="Avance real frente al programado en los últimos periodos"
              />
            </ChartFrame>
            <ChartFrame
              title="Actividades pendientes y atrasadas"
              subtitle={`Número de actividades al cierre de cada semana · últimas ${a.trend.length} semanas`}
              legend={[
                { label: "Atrasadas", color: "var(--viz-critical)" },
                {
                  label: "Requieren atención (atrasadas, sin avance, sin registros, en riesgo)",
                  color: "var(--viz-4)",
                },
              ]}
            >
              <LinesChart
                labels={trendLabels}
                series={[
                  {
                    label: "Atrasadas",
                    color: "var(--viz-critical)",
                    values: a.trend.map((t) => t.late),
                    dots: true,
                  },
                  {
                    label: "Requieren atención",
                    color: "var(--viz-4)",
                    values: a.trend.map((t) => t.attention),
                    dots: true,
                  },
                ]}
                max={ceil4(Math.max(1, ...a.trend.map((t) => t.attention)))}
                fmt={(v) => String(Math.round(v))}
                ariaLabel="Evolución de actividades atrasadas"
                labelEvery={1}
              />
            </ChartFrame>
            <ChartFrame
              title="Hallazgos y acciones correctivas"
              subtitle={`Hallazgos nuevos, cerrados y abiertos al cierre de cada semana · últimas ${a.trend.length} semanas`}
              legend={[
                { label: "Nuevos", color: "var(--viz-2)", bar: true },
                { label: "Cerrados", color: "var(--viz-3)", bar: true },
                { label: "Abiertos al cierre", color: "var(--viz-1)" },
              ]}
            >
              <GroupedBarsLine
                labels={trendLabels}
                bars={[
                  {
                    label: "Nuevos",
                    color: "var(--viz-2)",
                    values: a.trend.map((t) => t.findingsOpened),
                  },
                  {
                    label: "Cerrados",
                    color: "var(--viz-3)",
                    values: a.trend.map((t) => t.findingsClosed),
                  },
                ]}
                line={{
                  label: "Abiertos al cierre",
                  color: "var(--viz-1)",
                  values: a.trend.map((t) => t.findingsOpen),
                }}
                ariaLabel="Tendencia de hallazgos"
              />
            </ChartFrame>
          </div>
          {a.rateVsRequired.length ? (
            <ChartFrame
              title="Rendimiento real frente al necesario"
              subtitle={`Ritmo de la semana (cantidad ÷ días laborables) como % del ritmo necesario para terminar en la fecha planeada · ${a.rateVsRequired.length} actividades con menor cumplimiento`}
            >
              <RatioBars
                rows={a.rateVsRequired.map((r) => ({
                  label: `${r.code} · ${r.name}`,
                  ratio: r.ratio,
                  detail: `${n1(r.weekRate)} de ${n1(r.requiredRate)} ${r.unit}/día`,
                }))}
                ariaLabel="Rendimiento real frente al necesario"
              />
            </ChartFrame>
          ) : null}
        </div>
      </Section>

      <Section n="4" title="Análisis de desviaciones" note="Actividades con mayor desviación al cierre">
        {a.deviations.length ? (
          <>
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  <th className={th}>Actividad / frente</th>
                  <th className={`${th} text-right`}>Desviación</th>
                  <th className={`${th} text-right`}>Sem. anterior</th>
                  <th className={th}>Tendencia</th>
                  <th className={`${th} text-right`}>Pendiente</th>
                  <th className={`${th} text-right`}>Ritmo sem. / necesario</th>
                  <th className={th}>Causa registrada</th>
                </tr>
              </thead>
              {devShown.map((d) => (
                <tbody key={d.row.id} className="break-inside-avoid">
                  <tr>
                    <td className={cx(td, "border-b-0")}>
                      <b>{d.row.code}</b> · {d.row.name}
                      <div className="text-[11px] text-zinc-500">
                        {[d.row.front ? (d.row.frontName ? `${d.row.front} · ${d.row.frontName}` : d.row.front) : null, d.row.group].filter(Boolean).join(" · ")}{" "}
                        <StatusChip status={d.row.status} />
                      </div>
                    </td>
                    <td className={cx(td, num, "border-b-0 font-bold", d.row.gapPts <= -15 ? "text-red-700" : "text-amber-700")}>{pts(d.row.gapPts, 0)}</td>
                    <td className={cx(td, num, "border-b-0")}>{d.prevGapPts == null ? "—" : pts(d.prevGapPts, 0)}</td>
                    <td className={cx(td, "border-b-0 whitespace-nowrap font-semibold", TREND[d.trend][1])}>{TREND[d.trend][0]}</td>
                    <td className={cx(td, num, "border-b-0")}>
                      {n1(d.row.pendingQty)} {d.row.unit}
                    </td>
                    <td className={cx(td, num, "border-b-0")}>
                      {n1(d.weekRate)} / {d.row.requiredRate == null ? "—" : Number.isFinite(d.row.requiredRate) ? n1(d.row.requiredRate) : "vencida"}
                    </td>
                    <td className={cx(td, "border-b-0")}>
                      {d.causes.length ? (
                        <>
                          <SourceTag kind="registrado" />
                          {d.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h`).join(", ")}
                        </>
                      ) : (
                        <span className="text-zinc-500">No registrada</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={7} className={cx(td, "pb-1.5 pt-0 text-[11.5px] text-zinc-700")}>
                      {d.row.action ? (
                        <>
                          <SourceTag kind="recomendacion" />
                          {d.row.action}{" "}
                        </>
                      ) : null}
                      <span className="text-zinc-500">Responsable: {d.row.responsible ?? "no registrado"} · Fecha compromiso: no registrada</span>
                    </td>
                  </tr>
                </tbody>
              ))}
            </table>
            <p className="mt-1 text-[11.5px] text-zinc-500">
              Tendencia: compara la desviación al cierre con la del cierre de la semana anterior (más de 0,5 pts de diferencia). Las causas salen de las horas perdidas registradas
              en la semana; la herramienta no registra fechas compromiso.
            </p>
          </>
        ) : (
          <p className="text-zinc-600">Ninguna actividad con desviación que requiera atención.</p>
        )}
      </Section>

      <Section n="5" title="Riesgos y acciones pendientes">
        {alerts.length ? (
          <ol className="list-decimal space-y-1 pl-6">
            {alerts.map((x) => (
              <li key={x} className="break-inside-avoid">
                {x}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-zinc-600">Sin restricciones, hallazgos vencidos ni alertas en la semana.</p>
        )}
      </Section>

      {a.priority.length > devShown.length ? (
        <Section
          n="6"
          title="Otras actividades que requieren atención"
          note={`${Math.min(20, a.priority.length - devShown.length)} de ${a.priority.length - devShown.length} · todas en el anexo A`}
        >
          <PriorityTable rows={a.priority.slice(devShown.length, devShown.length + 20)} />
        </Section>
      ) : null}

      <Section title="Criterios y observaciones de los datos">
        <Observations items={a.observations} rules={reportStatusRules()} />
      </Section>
    </>
  );
}
