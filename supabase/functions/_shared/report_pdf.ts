/**
 * PDF de los informes (A4) con pdf-lib, sin navegador: corre en la Edge Function.
 * En Vitest "npm:pdf-lib@1.17.1" se resuelve al paquete instalado (ver vitest.config.mjs).
 * El escritor repite el encabezado de las tablas al cambiar de página, ajusta el texto largo en
 * varias líneas (no lo corta) y numera "Página X de Y" al final.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "npm:pdf-lib@1.17.1";
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_ORDER,
  reportStatusRules,
  type DailyAnalysis,
  type Observation,
  type ReportActivityRow,
  type ReportStatus,
  type Situation,
} from "./engine.js";
import { FINDING_TYPE_LABEL, LOSS_LABEL, n1, pct, SEVERITY_LABEL, WEATHER_LABEL, type DailyReport } from "./report.ts";

export const A4: [number, number] = [595.28, 841.89];
export const M = 36; // margen
const W = A4[0] - 2 * M;
const BOTTOM = M + 18;
export const NAVY = rgb(0.122, 0.227, 0.373);
export const BLUE = NAVY;
export const INK = rgb(0.09, 0.09, 0.11);
export const MUTED = rgb(0.4, 0.4, 0.43);
const FAINT = rgb(0.55, 0.55, 0.57);
const RULE = rgb(0.86, 0.86, 0.88);
const PANEL = rgb(0.965, 0.968, 0.975);
const HEAD = rgb(0.93, 0.935, 0.945);
const GROUP = rgb(0.933, 0.949, 0.969);
const RED = rgb(0.78, 0.13, 0.13);
const AMBER = rgb(0.85, 0.55, 0);
const GREEN = rgb(0.05, 0.55, 0.3);
const ORANGE = rgb(0.92, 0.41, 0.2);
export const LIGHT_COLOR = {
  red: RED,
  amber: AMBER,
  green: GREEN,
  done: rgb(0.15, 0.39, 0.92),
  not_started: MUTED,
  no_plan: MUTED,
};
export const STATUS_COLOR: Record<ReportStatus, RGB> = {
  atrasada: RED,
  sin_avance: rgb(0.92, 0.45, 0.05),
  sin_registros: rgb(0.48, 0.3, 0.8),
  en_riesgo: AMBER,
  al_dia: GREEN,
  terminada: rgb(0.15, 0.39, 0.92),
  por_iniciar: rgb(0.7, 0.7, 0.72),
  sin_programa: rgb(0.8, 0.8, 0.82),
};
export const TONE_COLOR = {
  critical: RED,
  warning: AMBER,
  info: NAVY,
  good: GREEN,
  neutral: rgb(0.75, 0.75, 0.77),
};
/** Paleta categórica de los gráficos (misma que la web). */
export const CAT = [rgb(0.165, 0.471, 0.839), rgb(0.922, 0.408, 0.204), rgb(0.106, 0.686, 0.478), rgb(0.929, 0.631, 0), rgb(0.91, 0.482, 0.643)];

/** Helvetica estándar solo codifica WinAnsi: se reemplazan los símbolos que no tiene. */
export function winAnsi(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/−/g, "-")
    .replace(/[■●▲▼◆○✓⚠📋]/gu, "")
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€\n]/g, "?");
}

/** 2026-10-15 → 15/10/2026 */
export const dmy = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
export const pts = (x: number | null | undefined, digits = 1) =>
  x == null || !Number.isFinite(x) ? "No calculable" : `${x > 0 ? "+" : ""}${x.toLocaleString("es-CO", { maximumFractionDigits: digits })} pts`;
export const bogotaStamp = (t: Date) => {
  const s = new Date(t.getTime() - 5 * 3_600_000).toISOString();
  return `${dmy(s.slice(0, 10))} ${s.slice(11, 16)}`;
};

export interface Col {
  title: string;
  /** Peso relativo del ancho. */
  w: number;
  align?: "right";
}
export interface TRow {
  cells: string[];
  color?: (i: number) => RGB | undefined;
  bold?: boolean;
  /** Línea completa debajo de la fila (p. ej. la recomendación). */
  note?: string;
  /** Fila de grupo (título que ocupa todo el ancho). */
  group?: string;
}

