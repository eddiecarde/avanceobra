/**
 * Informe semanal (lunes a domingo) que se envía solo cada lunes: avance de la semana contra lo
 * programado, tendencias, desviaciones, cumplimiento del plan semanal (PPC), causas, hallazgos y lo
 * que bloquea. Sin Deno ni red: se prueba con Vitest. El PDF usa el mismo escritor que el informe diario.
 */
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { addDays, buildWeeklyAnalysis, type WeeklyAnalysis } from "./engine.js";
import { LOSS_LABEL, n1, pct, reportInputFromRaw, type Blockers, type RawDashboard } from "./report.ts";
import { A4, bogotaStamp, CAT, dmy, fullAnnex, M, MUTED, priorityTable, pts as fmtPts, reportHeader, STATUS_COLOR, Writer } from "./report_pdf.ts";

export const PLAN_CAUSE_LABEL: Record<string, string> = {
  ...LOSS_LABEL,
  prerequisite: "Tarea previa sin terminar",
  planning: "Mala estimación",
};

export interface WeekPlan {
  committed: number;
  done: number;
  causes: { cause: string; count: number }[];
}

export interface WeekReport {
  projectId: string;
  projectName: string;
  weekStart: string;
  weekEnd: string;
  contractEnd: string | null;
  actualStart: number;
  actualEnd: number;
  plannedStart: number;
  plannedEnd: number;
  spi: number | null;
  projectedFinish: string | null;
  finishDelay: number | null;
  /** Producción de la semana por grupo de trabajo (o por actividad si la obra no tiene grupos). */
  production: {
    name: string;
    qty: number | null;
    unit: string | null;
    activities: number;
  }[];
  late: { name: string; count: number }[];
  lateTotal: number;
  entries: number;
  lostHours: number;
  causes: { cause: string; hours: number; pct: number }[];
  findingsOpened: number;
  findingsClosed: number;
  findingsOpen: number;
  plan: (WeekPlan & { ppc: number | null }) | null;
  blockers: Blockers;
  /** Análisis del informe: tendencias, desviaciones, situaciones y observaciones. */
  analysis: WeeklyAnalysis;
}

