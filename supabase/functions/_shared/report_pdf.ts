/**
 * PDF del informe diario (A4) con pdf-lib, sin navegador: corre en la Edge Function.
 * En Vitest "npm:pdf-lib@1.17.1" se resuelve al paquete instalado (ver vitest.config.mjs).
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import { FINDING_TYPE_LABEL, LIGHT_LABEL, LOSS_LABEL, n1, pct, SEVERITY_LABEL, WEATHER_LABEL, type DailyReport } from "./report.ts";

export const A4: [number, number] = [595.28, 841.89];
export const M = 40; // margen
export const BLUE = rgb(0.11, 0.31, 0.85);
export const INK = rgb(0.09, 0.09, 0.11);
export const MUTED = rgb(0.4, 0.4, 0.43);
const RULE = rgb(0.85, 0.85, 0.87);
export const LIGHT_COLOR = { red: rgb(0.8, 0.15, 0.15), amber: rgb(0.85, 0.55, 0), green: rgb(0.09, 0.6, 0.25), done: BLUE, not_started: MUTED, no_plan: MUTED };

/** Helvetica estándar solo codifica WinAnsi: se reemplazan los símbolos que no tiene. */
export function winAnsi(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/[■●▲○✓⚠📋]/gu, "")
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€\n]/g, "?");
}

export class Writer {
  page!: PDFPage;
  y = 0;
  pages = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages++;
    this.y = A4[1] - M;
    this.page.drawText(winAnsi(`${this.footer} · página ${this.pages}`), { x: M, y: 22, size: 8, font: this.font, color: MUTED });
  }
  ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    for (const line of this.wrap(winAnsi(s), font, size, opts.maxWidth ?? A4[0] - 2 * M - ((opts.x ?? M) - M))) {
      this.ensure(size + 4);
      this.y -= size + 3;
      this.page.drawText(line, { x: opts.x ?? M, y: this.y, size, font, color: opts.color ?? INK });
    }
  }
  wrap(s: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  fit(s: string, font: PDFFont, size: number, width: number) {
    let t = winAnsi(s);
    if (font.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
    return `${t}…`;
  }
  section(title: string) {
    this.ensure(40);
    this.y -= 14;
    this.text(title.toUpperCase(), { size: 10, bold: true });
    this.y -= 3;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 1.2, color: INK });
    this.y -= 2;
  }
  /** Tabla simple: columnas con ancho fijo; las celdas largas se recortan con "…". */
  table(cols: { title: string; width: number; align?: "right" }[], rows: { cells: string[]; color?: (i: number) => ReturnType<typeof rgb> | undefined }[]) {
    const size = 8.5;
    const row = (cells: string[], font: PDFFont, color?: (i: number) => ReturnType<typeof rgb> | undefined) => {
      this.ensure(16);
      this.y -= 13;
      let x = M;
      cells.forEach((c, i) => {
        const w = cols[i]!.width;
        const t = this.fit(c, font, size, w - 6);
        const tx = cols[i]!.align === "right" ? x + w - 6 - font.widthOfTextAtSize(t, size) : x;
        this.page.drawText(t, { x: tx, y: this.y, size, font, color: color?.(i) ?? INK });
        x += w;
      });
      this.page.drawLine({ start: { x: M, y: this.y - 4 }, end: { x: A4[0] - M, y: this.y - 4 }, thickness: 0.5, color: RULE });
    };
    row(cols.map((c) => c.title.toUpperCase()), this.bold, () => MUTED);
    rows.forEach((r) => row(r.cells, this.font, r.color));
  }
}