export class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    public doc: PDFDocument,
    public font: PDFFont,
    public bold: PDFFont,
    private running: string,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    this.page.drawRectangle({
      x: 0,
      y: A4[1] - 5,
      width: A4[0],
      height: 5,
      color: NAVY,
    });
    this.page.drawText(this.fit(this.running, this.font, 7.5, W), {
      x: M,
      y: A4[1] - 22,
      size: 7.5,
      font: this.font,
      color: MUTED,
    });
    this.y = A4[1] - 34;
  }
  /** Pie con "Página X de Y" en todas las páginas (se llama al final). */
  finish(left = "AvanceObra") {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const t = `Página ${i + 1} de ${pages.length}`;
      p.drawLine({
        start: { x: M, y: M - 2 },
        end: { x: A4[0] - M, y: M - 2 },
        thickness: 0.5,
        color: RULE,
      });
      p.drawText(winAnsi(left), {
        x: M,
        y: M - 13,
        size: 7.5,
        font: this.font,
        color: FAINT,
      });
      p.drawText(winAnsi(t), {
        x: A4[0] - M - this.font.widthOfTextAtSize(winAnsi(t), 7.5),
        y: M - 13,
        size: 7.5,
        font: this.font,
        color: MUTED,
      });
    });
  }
  /** Asegura espacio; devuelve true si abrió página nueva. */
  ensure(h: number) {
    if (this.y - h < BOTTOM) {
      this.newPage();
      return true;
    }
    return false;
  }
  text(
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: RGB;
      x?: number;
      maxWidth?: number;
      gap?: number;
    } = {},
  ) {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? M;
    for (const line of this.wrap(winAnsi(s), font, size, opts.maxWidth ?? A4[0] - M - x)) {
      this.ensure(size + 4);
      this.y -= size + (opts.gap ?? 3);
      this.page.drawText(line, {
        x,
        y: this.y,
        size,
        font,
        color: opts.color ?? INK,
      });
    }
  }
  /** Texto con una etiqueta de origen al inicio ("CALCULADO", "RECOMENDACIÓN"…). */
  tagged(tag: string, s: string, tagColor: RGB, opts: { size?: number; x?: number } = {}) {
    const size = opts.size ?? 8.5;
    const x0 = opts.x ?? M;
    const label = winAnsi(tag.toUpperCase());
    const tw = this.bold.widthOfTextAtSize(label, size - 1.5) + 6;
    const lines = this.wrap(winAnsi(s), this.font, size, A4[0] - M - x0 - tw - 4);
    lines.forEach((line, i) => {
      this.ensure(size + 4);
      this.y -= size + 3;
      if (i === 0) {
        this.page.drawRectangle({
          x: x0,
          y: this.y - 2,
          width: tw,
          height: size + 2,
          color: tagColor,
          opacity: 0.15,
        });
        this.page.drawText(label, {
          x: x0 + 3,
          y: this.y,
          size: size - 1.5,
          font: this.bold,
          color: tagColor,
        });
      }
      this.page.drawText(line, {
        x: x0 + tw + 4,
        y: this.y,
        size,
        font: this.font,
        color: INK,
      });
    });
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
      // Palabra más ancha que la columna: se parte
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > width) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
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
  section(n: string | null, title: string, note?: string) {
    this.ensure(60);
    this.y -= 16;
    const t = winAnsi(`${n ? `${n}  ` : ""}${title}`.toUpperCase());
    this.page.drawText(t, {
      x: M,
      y: this.y,
      size: 10.5,
      font: this.bold,
      color: NAVY,
    });
    if (note) {
      const nt = this.fit(note, this.font, 7.5, W - this.bold.widthOfTextAtSize(t, 10.5) - 12);
      this.page.drawText(nt, {
        x: A4[0] - M - this.font.widthOfTextAtSize(nt, 7.5),
        y: this.y,
        size: 7.5,
        font: this.font,
        color: MUTED,
      });
    }
    this.y -= 5;
    this.page.drawLine({
      start: { x: M, y: this.y },
      end: { x: A4[0] - M, y: this.y },
      thickness: 1.4,
      color: NAVY,
    });
    this.y -= 4;
  }
  /** Tarjetas KPI en rejilla. */
  kpis(
    cards: {
      label: string;
      value: string;
      sub?: string;
      tone?: keyof typeof TONE_COLOR;
      bar?: { actual: number; planned: number };
    }[],
    cols = 4,
  ) {
    const gap = 6;
    const cw = (W - gap * (cols - 1)) / cols;
    for (let r = 0; r < cards.length; r += cols) {
      const row = cards.slice(r, r + cols);
      const subLines = row.map((c) => (c.sub ? this.wrap(winAnsi(c.sub), this.font, 7, cw - 14).slice(0, 2) : []));
      const h = 34 + Math.max(0, ...subLines.map((l) => l.length)) * 8.5 + (row.some((c) => c.bar) ? 5 : 0);
      this.ensure(h + gap);
      const top = this.y;
      row.forEach((c, i) => {
        const x = M + i * (cw + gap);
        this.page.drawRectangle({
          x,
          y: top - h,
          width: cw,
          height: h,
          color: PANEL,
          borderColor: RULE,
          borderWidth: 0.6,
        });
        this.page.drawRectangle({
          x,
          y: top - h,
          width: 3,
          height: h,
          color: TONE_COLOR[c.tone ?? "info"],
        });
        this.page.drawText(this.fit(c.label.toUpperCase(), this.bold, 6.8, cw - 14), { x: x + 9, y: top - 11, size: 6.8, font: this.bold, color: MUTED });
        this.page.drawText(this.fit(c.value, this.bold, 13, cw - 14), {
          x: x + 9,
          y: top - 26,
          size: 13,
          font: this.bold,
          color: INK,
        });
        let yy = top - 26;
        if (c.bar) {
          yy -= 6;
          const bw = cw - 18;
          this.page.drawRectangle({
            x: x + 9,
            y: yy - 1,
            width: bw,
            height: 3,
            color: RULE,
          });
          this.page.drawRectangle({
            x: x + 9,
            y: yy - 1,
            width: Math.max(0.5, bw * Math.min(1, c.bar.actual)),
            height: 3,
            color: NAVY,
          });
          this.page.drawRectangle({
            x: x + 9 + bw * Math.min(1, c.bar.planned) - 0.7,
            y: yy - 3,
            width: 1.4,
            height: 7,
            color: ORANGE,
          });
        }
        subLines[i]!.forEach((l, k) =>
          this.page.drawText(l, {
            x: x + 9,
            y: yy - 10 - k * 8.5,
            size: 7,
            font: this.font,
            color: MUTED,
          }),
        );
      });
      this.y = top - h - gap;
    }
  }
  /** Barra de estados con leyenda (todas suman el total del programa). */
  statusStrip(counts: Record<ReportStatus, number>, total: number) {
    this.ensure(34);
    const top = this.y - 2;
    let x = M;
    for (const s of REPORT_STATUS_ORDER) {
      if (!counts[s]) continue;
      const w = (W * counts[s]) / Math.max(1, total);
      this.page.drawRectangle({
        x,
        y: top - 6,
        width: Math.max(0.5, w - 1),
        height: 6,
        color: STATUS_COLOR[s],
      });
      x += w;
    }
    let lx = M;
    let ly = top - 17;
    for (const s of REPORT_STATUS_ORDER) {
      const t = winAnsi(`${REPORT_STATUS_LABEL[s]} ${counts[s]}`);
      const tw = this.font.widthOfTextAtSize(t, 7.5) + 18;
      if (lx + tw > A4[0] - M) {
        lx = M;
        ly -= 10;
      }
      this.page.drawRectangle({
        x: lx,
        y: ly - 0.5,
        width: 6,
        height: 6,
        color: STATUS_COLOR[s],
        opacity: counts[s] ? 1 : 0.35,
      });
      this.page.drawText(t, {
        x: lx + 9,
        y: ly,
        size: 7.5,
        font: counts[s] ? this.bold : this.font,
        color: counts[s] ? INK : FAINT,
      });
      lx += tw;
    }
    this.y = ly - 6;
  }
  situations(list: Situation[], empty: string) {
    if (!list.length) return this.text(empty, { size: 9, color: MUTED });
    for (const s of list) {
      this.ensure(40);
      this.y -= 4;
      const top = this.y;
      this.page.drawRectangle({
        x: M,
        y: top - 9,
        width: 6,
        height: 6,
        color: TONE_COLOR[s.tone],
      });
      this.text(s.title, { size: 9, bold: true, x: M + 12 });
      if (s.evidence)
        this.tagged("Calculado", s.evidence, rgb(0.03, 0.4, 0.62), {
          x: M + 12,
        });
      if (s.action) this.tagged("Recomendación", s.action, GREEN, { x: M + 12 });
      this.y -= 3;
      this.page.drawLine({
        start: { x: M, y: this.y },
        end: { x: A4[0] - M, y: this.y },
        thickness: 0.4,
        color: RULE,
      });
    }
  }
  /** Tabla: el encabezado se repite en cada página y las celdas largas se ajustan (hasta 3 líneas). */
  table(cols: Col[], rows: TRow[], opts: { size?: number } = {}) {
    const size = opts.size ?? 7.8;
    const lh = size + 2.2;
    const total = cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => (W * c.w) / total);
    const head = () => {
      const lines = cols.map((c, i) => this.wrap(winAnsi(c.title.toUpperCase()), this.bold, 6.6, widths[i]! - 5));
      const h = Math.max(...lines.map((l) => l.length)) * 8 + 6;
      this.page.drawRectangle({
        x: M,
        y: this.y - h,
        width: W,
        height: h,
        color: HEAD,
      });
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) => {
          const tx = cols[i]!.align === "right" ? x + widths[i]! - 3 - this.bold.widthOfTextAtSize(l, 6.6) : x + 3;
          this.page.drawText(l, {
            x: tx,
            y: this.y - h + 4 + (ls.length - 1 - k) * 8,
            size: 6.6,
            font: this.bold,
            color: MUTED,
          });
        });
        x += widths[i]!;
      });
      this.y -= h;
    };
    this.ensure(40);
    head();
    for (const r of rows) {
      if (r.group != null) {
        if (this.ensure(lh * 3)) head();
        this.page.drawRectangle({
          x: M,
          y: this.y - lh - 3,
          width: W,
          height: lh + 3,
          color: GROUP,
        });
        this.page.drawText(this.fit(r.group, this.bold, size, W - 6), {
          x: M + 3,
          y: this.y - lh,
          size,
          font: this.bold,
          color: NAVY,
        });
        this.y -= lh + 3;
        continue;
      }
      const font = r.bold ? this.bold : this.font;
      const lines = r.cells.map((c, i) => {
        const ls = this.wrap(winAnsi(c), font, size, widths[i]! - 5);
        return ls.length > 3 ? [...ls.slice(0, 2), this.fit(ls.slice(2).join(" "), font, size, widths[i]! - 5)] : ls;
      });
      const noteLines = r.note ? this.wrap(winAnsi(r.note), this.font, size - 0.6, W - 70) : [];
      const h = Math.max(...lines.map((l) => l.length)) * lh + 4 + noteLines.length * lh;
      if (this.ensure(h + 2)) head();
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) => {
          const f = k > 0 && i === 0 && !r.bold ? this.font : font;
          const tx = cols[i]!.align === "right" ? x + widths[i]! - 3 - f.widthOfTextAtSize(l, size) : x + 3;
          this.page.drawText(l, {
            x: tx,
            y: this.y - lh * (k + 1) + 1,
            size,
            font: f,
            color: r.color?.(i) ?? INK,
          });
        });
        x += widths[i]!;
      });
      const rowsH = Math.max(...lines.map((l) => l.length)) * lh;
      noteLines.forEach((l, k) => {
        const yy = this.y - rowsH - lh * (k + 1);
        if (k === 0)
          this.page.drawText("Recomendación:", {
            x: M + 3,
            y: yy,
            size: size - 0.8,
            font: this.bold,
            color: GREEN,
          });
        this.page.drawText(l, {
          x: M + 66,
          y: yy,
          size: size - 0.6,
          font: this.font,
          color: rgb(0.25, 0.25, 0.28),
        });
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: M, y: this.y },
        end: { x: A4[0] - M, y: this.y },
        thickness: 0.4,
        color: RULE,
      });
    }
    this.y -= 2;
  }
  observations(items: Observation[]) {
    const rules = reportStatusRules();
    this.text("Criterios del semáforo", { size: 8.5, bold: true });
    for (const s of REPORT_STATUS_ORDER) {
      this.ensure(12);
      this.page.drawRectangle({
        x: M,
        y: this.y - 8.5,
        width: 6,
        height: 6,
        color: STATUS_COLOR[s],
      });
      this.text(`${REPORT_STATUS_LABEL[s]}: ${rules[s]}`, {
        size: 7.8,
        x: M + 10,
      });
    }
    this.y -= 4;
    this.text("Cálculos y observaciones de los datos", {
      size: 8.5,
      bold: true,
    });
    for (const t of [
      "Avance global = suma ponderada del avance de cada actividad con cantidad y fechas programadas (cada una limitada al 100 %).",
      "Programado = reparto lineal de la cantidad en días laborables entre el inicio y el fin planeados. Desviación = real - programado, en puntos porcentuales; SPI = real ÷ programado.",
      "Ritmo = cantidad de los últimos 14 días ÷ días laborables; necesario = pendiente ÷ días laborables hasta el fin planeado.",
      "Los datos faltantes no se cuentan como cero: se muestran como «No disponible» o «No calculable».",
    ])
      this.text(`• ${t}`, { size: 7.8, color: rgb(0.25, 0.25, 0.28) });
    for (const o of items)
      this.text(`• ${o.kind === "dato" ? "Dato a revisar: " : ""}${o.text}`, {
        size: 7.8,
        bold: o.kind === "dato",
        color: o.kind === "dato" ? rgb(0.55, 0.3, 0) : rgb(0.25, 0.25, 0.28),
      });
  }
  signatures(signers: string[]) {
    this.ensure(70);
    this.y -= 50;
    const cw = (W - 30) / 2;
    signers.forEach((label, i) => {
      if (i > 0 && i % 2 === 0) {
        this.ensure(60);
        this.y -= 50;
      }
      const x = M + (i % 2) * (cw + 30);
      this.page.drawLine({
        start: { x, y: this.y },
        end: { x: x + cw, y: this.y },
        thickness: 0.8,
        color: INK,
      });
      this.page.drawText(winAnsi(label.toUpperCase()), {
        x,
        y: this.y - 11,
        size: 8,
        font: this.bold,
        color: INK,
      });
      this.page.drawText("Nombre, firma y fecha", {
        x,
        y: this.y - 20,
        size: 7,
        font: this.font,
        color: MUTED,
      });
    });
    this.y -= 26;
  }

  // ----------------------------------------------------------- gráficos
  private axes(x: number, y: number, w: number, h: number, max: number, fmt: (v: number) => string, ticks = 4) {
    for (let i = 0; i <= ticks; i++) {
      const v = (max * i) / ticks;
      const yy = y + (h * i) / ticks;
      this.page.drawLine({
        start: { x, y: yy },
        end: { x: x + w, y: yy },
        thickness: 0.4,
        color: RULE,
      });
      const t = winAnsi(fmt(v));
      this.page.drawText(t, {
        x: x - 4 - this.font.widthOfTextAtSize(t, 6.5),
        y: yy - 2,
        size: 6.5,
        font: this.font,
        color: MUTED,
      });
    }
  }
  /** Marco de gráfico con título, subtítulo y leyenda; devuelve el área de dibujo. */
  chartFrame(x: number, w: number, h: number, title: string, subtitle: string, legend: { label: string; color: RGB; dashed?: boolean; bar?: boolean }[]) {
    const top = this.y;
    this.page.drawRectangle({
      x,
      y: top - h,
      width: w,
      height: h,
      borderColor: RULE,
      borderWidth: 0.6,
    });
    this.page.drawText(this.fit(title, this.bold, 8.5, w - 12), {
      x: x + 6,
      y: top - 12,
      size: 8.5,
      font: this.bold,
      color: INK,
    });
    this.page.drawText(this.fit(subtitle, this.font, 6.8, w - 12), {
      x: x + 6,
      y: top - 21,
      size: 6.8,
      font: this.font,
      color: MUTED,
    });
    let lx = x + 6;
    let ly = top - 31;
    for (const l of legend) {
      const t = this.fit(l.label, this.font, 6.8, w - 30);
      const tw = this.font.widthOfTextAtSize(t, 6.8) + 22;
      if (lx + tw > x + w - 4) {
        lx = x + 6;
        ly -= 9;
      }
      if (l.bar)
        this.page.drawRectangle({
          x: lx,
          y: ly - 0.5,
          width: 6,
          height: 6,
          color: l.color,
        });
      else
        this.page.drawLine({
          start: { x: lx, y: ly + 2.5 },
          end: { x: lx + 12, y: ly + 2.5 },
          thickness: 1.8,
          color: l.color,
          dashArray: l.dashed ? [3, 2] : undefined,
        });
      this.page.drawText(t, {
        x: lx + (l.bar ? 9 : 15),
        y: ly,
        size: 6.8,
        font: this.font,
        color: INK,
      });
      lx += tw;
    }
    return {
      x: x + 34,
      y: top - h + 16,
      w: w - 42,
      h: ly - (top - h + 16) - 10,
    };
  }
  lineChart(
    area: { x: number; y: number; w: number; h: number },
    labels: string[],
    series: {
      color: RGB;
      values: (number | null)[];
      dashed?: boolean;
      width?: number;
      dots?: boolean;
    }[],
    max: number,
    fmt: (v: number) => string,
    marks: { at: number; label: string; color: RGB }[] = [],
  ) {
    const { x, y, w, h } = area;
    this.axes(x, y, w, h, max, fmt);
    const n = Math.max(1, labels.length - 1);
    const px = (i: number) => x + (w * i) / n;
    const py = (v: number) => y + (h * Math.min(v, max)) / max;
    const every = Math.max(1, Math.ceil(labels.length / 7));
    labels.forEach((l, i) => {
      if (i % every && i !== labels.length - 1) return;
      const t = winAnsi(l);
      this.page.drawText(t, {
        x: px(i) - this.font.widthOfTextAtSize(t, 6.5) / 2,
        y: y - 10,
        size: 6.5,
        font: this.font,
        color: MUTED,
      });
    });
    for (const m of marks) {
      this.page.drawLine({
        start: { x: px(m.at), y },
        end: { x: px(m.at), y: y + h },
        thickness: 0.8,
        color: m.color,
        dashArray: [3, 2],
      });
      this.page.drawText(winAnsi(m.label), {
        x: px(m.at) + 2,
        y: y + h - 7,
        size: 6.5,
        font: this.bold,
        color: INK,
      });
    }
    for (const s of series) {
      for (let i = 1; i < s.values.length; i++) {
        const a = s.values[i - 1];
        const b = s.values[i];
        if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        this.page.drawLine({
          start: { x: px(i - 1), y: py(a) },
          end: { x: px(i), y: py(b) },
          thickness: s.width ?? 1.4,
          color: s.color,
          dashArray: s.dashed ? [3, 2] : undefined,
        });
      }
      if (s.dots)
        s.values.forEach((v, i) => {
          if (v != null && Number.isFinite(v))
            this.page.drawCircle({
              x: px(i),
              y: py(v),
              size: 2.2,
              color: s.color,
              borderColor: rgb(1, 1, 1),
              borderWidth: 0.8,
            });
        });
    }
  }
  barChart(
    area: { x: number; y: number; w: number; h: number },
    labels: string[],
    stacks: { color: RGB; values: number[] }[],
    fmt: (v: number) => string,
    line?: { color: RGB; values: (number | null)[]; dashed?: boolean },
    opts: { integer?: boolean } = {},
  ) {
    const { x, y, w, h } = area;
    const totals = labels.map((_, i) => stacks.reduce((s, st) => s + Math.max(0, st.values[i] ?? 0), 0));
    const top = Math.max(...totals, ...(line?.values.filter((v): v is number => v != null) ?? []), 0);
    const max = opts.integer ? ceil4(top) : niceMax(top);
    this.axes(x, y, w, h, max, fmt);
    const band = w / Math.max(1, labels.length);
    const bw = Math.min(22, band * 0.6);
    labels.forEach((l, i) => {
      const cx = x + band * i + band / 2;
      let acc = 0;
      for (const st of stacks) {
        const v = Math.max(0, st.values[i] ?? 0);
        if (!v) continue;
        this.page.drawRectangle({
          x: cx - bw / 2,
          y: y + (h * acc) / max,
          width: bw,
          height: Math.max(0.3, (h * v) / max - 0.6),
          color: st.color,
        });
        acc += v;
      }
      const t = winAnsi(l);
      this.page.drawText(t, {
        x: cx - this.font.widthOfTextAtSize(t, 6.3) / 2,
        y: y - 10,
        size: 6.3,
        font: this.font,
        color: MUTED,
      });
    });
    if (line)
      for (let i = 1; i < line.values.length; i++) {
        const a = line.values[i - 1];
        const b = line.values[i];
        if (a == null || b == null) continue;
        this.page.drawLine({
          start: { x: x + band * (i - 1) + band / 2, y: y + (h * a) / max },
          end: { x: x + band * i + band / 2, y: y + (h * b) / max },
          thickness: 1.2,
          color: line.color,
          dashArray: line.dashed === false ? undefined : [3, 2],
        });
      }
  }
  ratioBars(area: { x: number; y: number; w: number; h: number }, rows: { label: string; ratio: number }[]) {
    const labelW = 150;
    const rowH = Math.min(14, area.h / Math.max(1, rows.length));
    const maxR = Math.max(1.2, ...rows.map((r) => Math.min(r.ratio, 3)));
    const bx = area.x - 30 + labelW;
    const bw = area.w + 30 - labelW - 30;
    const px = (r: number) => bx + (bw * Math.min(r, 3)) / maxR;
    rows.forEach((r, i) => {
      const yy = area.y + area.h - (i + 1) * rowH;
      this.page.drawText(this.fit(r.label, this.font, 6.8, labelW - 8), {
        x: area.x - 30,
        y: yy + 3,
        size: 6.8,
        font: this.font,
        color: INK,
      });
      const color = r.ratio >= 1 ? GREEN : r.ratio >= 0.8 ? AMBER : RED;
      this.page.drawRectangle({
        x: bx,
        y: yy + 1,
        width: Math.max(1, px(r.ratio) - bx),
        height: rowH - 4,
        color,
      });
      this.page.drawText(`${Math.round(r.ratio * 100)} %`, {
        x: px(r.ratio) + 3,
        y: yy + 3,
        size: 6.5,
        font: this.font,
        color: MUTED,
      });
    });
    this.page.drawLine({
      start: { x: px(1), y: area.y - 2 },
      end: { x: px(1), y: area.y + area.h },
      thickness: 0.8,
      color: INK,
      dashArray: [3, 2],
    });
    this.page.drawText("100 % = ritmo necesario", {
      x: px(1) - 30,
      y: area.y - 10,
      size: 6.5,
      font: this.bold,
      color: INK,
    });
  }
}