export function buildWeekReport(raw: RawDashboard, weekStart: string, extras: { plan: WeekPlan | null; blockers: Blockers; today?: string }): WeekReport {
  const weekEnd = addDays(weekStart, 6);
  // Un solo cálculo (el del análisis) para que el mensaje, el PDF y la web digan lo mismo
  const analysis = buildWeeklyAnalysis(reportInputFromRaw(raw), weekStart, extras.today ?? weekEnd, { labels: { loss: LOSS_LABEL } });
  const acts = raw.activities.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    unit: a.unit,
  }));
  const group = new Map(raw.activities.map((a) => [a.id, a.work_group ?? null]));
  const grouped = raw.activities.some((a) => a.work_group);

  // Producción de la semana, por grupo (cantidad si todo el grupo tiene la misma unidad)
  const inWeek = raw.entries.filter((e) => e.work_date >= weekStart && e.work_date <= weekEnd);
  const prod = new Map<string, { qty: number; units: Set<string>; acts: Set<string> }>();
  for (const e of inWeek) {
    const a = acts.find((x) => x.id === e.activity_id);
    if (!a) continue;
    const key = (grouped ? group.get(a.id) : null) ?? `${a.code} · ${a.name}`;
    const p = prod.get(key) ?? {
      qty: 0,
      units: new Set<string>(),
      acts: new Set<string>(),
    };
    p.qty += Number(e.quantity);
    p.units.add(a.unit);
    p.acts.add(a.id);
    prod.set(key, p);
  }
  const production = [...prod.entries()]
    .map(([name, p]) => ({
      name,
      qty: p.units.size === 1 ? p.qty : null,
      unit: p.units.size === 1 ? [...p.units][0]! : null,
      activities: p.acts.size,
    }))
    .sort((a, b) => b.activities - a.activities || (b.qty ?? 0) - (a.qty ?? 0));

  // Atrasadas al cierre de la semana (criterio documentado del informe), por grupo
  const lateRows = analysis.end.rows.filter((r) => r.status === "atrasada");
  const lateMap = new Map<string, number>();
  for (const x of lateRows) {
    const key = (grouped ? group.get(x.id) : null) ?? x.code;
    lateMap.set(key, (lateMap.get(key) ?? 0) + 1);
  }

  const bog = (t: string) => new Date(new Date(t).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  return {
    projectId: raw.project.id,
    projectName: raw.project.name,
    weekStart,
    weekEnd,
    contractEnd: raw.project.contract_end_date,
    actualStart: analysis.actualStart,
    actualEnd: analysis.actualEnd,
    plannedStart: analysis.plannedStart,
    plannedEnd: analysis.plannedEnd,
    spi: analysis.spi,
    projectedFinish: analysis.projectedFinish,
    finishDelay: analysis.finishDelay,
    production,
    late: [...lateMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    lateTotal: lateRows.length,
    entries: inWeek.length,
    // Solo las horas con causa registrada
    // Horas y causas por línea de pérdida (un registro puede tener varias)
    lostHours: analysis.lostHours,
    causes: analysis.causes,
    findingsOpened: raw.findings.filter((f) => bog(f.created_at) >= weekStart && bog(f.created_at) <= weekEnd).length,
    findingsClosed: raw.findings.filter((f) => f.closed_at && bog(f.closed_at) >= weekStart && bog(f.closed_at) <= weekEnd).length,
    // Abiertos al cierre de la semana (no a hoy): creados hasta el domingo y sin cerrar ese día
    findingsOpen: raw.findings.filter((f) => bog(f.created_at) <= weekEnd && (f.closed_at ? bog(f.closed_at) > weekEnd : f.status !== "closed")).length,
    plan: extras.plan
      ? {
          ...extras.plan,
          ppc: extras.plan.committed ? extras.plan.done / extras.plan.committed : null,
        }
      : null,
    blockers: extras.blockers,
    analysis,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pts = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} pts`;

/** Mensaje corto del lunes; el informe completo va en el PDF adjunto. */
export function weekTelegramHtml(w: WeekReport, webUrl: string): string {
  const lines = [
    `🗓 <b>Informe semanal · ${esc(w.projectName)}</b>`,
    `Semana del ${w.weekStart} al ${w.weekEnd}`,
    "",
    `Avance: <b>${pct(w.actualEnd)}</b> (${pts(w.actualEnd - w.actualStart)} en la semana) · programado ${pct(w.plannedEnd)} (${pts(w.plannedEnd - w.plannedStart)})`,
    w.projectedFinish
      ? `Fin proyectado ${w.projectedFinish}${w.finishDelay != null && w.finishDelay !== 0 ? ` (${w.finishDelay > 0 ? "+" : ""}${w.finishDelay} días)` : ""}`
      : "Sin fecha proyectada",
  ];
  if (w.plan) lines.push(`Plan cumplido (PPC): <b>${w.plan.ppc == null ? "—" : pct(w.plan.ppc)}</b> · ${w.plan.done} de ${w.plan.committed} tareas`);
  if (w.production.length)
    lines.push(
      "",
      "<b>Producción</b>",
      ...w.production.slice(0, 6).map((p) => `• ${esc(p.name)}: ${p.qty != null ? `${n1(p.qty)} ${esc(p.unit ?? "")}` : `${p.activities} actividad(es)`}`),
    );
  if (w.lateTotal)
    lines.push(
      "",
      `<b>Atrasadas (${w.lateTotal})</b>: ${w.late
        .slice(0, 4)
        .map((l) => `${esc(l.name)} (${l.count})`)
        .join(", ")}`,
    );
  if (w.causes.length) lines.push("", `<b>Causas</b>: ${w.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h`).join(" · ")}`);
  const blocks = w.blockers.constraints.length + w.blockers.impeditive.length + w.blockers.materials.length;
  lines.push("", `Hallazgos: ${w.findingsOpened} nuevo(s), ${w.findingsClosed} cerrado(s), ${w.findingsOpen} abierto(s) · Bloqueos: ${blocks}`);
  lines.push("", `<a href="${webUrl}/semanal">Ver en la web</a> · informe completo en el PDF`);
  return lines.join("\n");
}

const DAY = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const short = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const TREND = {
  mejora: "Mejora",
  empeora: "Empeora",
  igual: "Igual",
  nueva: "Nueva",
} as const;
const GREY = rgb(0.63, 0.63, 0.61);
const DARK = rgb(0.1, 0.1, 0.1);
const RED = rgb(0.78, 0.13, 0.13);
const niceCount = (v: number) => Math.max(4, Math.ceil(v / 4) * 4);

export async function buildWeekPdf(w: WeekReport, generatedAt: Date = new Date()): Promise<Uint8Array> {
  const a = w.analysis;
  const doc = await PDFDocument.create();
  doc.setTitle(`Informe semanal ${w.projectName} ${w.weekStart}`);
  doc.setAuthor("AvanceObra");
  doc.setLanguage("es-CO");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = new Writer(doc, font, bold, `${w.projectName} · Informe semanal · ${dmy(w.weekStart)} – ${dmy(w.weekEnd)}`);
  reportHeader(p, "Informe semanal de obra", w.projectName, `Periodo: ${dmy(w.weekStart)} – ${dmy(w.weekEnd)}${a.inProgress ? ` · corte ${dmy(a.cutoff)}` : ""}`, [
    `Generado ${bogotaStamp(generatedAt)} (hora de Colombia)`,
  ]);

  p.section("1", "Resumen semanal");
  const prev = (cur: number, before: number | null, unit: string) =>
    before == null ? "Sin semana anterior comparable" : `${cur - before >= 0 ? "+" : ""}${n1(cur - before)}${unit} frente a la semana anterior (${n1(before)}${unit})`;
  p.kpis([
    {
      label: "Avance al cierre",
      value: pct(a.actualEnd),
      sub: `Al inicio ${pct(a.actualStart)} · programado ${pct(a.plannedEnd)}`,
      bar: { actual: a.actualEnd, planned: a.plannedEnd },
    },
    {
      label: "Desviación",
      value: a.plannedEnd > 0 || a.actualEnd > 0 ? fmtPts(a.deviationEndPts) : "No calculable",
      tone: a.deviationEndPts <= -15 ? "critical" : a.deviationEndPts <= -5 ? "warning" : "good",
      sub: `Al inicio ${fmtPts(a.deviationStartPts)} · SPI ${a.spi == null ? "no calculable" : a.spi.toLocaleString("es-CO", { maximumFractionDigits: 2 })}`,
    },
    {
      label: "Avance de la semana",
      value: fmtPts(a.gainPts, 2),
      tone: a.gainPts >= a.plannedGainPts ? "good" : "warning",
      sub: `Programado ${fmtPts(a.plannedGainPts, 2)} · ${prev(a.gainPts, a.prevGainPts, " pts")}`,
    },
    {
      label: "Fin proyectado",
      value: a.projectedFinish ? dmy(a.projectedFinish) : "No calculable",
      tone: a.finishDelay != null && a.finishDelay > 0 ? "critical" : a.projectedFinish ? "good" : "warning",
      sub: `Contractual ${a.contractEnd ? dmy(a.contractEnd) : "no disponible"}${a.finishDelay ? ` (${a.finishDelay > 0 ? "+" : ""}${a.finishDelay} días)` : ""}${a.prevProjectedFinish ? ` · semana anterior ${dmy(a.prevProjectedFinish)}` : ""}`,
    },
    {
      label: "Registros de avance",
      value: String(a.entries),
      tone: "neutral",
      sub: prev(a.entries, a.prevEntries, ""),
    },
    {
      label: "Horas perdidas",
      value: `${n1(a.lostHours)} h`,
      tone: a.lostHours > a.prevLostHours ? "warning" : "neutral",
      sub: a.causes[0] ? `Principal: ${LOSS_LABEL[a.causes[0].cause] ?? a.causes[0].cause} · antes ${n1(a.prevLostHours)} h` : `Sin pérdidas · antes ${n1(a.prevLostHours)} h`,
    },
    {
      label: "Plan semanal (PPC)",
      value: w.plan?.ppc == null ? "No disponible" : pct(w.plan.ppc),
      tone: "neutral",
      sub: w.plan ? `${w.plan.done} de ${w.plan.committed} tareas cumplidas` : "Sin plan semanal cerrado",
    },
    {
      label: "Hallazgos",
      value: `${a.findings.open} abiertos`,
      tone: a.findings.impeditive ? "critical" : a.findings.overdue ? "warning" : "neutral",
      sub: `${a.findings.opened} nuevos · ${a.findings.closed} cerrados · ${a.findings.overdue} vencidos`,
    },
  ]);
  p.statusStrip(a.end.counts, a.end.rows.length);
  p.text(
    `Terminadas en la semana: ${a.completed.length}${
      a.completed.length
        ? ` (${a.completed
            .slice(0, 8)
            .map((r) => r.code)
            .join(", ")}${a.completed.length > 8 ? "…" : ""})`
        : ""
    } · Atrasadas: ${a.start.counts.atrasada} al inicio -> ${a.end.counts.atrasada} al cierre.`,
    { size: 8, color: MUTED },
  );

  p.section("2", "Situaciones de la semana", "De la más grave a la menos");
  p.situations(a.situations, "Sin situaciones que destacar.");

  // ------------------------------------------------ Gráficos
  p.section("3", "Gráficos y tendencias");
  const W = A4[0] - 2 * M;
  const half = (W - 8) / 2;
  const right = M + half + 8;
  const sampledAll = a.curve.points;
  const step = Math.max(1, Math.ceil(sampledAll.length / 60));
  const sampled = sampledAll.filter((x, i) => i % step === 0 || x.date === a.cutoff || i === sampledAll.length - 1);
  const cut = sampled.findIndex((x) => x.date === a.cutoff);
  const ce = a.contractEnd ? sampled.findIndex((x) => x.date >= a.contractEnd!) : -1;
  p.ensure(186);
  let area = p.chartFrame(
    M,
    W,
    180,
    "Curva S: avance acumulado real frente al programado",
    `Avance global ponderado (%) del ${dmy(sampled[0]?.date)} al ${dmy(sampled.at(-1)?.date)}`,
    [
      { label: "Programado", color: CAT[1]! },
      { label: "Real", color: CAT[0]! },
      { label: "Proyectado al ritmo reciente", color: CAT[0]!, dashed: true },
    ],
  );
  p.lineChart(
    area,
    sampled.map((x) => short(x.date)),
    [
      { color: CAT[1]!, values: sampled.map((x) => x.planned) },
      { color: CAT[0]!, values: sampled.map((x) => x.actual), width: 2 },
      { color: CAT[0]!, values: sampled.map((x) => x.projected), dashed: true },
    ],
    1,
    (v) => `${Math.round(v * 100)} %`,
    [...(cut >= 0 ? [{ at: cut, label: "Corte", color: MUTED }] : []), ...(ce >= 0 ? [{ at: ce, label: "Contractual", color: RED }] : [])],
  );
  p.y -= 186;

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
            color: GREY,
            values: a.days.map((d) => others.reduce((s, k) => s + (d.gainBy[k] ?? 0), 0)),
          },
        ]
      : []),
  ];
  const ptsAxis = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: v < 1 ? 2 : 1 });
  const tl = a.trend.map((t) => short(t.weekEnd));
  p.ensure(176);
  let top = p.y;
  area = p.chartFrame(M, half, 170, "Avance diario por frente", "Puntos de avance global aportados por día", [
    ...stacks.map((s) => ({ label: s.label, color: s.color, bar: true })),
    { label: "Programado", color: DARK, dashed: true },
  ]);
  p.barChart(
    area,
    a.days.map((d, i) => `${DAY[i]} ${Number(d.date.slice(8, 10))}`),
    stacks,
    ptsAxis,
    {
      color: DARK,
      values: a.days.map((d, i) => (d.workday ? (d.planned - (i ? a.days[i - 1]!.planned : a.plannedStart)) * 100 : null)),
    },
  );
  p.y = top;
  area = p.chartFrame(right, half, 170, "Avance por semana: real frente al programado", `Puntos ganados por semana · últimas ${a.trend.length}`, [
    { label: "Real", color: CAT[0]!, bar: true },
    { label: "Programado", color: DARK, dashed: true },
  ]);
  p.barChart(area, tl, [{ color: CAT[0]!, values: a.trend.map((t) => Math.max(0, t.gainPts)) }], ptsAxis, {
    color: DARK,
    values: a.trend.map((t, i) => (i ? (t.planned - a.trend[i - 1]!.planned) * 100 : null)),
  });
  p.y = top - 176;

  p.ensure(170);
  top = p.y;
  area = p.chartFrame(M, half, 164, "Actividades atrasadas y que requieren atención", `Número al cierre de cada semana · últimas ${a.trend.length}`, [
    { label: "Atrasadas", color: RED },
    { label: "Requieren atención", color: CAT[3]! },
  ]);
  p.lineChart(
    area,
    tl,
    [
      { color: RED, values: a.trend.map((t) => t.late), dots: true },
      { color: CAT[3]!, values: a.trend.map((t) => t.attention), dots: true },
    ],
    niceCount(Math.max(1, ...a.trend.map((t) => t.attention))),
    (v) => String(Math.round(v)),
  );
  p.y = top;
  area = p.chartFrame(right, half, 164, "Hallazgos y acciones correctivas", "Nuevos y cerrados por semana; abiertos al cierre", [
    { label: "Nuevos", color: CAT[1]!, bar: true },
    { label: "Cerrados", color: CAT[2]!, bar: true },
    { label: "Abiertos al cierre", color: CAT[0]!, dashed: true },
  ]);
  p.barChart(
    area,
    tl,
    [
      { color: CAT[1]!, values: a.trend.map((t) => t.findingsOpened) },
      { color: CAT[2]!, values: a.trend.map((t) => t.findingsClosed) },
    ],
    (v) => String(Math.round(v)),
    { color: CAT[0]!, values: a.trend.map((t) => t.findingsOpen) },
    { integer: true },
  );
  p.y = top - 170;

  if (a.rateVsRequired.length) {
    const hh = 52 + a.rateVsRequired.length * 14;
    p.ensure(hh + 6);
    area = p.chartFrame(
      M,
      W,
      hh,
      "Rendimiento real frente al necesario",
      "Ritmo de la semana como % del necesario para terminar en la fecha planeada (actividades con menor cumplimiento)",
      [],
    );
    p.ratioBars(
      area,
      a.rateVsRequired.map((r) => ({
        label: `${r.code} · ${r.name}`,
        ratio: r.ratio,
      })),
    );
    p.y -= hh + 6;
  }

  // ------------------------------------------------ Desviaciones
  p.section("4", "Análisis de desviaciones", "Actividades con mayor desviación al cierre");
  if (a.deviations.length)
    p.table(
      [
        { title: "Actividad / frente", w: 30 },
        { title: "Desviación", w: 9, align: "right" },
        { title: "Sem. anterior", w: 9, align: "right" },
        { title: "Tendencia", w: 9 },
        { title: "Pendiente", w: 12, align: "right" },
        { title: "Ritmo sem. / necesario", w: 12, align: "right" },
        { title: "Causa registrada", w: 19 },
      ],
      a.deviations.slice(0, 12).map((d) => ({
        cells: [
          `${d.row.code} · ${d.row.name}${d.row.front ? `\n${d.row.front}${d.row.group ? ` · ${d.row.group}` : ""}` : ""}`,
          fmtPts(d.row.gapPts, 0),
          d.prevGapPts == null ? "—" : fmtPts(d.prevGapPts, 0),
          TREND[d.trend],
          `${n1(d.row.pendingQty)} ${d.row.unit}`,
          `${n1(d.weekRate)} / ${d.row.requiredRate == null ? "—" : Number.isFinite(d.row.requiredRate) ? n1(d.row.requiredRate) : "vencida"}`,
          d.causes.length ? d.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h`).join(", ") : "No registrada",
        ],
        color: (i: number) => (i === 1 ? STATUS_COLOR[d.row.status] : i === 3 && d.trend === "empeora" ? RED : i === 3 && d.trend === "mejora" ? rgb(0.05, 0.55, 0.3) : undefined),
        note: `${d.row.action ?? "Sin acción sugerida."} · Responsable: ${d.row.responsible ?? "no registrado"} · Fecha compromiso: no registrada`,
      })),
    );
  else
    p.text("Ninguna actividad con desviación que requiera atención.", {
      size: 9,
      color: MUTED,
    });
  p.text("Tendencia: desviación al cierre frente a la del cierre de la semana anterior. Las causas salen de las horas perdidas registradas en la semana.", {
    size: 7.2,
    color: MUTED,
  });

  // ------------------------------------------------ Riesgos
  p.section("5", "Riesgos y acciones pendientes");
  const b = w.blockers;
  if (w.plan) {
    p.text(`Plan semanal: ${w.plan.committed} tareas comprometidas, ${w.plan.done} cumplidas (PPC ${w.plan.ppc == null ? "no disponible" : pct(w.plan.ppc)}).`, { size: 8.5 });
    if (w.plan.causes.length)
      p.text(`Causas de incumplimiento registradas: ${w.plan.causes.map((c) => `${PLAN_CAUSE_LABEL[c.cause] ?? c.cause} (${c.count})`).join(" · ")}`, { size: 8.5 });
  }
  p.text(
    `Pérdidas de tiempo registradas: ${w.causes.length ? w.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h (${pct(c.pct)})`).join(" · ") : "ninguna"}.`,
    { size: 8.5 },
  );
  if (!b.constraints.length && !b.impeditive.length && !b.materials.length) p.text("Sin restricciones abiertas, hallazgos impeditivos ni materiales por agotarse.", { size: 8.5 });
  b.constraints.slice(0, 12).forEach((c) => p.text(`• Restricción abierta: ${c.description}${c.needBy ? ` (necesaria para el ${dmy(c.needBy)})` : ""}`, { size: 8.5 }));
  b.impeditive.slice(0, 10).forEach((d) => p.text(`• Hallazgo impeditivo: ${d}`, { size: 8.5 }));
  b.materials.forEach((m) => p.text(`• Material por agotarse: ${m}`, { size: 8.5 }));

  const rest = a.priority.slice(12, 32);
  if (rest.length) {
    p.section("6", "Otras actividades que requieren atención", `${rest.length} de ${a.priority.length - 12} · todas en el anexo B`);
    priorityTable(p, rest);
  }

  p.signatures(["Residente de obra", "Director de obra"]);

  // ------------------------------------------------ Anexos
  p.newPage();
  p.section(null, "Anexo A · Producción de la semana por grupo o actividad");
  if (w.production.length)
    p.table(
      [
        { title: "Grupo / actividad", w: 60 },
        { title: "Cantidad", w: 25, align: "right" },
        { title: "Actividades", w: 15, align: "right" },
      ],
      w.production.slice(0, 60).map((x) => ({
        cells: [x.name, x.qty != null ? `${n1(x.qty)} ${x.unit ?? ""}` : "Varias unidades", String(x.activities)],
      })),
    );
  else p.text("Sin registros de avance en la semana.", { size: 9, color: MUTED });
  p.section(null, "Anexo B · Seguimiento de actividades al cierre", `${a.end.rows.length} actividades`);
  fullAnnex(p, a.end.rows, "la web (Informe semanal)");
  p.section(null, "Anexo C · Criterios y observaciones de los datos");
  p.observations(a.observations);
  p.finish(`AvanceObra · ${w.projectName}`);
  return doc.save();
}
