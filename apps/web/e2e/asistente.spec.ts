import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

const REPORT = {
  front_code: null,
  progress: [{ activity_code: "BA-HIN", quantity: 120, note: "fila 4" }],
  personnel: [{ role: "Oficial de obra", qty: 4 }],
  equipment: [{ name: "Hincadora", qty: 2 }],
  rain: [{ start: "10:00", end: "11:30" }],
  findings: [{ description: "Pilote torcido en la fila 4", type: "quality", severity: "medium" }],
  observations: "",
  unmatched: ["Actividad «limpieza» (1)"],
};

function withAi(db: ReturnType<typeof buildDb>) {
  db.functions = {
    ...db.functions,
    "ai-assist": (body) => {
      if (body.action === "parse_report") return [200, { report: REPORT, transcript: body.text }];
      if (body.action === "summary")
        return [200, { text: "La obra va en 50 %. • Revisar el frente A esta semana.", ungrounded: [], model: "muse-spark" }];
      if (body.action === "verify_entry")
        return [
          200,
          {
            entry_id: body.entry_id,
            status: "revisar",
            reported: 8,
            sam_count: 3,
            sam_concept: "metal post",
            vision_count: 3,
            matches_activity: true,
            comment: "Se ven tres pilotes hincados.",
            photos: [],
            checked_at: new Date().toISOString(),
          },
        ];
      if (body.action === "defect")
        return [
          200,
          {
            analysis: { is_defect: true, type: "quality", severity: "high", title: "Óxido en pilote", description: "Corrosión en la base.", corrective_action: "Limpiar y galvanizar en frío.", sam_concept: "rust" },
            marks: { width: 10, height: 10, boxes: [{ x1: 1, y1: 1, x2: 5, y2: 5, c: 0.9 }] },
          },
        ];
      return [400, { error: "Acción desconocida." }];
    },
  };
  return db;
}

test("asistente: el texto dictado llena el parte y se guarda", async ({ page }) => {
  const writes = await mockSupabase(page, withAi(buildDb()));
  await page.goto("/asistente");
  await page.getByLabel("Lo que pasó hoy").fill("hoy hincamos ciento veinte pilotes con dos hincadoras y cuatro oficiales, llovió de diez a once y media");
  await page.getByRole("button", { name: "✨ Llenar el parte con IA" }).click();
  await expect(page.getByText("BA-HIN: 120")).toBeVisible();
  await expect(page.getByText("4 Oficial de obra")).toBeVisible();
  await expect(page.getByText("🌧 10:00 – 11:30")).toBeVisible();
  await expect(page.getByText("Pilote torcido en la fila 4")).toBeVisible();
  await expect(page.getByText(/No se pudo ubicar: Actividad «limpieza»/)).toBeVisible();
  expect(writes.find((w) => w.table === "fn:ai-assist")?.body).toMatchObject({ action: "parse_report" });
  await page.getByRole("button", { name: "Guardar parte diario" }).click();
  await expect(page.getByText(/Parte diario guardado/)).toBeVisible();
  expect(writes.find((w) => w.table === "daily_logs")?.body).toMatchObject({
    personnel: [{ role: "Oficial de obra", qty: 4 }],
    equipment: [{ name: "Hincadora", qty: 2 }],
    rain: [{ start: "10:00", end: "11:30" }],
    observations: "Hallazgo: Pilote torcido en la fila 4",
  });
});

test("asistente: la foto de un defecto vuelve clasificada, marcada y con acción correctiva", async ({ page }) => {
  const writes = await mockSupabase(page, withAi(buildDb()));
  await page.goto("/asistente");
  // PNG de 1×1
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel("Foto").setInputFiles({ name: "punch.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "✨ Analizar con IA" }).click();
  await expect(page.getByRole("heading", { name: "Óxido en pilote" })).toBeVisible();
  await expect(page.getByText("Severidad Alta")).toBeVisible();
  await expect(page.getByText("Limpiar y galvanizar en frío.")).toBeVisible();
  await expect(page.getByText("1 zona(s) marcadas («rust»)")).toBeVisible();
  expect(String((writes.find((w) => w.table === "fn:ai-assist")?.body as Record<string, unknown>).image_base64).length).toBeGreaterThan(50);
});

test("registros: verificar un registro con IA muestra el dictamen", async ({ page }) => {
  const writes = await mockSupabase(page, withAi(buildDb()));
  await page.goto("/registros");
  await page.getByRole("button", { name: "Verificar con IA" }).first().click();
  await expect(page.getByText("Se ven tres pilotes hincados.")).toBeVisible();
  await expect(page.getByText(/SAM 3.1 contó/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver verificación con IA" })).toHaveText("IA: revisar");
  expect(writes.find((w) => w.table === "fn:ai-assist")?.body).toMatchObject({ action: "verify_entry" });
});

test("gerencia: resumen ejecutivo con IA escrito solo con las cifras del tablero", async ({ page }) => {
  const db = withAi(buildDb());
  Object.assign(db.tables, { weekly_plans: [], weekly_plan_items: [], materials: [], material_usage: [], material_deliveries: [], payment_certificates: [], simulations: [] });
  const writes = await mockSupabase(page, db);
  await page.goto("/gerencia");
  await page.getByRole("button", { name: /^Resumen con IA de / }).click();
  await expect(page.getByText("La obra va en 50 %.", { exact: false })).toBeVisible();
  const facts = (writes.find((w) => w.table === "fn:ai-assist")?.body as Record<string, unknown>).facts as Record<string, unknown>;
  expect(facts).toMatchObject({ obra: "Parque Solar Prueba", hallazgos_criticos_abiertos: 1 });
  expect(String(facts.avance_real)).toMatch(/%$/);
});
