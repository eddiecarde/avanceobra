import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sendTelegramDocument } from "../functions/_shared/channels.ts";
import { bogotaDate, buildDailyReport, reportTelegramHtml, type RawDashboard } from "../functions/_shared/report.ts";
import { buildReportPdf, winAnsi } from "../functions/_shared/report_pdf.ts";

const DAY = "2026-10-21";
// Calendario de 7 días sin festivos: aritmética simple
const raw = (over: Partial<RawDashboard> = {}): RawDashboard => ({
  project: { id: "p1", name: "Parque Solar Demo", start_date: "2026-10-01", contract_end_date: "2026-10-31", workdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] },
  activities: [
    { id: "a", code: "BA-HIN", name: "Hincado de pilotes", unit: "pilotes", contract_qty: 100, planned_start: "2026-10-01", planned_finish: "2026-10-10", front: { code: "BA", name: "Bloque A" } },
    { id: "b", code: "BB-MON", name: "Montaje <trackers>", unit: "trackers", contract_qty: 10, planned_start: "2026-10-11", planned_finish: "2026-10-20", front: { code: "BB", name: "Bloque B" } },
  ],
  entries: [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      activity_id: "a",
      work_date: `2026-10-${String(12 + i).padStart(2, "0")}`,
      quantity: 9,
      effective_hours: 8,
      lost_hours: i === 9 ? 2 : 0,
      loss_cause: i === 9 ? "weather" : "none",
      weather: i === 9 ? "heavy_rain" : "sunny",
      crew_size: 6,
      notes: i === 9 ? "Lluvia fuerte en la tarde" : "",
    })),
  ],
  findings: [
    { id: "f1", type: "safety", severity: "critical", status: "open", description: "Zanja sin señalizar", due_date: "2026-10-15", created_at: "2026-10-14T15:00:00Z", closed_at: null },
    { id: "f2", type: "quality", severity: "low", status: "closed", description: "Rotulado", due_date: null, created_at: "2026-10-20T15:00:00Z", closed_at: "2026-10-21T20:00:00Z" },
    // 22 de octubre a las 2 a. m. UTC = 21 de octubre a las 9 p. m. en Colombia
    { id: "f3", type: "quality", severity: "medium", status: "open", description: "Pilote fuera de plomo", due_date: "2026-10-25", created_at: "2026-10-22T02:00:00Z", closed_at: null },
  ],
  ...over,
});

describe("cálculo del informe diario", () => {
  const r = buildDailyReport(raw(), DAY);

  it("resumen del día", () => {
    expect(r.entries).toBe(1);
    expect(r.crew).toBe(6);
    expect(r.effectiveHours).toBe(8);
    expect(r.lostHours).toBe(2);
    expect(r.weather).toBe("heavy_rain");
    expect(r.notes).toEqual([{ code: "BA-HIN", text: "Lluvia fuerte en la tarde" }]);
    expect(r.lossesToday).toEqual([{ cause: "weather", hours: 2 }]);
    expect(r.weekCauses[0]).toMatchObject({ cause: "weather", hours: 2, pct: 1 });
  });

  it("avance ponderado y semáforos", () => {
    // BA-HIN: 90 de 100 (90 %); BB-MON: 0 de 10 → global 45 %; ambas debían ir al 100 %
    expect(r.actualPct).toBeCloseTo(0.45);
    expect(r.plannedPct).toBeCloseTo(1);
    const hin = r.rows.find((x) => x.code === "BA-HIN")!;
    expect(hin.dayQty).toBe(9);
    expect(hin.light).toBe("red");
    expect(r.stalled).toEqual(["BB-MON"]);
  });

  it("hallazgos con la fecha de Colombia, no la UTC", () => {
    expect(bogotaDate("2026-10-22T02:00:00Z")).toBe("2026-10-21");
    expect(r.findingsOpened).toBe(1);
    expect(r.findingsClosed).toBe(1);
    expect(r.openFindings.map((f) => [f.severity, f.overdue])).toEqual([
      ["critical", true],
      ["medium", false],
    ]);
  });

  it("día sin registros", () => {
    const empty = buildDailyReport(raw(), "2026-10-25");
    expect(empty.entries).toBe(0);
    expect(reportTelegramHtml(empty, "https://web")).toContain("Hoy no hubo registros de avance");
  });
});

describe("mensaje de Telegram", () => {
  const html = reportTelegramHtml(buildDailyReport(raw(), DAY), "https://avanceobra.test");
  it("incluye lo esencial y escapa el HTML", () => {
    expect(html).toContain("<b>Informe diario · Parque Solar Demo</b>");
    expect(html).toContain("Avance real <b>45 %</b> de 100 % programado");
    expect(html).toContain("• BA-HIN: 9 pilotes");
    expect(html).toContain("<b>Atrasadas (2)</b>");
    expect(html).toContain("Clima 2 h");
    expect(html).toContain("<b>1 vencido(s)</b>");
    expect(html).toContain('href="https://avanceobra.test/informe?p=p1&d=2026-10-21"');
    expect(html).not.toContain("<trackers>");
    expect(html.length).toBeLessThan(4096); // límite de Telegram
  });
});

describe("PDF", () => {
  it("se genera en A4, legible y con los textos del informe", async () => {
    const bytes = await buildReportPdf(buildDailyReport(raw(), DAY), new Date("2026-10-21T23:00:00Z"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2); // cuerpo + anexos
    expect(doc.getTitle()).toBe("Informe diario Parque Solar Demo 2026-10-21");
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });

  it("pagina cuando hay muchas actividades", async () => {
    const many = raw({
      activities: Array.from({ length: 80 }, (_, i) => ({
        id: `x${i}`,
        code: `X-${i}`,
        name: `Actividad ${i} con un nombre bastante largo para recortar`,
        unit: "m",
        contract_qty: 100,
        planned_start: "2026-10-01",
        planned_finish: "2026-10-30",
        front: null,
      })),
    });
    const doc = await PDFDocument.load(await buildReportPdf(buildDailyReport(many, DAY)));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("reemplaza los símbolos que Helvetica no codifica", () => {
    expect(winAnsi("A → B ■ ✓ ñáé · 5 %")).toBe("A -> B   ñáé · 5 %");
    expect(winAnsi("中")).toBe("?");
  });
});

describe("envío del PDF por Telegram", () => {
  it("multipart con chat, leyenda y documento", async () => {
    let url = "";
    let form: FormData | null = null;
    const fake = (async (u: string, init: RequestInit) => {
      url = u;
      form = init.body as FormData;
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    const r = await sendTelegramDocument("TOKEN", "123", new Uint8Array([37, 80, 68, 70]), "informe.pdf", "Informe", fake);
    expect(r.ok).toBe(true);
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendDocument");
    expect(form!.get("chat_id")).toBe("123");
    expect((form!.get("document") as File).name).toBe("informe.pdf");
  });
});
