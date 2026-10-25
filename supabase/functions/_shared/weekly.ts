/**
 * Informe semanal (lunes a domingo) que se envía solo cada lunes: avance de la semana contra lo
 * programado, producción por grupo, cumplimiento del plan semanal (PPC), causas, hallazgos y lo que
 * bloquea. Sin Deno ni red: se prueba con Vitest. El PDF usa el mismo escritor que el informe diario.
 */
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { activityStatus, addDays, diffDays, lossPareto, recentDailyRate, sCurve } from "./engine.js";
import { LOSS_LABEL, n1, pct, type Blockers, type RawDashboard } from "./report.ts";
import { A4, BLUE, LIGHT_COLOR, M, MUTED, Writer, winAnsi } from "./report_pdf.ts";

export const PLAN_CAUSE_LABEL: Record<string, string> = { ...LOSS_LABEL, prerequisite: "Tarea previa sin terminar", planning: "Mala estimación" };

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
  production: { name: string; qty: number | null; unit: string | null; activities: number }[];
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
}

export function buildWeekReport(raw: RawDashboard, weekStart: string, extras: { plan: WeekPlan | null; blockers: Blockers }): WeekReport {
  const weekEnd = addDays(weekStart, 6);
  const prevEnd = addDays(weekStart, -1);
  const cal = { workdays: raw.project.workdays ?? undefined, holidays: raw.project.holidays ?? [], colombianHolidays: raw.project.colombian_holidays !== false };
  const acts = raw.activities.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    unit: a.unit,
    contractQty: Number(a.contract_qty),
    plannedStart: a.planned_start,
    plannedFinish: a.planned_finish,
    weight: a.weight == null ? undefined : Number(a.weight),
  }));
  const group = new Map(raw.activities.map((a) => [a.id, a.work_group ?? null]));
  const grouped = raw.activities.some((a) => a.work_group);
  const daily = raw.entries.map((e) => ({ activityId: e.activity_id, date: e.work_date, quantity: Number(e.quantity) }));
  const upTo = (d: string) => daily.filter((x) => x.date <= d);
  const starts = acts.map((a) => a.plannedStart).filter(Boolean) as string[];
  const from = raw.project.start_date ?? starts.sort()[0] ?? weekStart;
  const to = raw.project.contract_end_date ?? weekEnd;
  const groupOf = grouped ? { groupOf: (id: string) => group.get(id) ?? null, rateWindowDays: 21 } : {};
  const curveEnd = sCurve({ activities: acts, daily: upTo(weekEnd), from, to: to < weekEnd ? weekEnd : to, today: weekEnd, calendar: cal, ...groupOf });
  const curveStart = sCurve({ activities: acts, daily: upTo(prevEnd), from, to: to < weekEnd ? weekEnd : to, today: prevEnd < from ? from : prevEnd, calendar: cal });

  // Producción de la semana, por grupo (cantidad si todo el grupo tiene la misma unidad)
  const inWeek = raw.entries.filter((e) => e.work_date >= weekStart && e.work_date <= weekEnd);
  const prod = new Map<string, { qty: number; units: Set<string>; acts: Set<string> }>();
  for (const e of inWeek) {
    const a = acts.find((x) => x.id === e.activity_id);
    if (!a) continue;
    const key = (grouped ? group.get(a.id) : null) ?? `${a.code} · ${a.name}`;
    const p = prod.get(key) ?? { qty: 0, units: new Set<string>(), acts: new Set<string>() };
    p.qty += Number(e.quantity);
    p.units.add(a.unit);
    p.acts.add(a.id);
    prod.set(key, p);
  }
  const production = [...prod.entries()]
    .map(([name, p]) => ({ name, qty: p.units.size === 1 ? p.qty : null, unit: p.units.size === 1 ? [...p.units][0]! : null, activities: p.acts.size }))
    .sort((a, b) => b.activities - a.activities || (b.qty ?? 0) - (a.qty ?? 0));

  // Atrasadas al cierre de la semana, por grupo
  const lateRows = acts.filter((a) => {
    const executed = upTo(weekEnd).filter((d) => d.activityId === a.id).reduce((t, d) => t + d.quantity, 0);
    return activityStatus(a, executed, recentDailyRate(daily, a.id, weekEnd, 14, cal), weekEnd, cal).light === "red";
  });
  const lateMap = new Map<string, number>();
  for (const a of lateRows) {
    const key = (grouped ? group.get(a.id) : null) ?? a.code;
    lateMap.set(key, (lateMap.get(key) ?? 0) + 1);
  }

  const causes = lossPareto(
    inWeek.filter((e) => e.loss_cause !== "none").map((e) => ({ cause: e.loss_cause, lostHours: Number(e.lost_hours) })),
    "lost_hours",
  ).slice(0, 4);
  const bog = (t: string) => new Date(new Date(t).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  return {
    projectId: raw.project.id,
    projectName: raw.project.name,
    weekStart,
    weekEnd,
    contractEnd: raw.project.contract_end_date,
    actualStart: curveStart.actualToday,
    actualEnd: curveEnd.actualToday,
    plannedStart: curveStart.plannedToday,
    plannedEnd: curveEnd.plannedToday,
    spi: curveEnd.spi,
    projectedFinish: curveEnd.projectedFinish,
    finishDelay: curveEnd.projectedFinish && raw.project.contract_end_date ? diffDays(raw.project.contract_end_date, curveEnd.projectedFinish) : null,
    production,
    late: [...lateMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    lateTotal: lateRows.length,
    entries: inWeek.length,
    lostHours: inWeek.reduce((t, e) => t + Number(e.lost_hours), 0),
    causes: causes.map((c) => ({ cause: c.key, hours: c.value, pct: c.pct })),
    findingsOpened: raw.findings.filter((f) => bog(f.created_at) >= weekStart && bog(f.created_at) <= weekEnd).length,
    findingsClosed: raw.findings.filter((f) => f.closed_at && bog(f.closed_at) >= weekStart && bog(f.closed_at) <= weekEnd).length,
    findingsOpen: raw.findings.filter((f) => f.status !== "closed").length,
    plan: extras.plan ? { ...extras.plan, ppc: extras.plan.committed ? extras.plan.done / extras.plan.committed : null } : null,
    blockers: extras.blockers,
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
    w.projectedFinish ? `Fin proyectado ${w.projectedFinish}${w.finishDelay != null && w.finishDelay !== 0 ? ` (${w.finishDelay > 0 ? "+" : ""}${w.finishDelay} días)` : ""}` : "Sin fecha proyectada",
  ];
  if (w.plan) lines.push(`Plan cumplido (PPC): <b>${w.plan.ppc == null ? "—" : pct(w.plan.ppc)}</b> · ${w.plan.done} de ${w.plan.committed} tareas`);
  if (w.production.length)
    lines.push("", "<b>Producción</b>", ...w.production.slice(0, 6).map((p) => `• ${esc(p.name)}: ${p.qty != null ? `${n1(p.qty)} ${esc(p.unit ?? "")}` : `${p.activities} actividad(es)`}`));
  if (w.lateTotal) lines.push("", `<b>Atrasadas (${w.lateTotal})</b>: ${w.late.slice(0, 4).map((l) => `${esc(l.name)} (${l.count})`).join(", ")}`);
  if (w.causes.length) lines.push("", `<b>Causas</b>: ${w.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h`).join(" · ")}`);
  const blocks = w.blockers.constraints.length + w.blockers.impeditive.length + w.blockers.materials.length;
  lines.push("", `Hallazgos: ${w.findingsOpened} nuevo(s), ${w.findingsClosed} cerrado(s), ${w.findingsOpen} abierto(s) · Bloqueos: ${blocks}`);
  lines.push("", `<a href="${webUrl}/semanal">Ver en la web</a> · informe completo en el PDF`);
  return lines.join("\n");
}

export async function buildWeekPdf(w: WeekReport, generatedAt: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Informe semanal ${w.projectName} ${w.weekStart}`);
  doc.setAuthor("AvanceObra");
  doc.setLanguage("es-CO");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = new Writer(doc, font, bold, `AvanceObra · ${w.projectName} · semana ${w.weekStart}`);
  p.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: BLUE });
  p.text("Informe semanal de obra", { size: 18, bold: true });
  p.text(w.projectName, { size: 12, bold: true });
  p.text(
    `Semana del ${w.weekStart} al ${w.weekEnd}${w.contractEnd ? ` · fecha contractual ${w.contractEnd}` : ""} · generado ${new Date(generatedAt.getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ")} (hora de Colombia)`,
    { size: 9, color: MUTED },
  );

  p.section("Resumen");
  const kpis: [string, string][] = [
    ["Avance real", pct(w.actualEnd)],
    ["En la semana", pts(w.actualEnd - w.actualStart)],
    ["Programado", pct(w.plannedEnd)],
    ["SPI", pct(w.spi)],
    ["Fin proyectado", w.projectedFinish ?? "Sin fecha"],
    ["PPC", w.plan?.ppc == null ? "—" : pct(w.plan.ppc)],
  ];
  p.ensure(36);
  const colW = (A4[0] - 2 * M) / kpis.length;
  const top = p.y;
  kpis.forEach(([k, v], i) => {
    p.page.drawText(winAnsi(k.toUpperCase()), { x: M + i * colW, y: top - 10, size: 7.5, font: bold, color: MUTED });
    p.page.drawText(p.fit(v, bold, 11, colW - 6), { x: M + i * colW, y: top - 25, size: 11, font: bold });
  });
  p.y = top - 30;
  p.text(
    `${w.entries} registro(s) de avance en la semana · ${n1(w.lostHours)} h perdidas.` +
      (w.finishDelay != null && w.finishDelay !== 0 ? ` Fin proyectado ${Math.abs(w.finishDelay)} días ${w.finishDelay > 0 ? "después" : "antes"} de la fecha contractual.` : ""),
    { size: 9 },
  );

  p.section("Producción de la semana");
  if (w.production.length)
    p.table(
      [
        { title: "Grupo / actividad", width: 330 },
        { title: "Cantidad", width: 110, align: "right" },
        { title: "Actividades", width: 75, align: "right" },
      ],
      w.production.slice(0, 40).map((x) => ({ cells: [x.name, x.qty != null ? `${n1(x.qty)} ${x.unit ?? ""}` : "varias unidades", String(x.activities)] })),
    );
  else p.text("Sin registros de avance en la semana.", { size: 9 });

  p.section("Atrasadas al cierre de la semana");
  if (w.late.length)
    p.table(
      [
        { title: "Grupo / actividad", width: 400 },
        { title: "Actividades atrasadas", width: 115, align: "right" },
      ],
      w.late.slice(0, 30).map((l) => ({ cells: [l.name, String(l.count)], color: (i: number) => (i === 1 ? LIGHT_COLOR.red : undefined) })),
    );
  else p.text("Ninguna actividad atrasada.", { size: 9 });

  if (w.plan) {
    p.section("Plan semanal");
    p.text(`Comprometidas ${w.plan.committed} · cumplidas ${w.plan.done} · PPC ${w.plan.ppc == null ? "—" : pct(w.plan.ppc)}`, { size: 9 });
    if (w.plan.causes.length) p.text(`Causas de incumplimiento: ${w.plan.causes.map((c) => `${PLAN_CAUSE_LABEL[c.cause] ?? c.cause} (${c.count})`).join(" · ")}`, { size: 9 });
  }

  p.section("Pérdidas de tiempo");
  p.text(w.causes.length ? w.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h (${pct(c.pct)})`).join(" · ") : "Sin pérdidas reportadas.", { size: 9 });

  p.section("Hallazgos y bloqueos");
  p.text(`Hallazgos: ${w.findingsOpened} nuevo(s) y ${w.findingsClosed} cerrado(s) en la semana; ${w.findingsOpen} abierto(s).`, { size: 9 });
  const b = w.blockers;
  if (!b.constraints.length && !b.impeditive.length && !b.materials.length) p.text("Nada bloquea la obra.", { size: 9 });
  b.constraints.slice(0, 10).forEach((c) => p.text(`Restricción: ${c.description}${c.needBy ? ` (para ${c.needBy})` : ""}`, { size: 9 }));
  b.impeditive.slice(0, 10).forEach((d) => p.text(`Impeditivo: ${d}`, { size: 9 }));
  b.materials.forEach((m) => p.text(`Material por agotarse: ${m}`, { size: 9 }));
  return doc.save();
}