export async function buildReportPdf(r: DailyReport, generatedAt: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Informe diario ${r.projectName} ${r.day}`);
  doc.setAuthor("AvanceObra");
  doc.setLanguage("es-CO");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `AvanceObra · ${r.projectName} · ${r.day}`);

  // Encabezado
  w.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: BLUE });
  w.text("Informe diario de obra", { size: 18, bold: true });
  w.text(r.projectName, { size: 12, bold: true });
  w.text(
    `${r.day}${r.contractEnd ? ` · fecha contractual ${r.contractEnd}` : ""} · generado ${new Date(generatedAt.getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ")} (hora de Colombia)`,
    { size: 9, color: MUTED },
  );

  w.section("Resumen");
  const kpis: [string, string][] = [
    ["Avance real", pct(r.actualPct)],
    ["Programado", pct(r.plannedPct)],
    ["SPI", pct(r.spi)],
    ["Fin proyectado", r.projectedFinish ?? "Sin fecha"],
    ["Personal", String(r.crew)],
    ["Clima", r.weather ? (WEATHER_LABEL[r.weather] ?? r.weather) : "—"],
  ];
  w.ensure(36);
  const colW = (A4[0] - 2 * M) / kpis.length;
  const top = w.y;
  kpis.forEach(([k, v], i) => {
    w.page.drawText(winAnsi(k.toUpperCase()), { x: M + i * colW, y: top - 10, size: 7.5, font: bold, color: MUTED });
    w.page.drawText(w.fit(v, bold, 11, colW - 6), { x: M + i * colW, y: top - 25, size: 11, font: bold, color: INK });
  });
  w.y = top - 30;
  w.text(
    (r.finishDelay != null && r.finishDelay !== 0
      ? `Fin proyectado ${Math.abs(r.finishDelay)} días ${r.finishDelay > 0 ? "después" : "antes"} de la fecha contractual. `
      : "") +
      `${r.entries} registro(s) de avance · ${n1(r.effectiveHours)} h efectivas · ${n1(r.lostHours)} h perdidas.` +
      (r.stalled.length ? ` Sin avance en los últimos 14 días: ${r.stalled.join(", ")}.` : ""),
    { size: 9 },
  );

  w.section("Producción del día por actividad");
  w.table(
    [
      { title: "Actividad", width: 190 },
      { title: "Hoy", width: 70, align: "right" },
      { title: "Real / prog.", width: 80, align: "right" },
      { title: "Ritmo / necesario", width: 100, align: "right" },
      { title: "Estado", width: 75 },
    ],
    r.rows.map((x) => ({
      cells: [
        `${x.code} · ${x.name}`,
        x.dayQty > 0 ? `${n1(x.dayQty)} ${x.unit}` : "—",
        `${pct(x.actualPct)} / ${pct(x.plannedPct)}`,
        `${n1(x.dailyRate)}${x.requiredRate != null ? ` / ${Number.isFinite(x.requiredRate) ? n1(x.requiredRate) : "∞"}` : ""}`.replace("∞", "sin plazo"),
        LIGHT_LABEL[x.light],
      ],
      color: (i) => (i === 4 ? LIGHT_COLOR[x.light] : undefined),
    })),
  );
  w.text("Ritmo = promedio de los últimos 14 días; necesario = para terminar en la fecha planeada.", { size: 7.5, color: MUTED });

  w.section("Pérdidas de tiempo");
  w.text(r.lossesToday.length ? `Hoy: ${r.lossesToday.map((l) => `${LOSS_LABEL[l.cause] ?? l.cause} ${n1(l.hours)} h`).join(" · ")}` : "Hoy: sin pérdidas reportadas.", { size: 9 });
  w.text(
    r.weekCauses.length ? `Principales causas de la semana: ${r.weekCauses.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h (${pct(c.pct)})`).join(" · ")}` : "Semana: sin pérdidas.",
    { size: 9 },
  );

  w.section("Hallazgos");
  w.text(`Nuevos hoy: ${r.findingsOpened} · Cerrados hoy: ${r.findingsClosed} · Abiertos: ${r.openFindings.length} (${r.openFindings.filter((f) => f.overdue).length} vencidos)`, { size: 9 });
  if (r.openFindings.length)
    w.table(
      [
        { title: "Severidad", width: 60 },
        { title: "Descripción", width: 300 },
        { title: "Tipo", width: 70 },
        { title: "Límite", width: 85 },
      ],
      r.openFindings.slice(0, 15).map((f) => ({
        cells: [SEVERITY_LABEL[f.severity] ?? f.severity, f.description, FINDING_TYPE_LABEL[f.type] ?? f.type, f.dueDate ? `${f.dueDate}${f.overdue ? " vencido" : ""}` : "—"],
        color: (i) => (i === 3 && f.overdue ? LIGHT_COLOR.red : undefined),
      })),
    );

  if (r.notes.length) {
    w.section("Notas de campo");
    r.notes.slice(0, 20).forEach((n) => w.text(`${n.code}: ${n.text}`, { size: 9 }));
  }

  // Firmas
  w.ensure(70);
  w.y -= 55;
  for (const [i, label] of ["Residente de obra", "Director de obra"].entries()) {
    const x = M + i * 270;
    w.page.drawLine({ start: { x, y: w.y }, end: { x: x + 220, y: w.y }, thickness: 0.8, color: INK });
    w.page.drawText(label, { x, y: w.y - 12, size: 9, font, color: INK });
  }
  return doc.save();
}
