// Informes que se envían solos: resumen de la noche y semanal (texto y PDF).
import { describe, expect, it } from "vitest";
import { buildDailyReport, nightSummaryHtml, type RawDashboard } from "../functions/_shared/report.ts";
import { buildWeekPdf, buildWeekReport, weekTelegramHtml } from "../functions/_shared/weekly.ts";

const raw = (grouped = false): RawDashboard => ({
  project: { id: "p1", name: "Parque Solar Demo", start_date: "2026-10-01", contract_end_date: "2026-10-31", workdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] },
  activities: [
    { id: "a", code: "BA-HIN", name: "Hincado", unit: "pilotes", contract_qty: 100, planned_start: "2026-10-01", planned_finish: "2026-10-10", work_group: grouped ? "Hincas" : null, front: { code: "BA", name: "Bloque A" } },
    { id: "b", code: "BB-HIN", name: "Hincado", unit: "pilotes", contract_qty: 100, planned_start: "2026-10-01", planned_finish: "2026-10-10", work_group: grouped ? "Hincas" : null, front: { code: "BB", name: "Bloque B" } },
  ],
  entries: Array.from({ length: 14 }, (_, i) => ({
    id: `e${i}`,
    activity_id: i % 2 ? "b" : "a",
    work_date: `2026-10-${String(12 + Math.floor(i / 2)).padStart(2, "0")}`,
    quantity: 5,
    effective_hours: 8,
    lost_hours: i === 0 ? 3 : 0,
    loss_cause: i === 0 ? "material" : "none",
    weather: "sunny",
    crew_size: 4,
  })),
  findings: [
    { id: "f1", type: "quality", severity: "high", status: "open", description: "Pilote <torcido>", due_date: null, created_at: "2026-10-13T15:00:00Z", closed_at: null, category: "no_conformidad", impeditive: true },
  ],
});
const blockers = { constraints: [{ description: "Falta permiso de servidumbre", needBy: "2026-10-20" }], impeditive: ["Pilote <torcido>"], materials: ["Pilotes"] };

describe("resumen de la noche", () => {
  it("dice lo hecho hoy, lo atrasado y lo que bloquea, y escapa el HTML", () => {
    const html = nightSummaryHtml(buildDailyReport(raw(), "2026-10-18"), blockers, "https://web");
    expect(html).toContain("<b>Resumen del día · Parque Solar Demo</b>");
    expect(html).toContain("✅ <b>Hecho hoy</b>: 2 registro(s) · 8 personas");
    expect(html).toContain("• BA-HIN: 5 pilotes");
    expect(html).toContain("⚠️ <b>Atrasado</b>");
    expect(html).toContain("• Restricción: Falta permiso de servidumbre (para 2026-10-20)");
    expect(html).toContain("• Impeditivo: Pilote &lt;torcido&gt;");
    expect(html).toContain("• Material por agotarse: Pilotes");
    expect(html.length).toBeLessThan(4096);
  });
  it("en una planta por grupos resume por grupo, no por actividad", () => {
    const html = nightSummaryHtml(buildDailyReport(raw(true), "2026-10-18"), { constraints: [], impeditive: [], materials: [] }, "https://web");
    expect(html).toContain("• Hincas: 10 pilotes");
    expect(html).toContain("⛔ <b>Lo que bloquea</b>: nada abierto");
  });
});

describe("informe semanal", () => {
  const w = buildWeekReport(raw(true), "2026-10-12", { plan: { committed: 4, done: 3, causes: [{ cause: "material", count: 1 }] }, blockers });
  it("avance de la semana, producción por grupo, PPC y causas", () => {
    expect(w.weekEnd).toBe("2026-10-18");
    expect(w.entries).toBe(14);
    expect(w.production).toEqual([{ name: "Hincas", qty: 70, unit: "pilotes", activities: 2 }]);
    expect(w.actualEnd - w.actualStart).toBeCloseTo(0.35);
    expect(w.plan?.ppc).toBe(0.75);
    expect(w.causes[0]).toMatchObject({ cause: "material", hours: 3 });
    expect(w.findingsOpened).toBe(1);
    const html = weekTelegramHtml(w, "https://web");
    expect(html).toContain("<b>Informe semanal · Parque Solar Demo</b>");
    expect(html).toContain("Plan cumplido (PPC): <b>75 %</b> · 3 de 4 tareas");
    expect(html).toContain("• Hincas: 70 pilotes");
    expect(html.length).toBeLessThan(4096);
  });
  it("arma un PDF válido", async () => {
    const pdf = await buildWeekPdf(w, new Date("2026-10-19T12:00:00Z"));
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