/** Máximo del eje para conteos: múltiplo de 4 (4 divisiones enteras). */
export const ceil4 = (v: number) => Math.max(4, Math.ceil(v / 4) * 4);

export const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};

/** Encabezado de la primera página: tipo de informe, proyecto, periodo y datos de generación. */
export function reportHeader(w: Writer, kind: string, project: string, period: string, right: string[]) {
  w.page.drawText(winAnsi(kind.toUpperCase()), {
    x: M,
    y: w.y - 8,
    size: 8,
    font: w.bold,
    color: MUTED,
  });
  w.y -= 10;
  w.text(project, { size: 16, bold: true, maxWidth: W - 230 });
  w.text(period, { size: 9.5, color: INK });
  right.forEach((t, i) => {
    const s = w.fit(t, w.font, 7.5, 230);
    w.page.drawText(s, {
      x: A4[0] - M - w.font.widthOfTextAtSize(s, 7.5),
      y: A4[1] - 46 - i * 10,
      size: 7.5,
      font: w.font,
      color: MUTED,
    });
  });
  w.y -= 6;
  w.page.drawLine({
    start: { x: M, y: w.y },
    end: { x: A4[0] - M, y: w.y },
    thickness: 2.2,
    color: NAVY,
  });
  w.y -= 2;
}

const longDate = (d: string) => {
  const s = new Date(`${d}T12:00:00Z`).toLocaleDateString("es-CO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** Porcentaje sin decimales para columnas angostas. */
const pct0 = (x: number) => `${Math.round(x * 100)} %`;
/** Texto del estado en tablas: los grises claros de la barra no se leen como texto. */
const statusText = (s: ReportStatus) => (s === "por_iniciar" || s === "sin_programa" ? MUTED : STATUS_COLOR[s]);
const spiTxt = (spi: number | null) => (spi == null ? "SPI no calculable" : `SPI ${spi.toLocaleString("es-CO", { maximumFractionDigits: 2 })}`);
const rateTxt = (r: ReportActivityRow) => `${n1(r.dailyRate)} / ${r.requiredRate == null ? "—" : Number.isFinite(r.requiredRate) ? n1(r.requiredRate) : "vencida"}`;
const front = (r: ReportActivityRow) => [r.front ? (r.frontName ? `${r.front} · ${r.frontName}` : r.front) : null, r.group].filter(Boolean).join(" · ");

/** Tabla de actividades prioritarias con la recomendación debajo de cada una. */
export function priorityTable(w: Writer, rows: ReportActivityRow[]) {
  w.table(
    [
      { title: "Actividad", w: 34 },
      { title: "Real / prog.", w: 11, align: "right" },
      { title: "Desv.", w: 8, align: "right" },
      { title: "Pendiente", w: 12, align: "right" },
      { title: "Ritmo / necesario (u/día)", w: 13, align: "right" },
      { title: "Último registro", w: 10, align: "right" },
      { title: "Estado", w: 12 },
    ],
    rows.map((r) => ({
      cells: [
        `${r.code} · ${r.name}${front(r) ? `\n${front(r)}` : ""}`,
        `${pct0(r.actualPct)} / ${pct0(r.plannedPct)}`,
        pts(r.gapPts, 0),
        `${n1(r.pendingQty)} ${r.unit}`,
        rateTxt(r),
        r.lastUpdate ? dmy(r.lastUpdate) : "Nunca",
        REPORT_STATUS_LABEL[r.status],
      ],
      color: (i: number) => (i === 6 || (i === 2 && r.gapPts <= -15) ? statusText(r.status) : undefined),
      note: r.action ?? undefined,
    })),
  );
}

/** Anexo: actividades agrupadas por grupo de trabajo o frente. En obras muy grandes se omiten las terminadas y por iniciar (quedan en la web). */
export function fullAnnex(w: Writer, rows: ReportActivityRow[], webHint: string) {
  const grouped = rows.some((r) => r.group);
  const big = rows.length > 300;
  const shown = big ? rows.filter((r) => r.status !== "terminada" && r.status !== "por_iniciar") : rows;
  if (big)
    w.text(`Obra con ${rows.length} actividades: se listan las ${shown.length} que no están terminadas ni por iniciar. El detalle completo está en ${webHint}.`, {
      size: 8,
      color: MUTED,
    });
  const groups = new Map<string, ReportActivityRow[]>();
  for (const r of shown) {
    const k = (grouped ? r.group : r.front ? (r.frontName ? `${r.front} · ${r.frontName}` : r.front) : null) ?? "Sin frente";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const trs: TRow[] = [];
  for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    trs.push({
      cells: [],
      group: `${g} · ${list.length} actividad(es) · ${list.filter((r) => r.status === "atrasada").length} atrasada(s)`,
    });
    for (const r of [...list].sort((a, b) => REPORT_STATUS_ORDER.indexOf(a.status) - REPORT_STATUS_ORDER.indexOf(b.status) || a.code.localeCompare(b.code)))
      trs.push({
        cells: [
          r.code,
          r.name,
          pct0(r.actualPct),
          r.plannedStart ? pct0(r.plannedPct) : "—",
          r.plannedStart ? pts(r.gapPts, 0) : "—",
          `${n1(r.executedQty)} ${r.unit}`,
          n1(r.pendingQty),
          REPORT_STATUS_LABEL[r.status],
          r.lastUpdate ? dmy(r.lastUpdate) : "—",
        ],
        color: (i: number) => (i === 7 ? statusText(r.status) : undefined),
      });
  }
  w.table(
    [
      { title: "Código", w: 12 },
      { title: "Descripción", w: 25 },
      { title: "Real", w: 7, align: "right" },
      { title: "Prog.", w: 7, align: "right" },
      { title: "Desv.", w: 8, align: "right" },
      { title: "Ejecutado", w: 12, align: "right" },
      { title: "Pendiente", w: 9, align: "right" },
      { title: "Estado", w: 11 },
      { title: "Últ. registro", w: 9, align: "right" },
    ],
    trs,
    { size: 7.2 },
  );
}

export async function buildReportPdf(r: DailyReport, generatedAt: Date = new Date()): Promise<Uint8Array> {
  const a: DailyAnalysis = r.analysis;
  const doc = await PDFDocument.create();
  doc.setTitle(`Informe diario ${r.projectName} ${r.day}`);
  doc.setAuthor("AvanceObra");
  doc.setLanguage("es-CO");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `${r.projectName} · Informe diario de obra · corte ${dmy(r.day)}`);

  reportHeader(w, "Informe diario de obra", r.projectName, `Fecha de corte: ${longDate(r.day)}${a.workday ? "" : " · día no laborable"}`, [
    `Generado ${bogotaStamp(generatedAt)} (hora de Colombia)`,
  ]);

  w.section("1", "Resumen ejecutivo");
  const gain = a.production.reduce((s, p) => s + p.gainPts, 0);
  w.kpis([
    {
      label: "Avance real",
      value: pct(a.actual),
      sub: `Programado ${pct(a.planned)}`,
      bar: { actual: a.actual, planned: a.planned },
    },
    {
      label: "Desviación",
      value: a.planned > 0 || a.actual > 0 ? pts(a.deviationPts) : "No calculable",
      tone: a.deviationPts <= -15 ? "critical" : a.deviationPts <= -5 ? "warning" : "good",
      sub: `${spiTxt(a.spi)} (real ÷ programado)`,
    },
    {
      label: "Fecha contractual",
      value: a.contractEnd ? dmy(a.contractEnd) : "No disponible",
      tone: "neutral",
    },
    {
      label: "Fin proyectado",
      value: a.projectedFinish ? dmy(a.projectedFinish) : "No calculable",
      tone: a.finishDelay != null && a.finishDelay > 0 ? "critical" : a.projectedFinish ? "good" : "warning",
      sub: a.projectedFinish
        ? a.finishDelay == null
          ? "Sin fecha contractual"
          : a.finishDelay > 0
            ? `${a.finishDelay} días después de la contractual`
            : a.finishDelay < 0
              ? `${-a.finishDelay} días antes de la contractual`
              : "En la fecha contractual"
        : `${a.stalledCodes.length} actividad(es) con saldo sin ritmo`,
    },
    {
      label: "Producción del día",
      value: a.entries ? `${a.entries} registro(s)` : "Sin registros",
      tone: a.entries ? "info" : a.workday ? "warning" : "neutral",
      sub: a.entries ? `Avance aportado ${pts(gain, 2)} · ${a.production.length} frente(s)` : a.workday ? "Día laborable sin avance reportado" : "Día no laborable",
    },
    r.dayLog
      ? { label: "Personal reportado", value: String(r.dayLog.personnel), tone: "neutral", sub: `Parte diario · ${r.dayLog.equipment} equipo(s)` }
      : {
          label: "Personal reportado",
          value: a.entries ? String(a.crew) : "No disponible",
          tone: "neutral",
          sub: a.entries ? "Suma de cuadrillas de los registros (sin parte diario)" : "Sin parte diario ni registros",
        },
    {
      label: "Horas del día",
      value: a.entries ? `${n1(a.effectiveHours)} h` : "No disponible",
      tone: a.lostHours > 0 ? "warning" : "neutral",
      sub: a.entries ? `${n1(a.lostHours)} h perdidas · clima ${a.weather ? (WEATHER_LABEL[a.weather] ?? a.weather) : "no reportado"}` : undefined,
    },
    {
      label: "Hallazgos abiertos",
      value: String(a.findings.open.length),
      tone: a.findings.impeditive ? "critical" : a.findings.overdue ? "warning" : "neutral",
      sub: `${a.findings.overdue} vencido(s) · ${a.findings.impeditive} impeditivo(s) · hoy +${a.findings.opened.length} / -${a.findings.closed.length}`,
    },
  ]);
  w.statusStrip(a.snapshot.counts, a.snapshot.rows.length);
  w.text(`Pendientes: ${a.snapshot.rows.length - a.snapshot.counts.terminada} de ${a.snapshot.rows.length} actividades.`, { size: 8, color: MUTED });

  w.section("2", "Situaciones del día", "De la más grave a la menos");
  w.situations(a.situations, "Sin situaciones que destacar.");

  w.section("3", "Actividades que requieren atención", a.priority.length > 15 ? `15 de ${a.priority.length} · el resto en el anexo A` : `${a.priority.length} actividad(es)`);
  if (a.priority.length) priorityTable(w, a.priority.slice(0, 15));
  else
    w.text("Ninguna actividad atrasada, en riesgo o sin avance.", {
      size: 9,
      color: MUTED,
    });

  w.section("4", "Producción del día");
  if (a.entries) {
    w.table(
      [
        {
          title: a.snapshot.rows.some((x) => x.group) ? "Grupo de trabajo" : "Frente",
          w: 40,
        },
        { title: "Actividades", w: 12, align: "right" },
        { title: "Cantidad ejecutada", w: 32 },
        { title: "Avance aportado", w: 16, align: "right" },
      ],
      a.production.map((p) => ({
        cells: [p.label, String(p.activities), p.qtyByUnit.map((q) => `${n1(q.qty)} ${q.unit}`).join(" · "), pts(p.gainPts, 2)],
      })),
    );
    w.y -= 6;
    w.table(
      [
        { title: "Actividad", w: 40 },
        { title: "Hoy", w: 13, align: "right" },
        { title: "Ejecutado", w: 14, align: "right" },
        { title: "Pendiente", w: 13, align: "right" },
        { title: "Real / prog.", w: 10, align: "right" },
        { title: "Estado", w: 12 },
      ],
      a.snapshot.rows
        .filter((x) => x.periodQty !== 0)
        .sort((x, y) => (x.front ?? "").localeCompare(y.front ?? "") || x.code.localeCompare(y.code))
        .map((x) => ({
          cells: [
            `${x.code} · ${x.name}`,
            `${n1(x.periodQty)} ${x.unit}`,
            `${n1(x.executedQty)} ${x.unit}`,
            `${n1(x.pendingQty)} ${x.unit}`,
            `${pct0(x.actualPct)} / ${x.plannedStart ? pct0(x.plannedPct) : "—"}`,
            REPORT_STATUS_LABEL[x.status],
          ],
          color: (i: number) => (i === 5 ? statusText(x.status) : undefined),
        })),
    );
  } else w.text(a.workday ? "No hay registros de avance enviados o aprobados con esta fecha." : "Día no laborable sin registros.", { size: 9, color: MUTED });

  w.section("5", "Pérdidas de tiempo");
  w.tagged(
    "Registrado",
    `Hoy: ${a.lossesToday.length ? a.lossesToday.map((l) => `${LOSS_LABEL[l.cause] ?? l.cause} ${n1(l.hours)} h`).join(" · ") : "sin pérdidas reportadas"}.`,
    MUTED,
  );
  w.tagged(
    "Calculado",
    `Últimos 7 días: ${a.weekCauses.length ? a.weekCauses.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause} ${n1(c.hours)} h (${pct(c.pct)})`).join(" · ") : "sin pérdidas"}.`,
    rgb(0.03, 0.4, 0.62),
  );

  w.section("6", "Hallazgos y riesgos", `Abiertos al corte: ${a.findings.open.length} · nuevos hoy ${a.findings.opened.length} · cerrados hoy ${a.findings.closed.length}`);
  if (a.findings.open.length)
    w.table(
      [
        { title: "Severidad", w: 11 },
        { title: "Descripción", w: 55 },
        { title: "Tipo", w: 12 },
        { title: "Fecha límite", w: 22 },
      ],
      a.findings.open.slice(0, 15).map((f) => ({
        cells: [
          SEVERITY_LABEL[f.severity] ?? f.severity,
          `${f.description}${f.impeditive ? " [IMPEDITIVO]" : ""}${f.createdAt === r.day ? " [NUEVO]" : ""}`,
          FINDING_TYPE_LABEL[f.type] ?? f.type,
          f.dueDate ? `${dmy(f.dueDate)}${f.overdue ? " · vencido" : ""}` : "Sin fecha",
        ],
        color: (i: number) => (i === 3 && f.overdue ? RED : undefined),
      })),
    );
  else w.text("Sin hallazgos abiertos.", { size: 9, color: MUTED });
  if (a.findings.open.length > 15) w.text(`Y ${a.findings.open.length - 15} hallazgo(s) más de menor severidad en la web.`, { size: 7.5, color: MUTED });

  if (a.notes.length) {
    w.section("7", "Notas de campo");
    a.notes.slice(0, 25).forEach((nt) => w.text(`${nt.code}: ${nt.text}`, { size: 8.5 }));
  }

  w.signatures(["Residente de obra", "Director de obra"]);

  w.newPage();
  w.section(null, "Anexo A · Seguimiento de actividades", `${a.snapshot.rows.length} actividades al ${dmy(r.day)}`);
  fullAnnex(w, a.snapshot.rows, "la web (Informe diario)");
  w.section(null, "Anexo B · Criterios y observaciones de los datos");
  w.observations(a.observations);
  w.finish(`AvanceObra · ${r.projectName}`);
  return doc.save();
}

export type { RGB };
