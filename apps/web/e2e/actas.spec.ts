import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase, USER, type MockDb } from "./mock";

/** Obra con precios: BA-HIN a $80.000 el pilote; BA-MON a $1.000.000 (cliente) y $700.000 (subcontrato). */
function pricedDb(): MockDb {
  const db = buildDb();
  Object.assign(db.tables.activities!.find((a) => a.code === "BA-HIN")!, { unit_price: 80000 });
  Object.assign(db.tables.activities!.find((a) => a.code === "BA-MON")!, { unit_price: 1_000_000, subcontract_unit_price: 700_000 });
  db.tables.payment_certificates = [];
  return db;
}

test("acta de cobro al cliente: lo aprobado × precio, con retención, y se emite numerada", async ({ page }) => {
  const writes = await mockSupabase(page, pricedDb());
  await page.goto("/actas");
  await expect(page.getByRole("heading", { name: "Actas de corte y cobro" })).toBeVisible();
  await expect(page.getByText("2 ítem(s) sin precio")).toBeVisible();
  // BA-HIN: 104 pilotes aprobados (los 16 enviados aún no cuentan) × $80.000
  const row = page.getByRole("row", { name: /^BA-HIN/ });
  await expect(row).toContainText("104");
  await expect(row).toContainText("$8.320.000");
  await page.getByLabel(/Retención/).fill("5");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Emitir acta N° 1" }).click();
  await expect(page.getByText(/Acta N° 1 emitida/)).toBeVisible();
  const body = writes.find((w) => w.table === "payment_certificates" && w.method === "POST")?.body as {
    number: number;
    company_id: string | null;
    retention_pct: number;
    lines: { code: string; periodQty: number }[];
    totals: { periodAmount: number; retentionAmount: number; netAmount: number };
    issued_by: string;
  };
  expect(body).toMatchObject({ number: 1, company_id: null, retention_pct: 0.05, issued_by: USER.id });
  expect(body.lines.map((l) => l.code).sort()).toEqual(["BA-HIN", "BA-MON"]);
  expect(body.totals.retentionAmount).toBeCloseTo(body.totals.periodAmount * 0.05, 2);
  expect(body.totals.netAmount).toBeCloseTo(body.totals.periodAmount * 0.95, 2);
});

test("la segunda acta cobra solo lo aprobado desde la anterior", async ({ page }) => {
  const db = pricedDb();
  db.tables.payment_certificates = [
    {
      id: "pc1",
      project_id: PROJECT_ID,
      company_id: null,
      number: 1,
      period_start: day(-30),
      period_end: day(-8),
      status: "emitida",
      retention_pct: 0,
      advance_pct: 0,
      lines: [
        { id: "a1", code: "BA-HIN", name: "Hincado de pilotes", unit: "pilotes", contractQty: 200, unitPrice: 80000, previousQty: 0, periodQty: 60, cumulativeQty: 60, contractAmount: 16_000_000, previousAmount: 0, periodAmount: 4_800_000, cumulativeAmount: 4_800_000, balanceAmount: 11_200_000, exceeds: false },
      ],
      totals: { contractAmount: 16_000_000, previousAmount: 0, periodAmount: 4_800_000, cumulativeAmount: 4_800_000, balanceAmount: 11_200_000, retentionPct: 0, retentionAmount: 0, advancePct: 0, advanceAmount: 0, netAmount: 4_800_000, financialProgress: 0.3 },
      issued_at: `${day(-7)}T15:00:00Z`,
      notes: null,
      void_reason: null,
      client_status: "aprobada",
      client_note: null,
      client_decided_name: "Laura Gómez (Helios)",
    },
  ];
  await mockSupabase(page, db);
  await page.goto("/actas");
  await expect(page.getByRole("button", { name: "Emitir acta N° 2" })).toBeVisible();
  await expect(page.getByText(/continúa la N° 1/)).toBeVisible();
  await expect(page.getByRole("row", { name: /^1 / })).toContainText("Cliente: aprobada");
  // 104 aprobados − 60 ya cobrados = 44 × $80.000
  const row = page.getByRole("row", { name: /^BA-HIN/ });
  await expect(row).toContainText("44");
  await expect(row).toContainText("$3.520.000");
  await expect(page.getByRole("row", { name: /^1 / })).toContainText("Emitida");
  // El acta emitida se descarga en Excel y se abre lista para imprimir o guardar en PDF
  const download = page.waitForEvent("download");
  await page.getByRole("row", { name: /^1 / }).getByRole("button", { name: "Excel" }).click();
  expect((await download).suggestedFilename()).toBe("acta-1.xlsx");
  await page.getByRole("row", { name: /^1 / }).getByRole("link", { name: "Ver / PDF" }).click();
  await expect(page.getByRole("heading", { name: "ACTA DE CORTE N° 1" })).toBeVisible();
  await expect(page.getByText("NETO A PAGAR")).toBeVisible();
});

test("acta de pago al subcontratista: solo sus actividades, a su precio", async ({ page }) => {
  await mockSupabase(page, pricedDb());
  await page.goto("/actas");
  await page.getByLabel("Acta para").selectOption({ label: "Contratista: Constructora Demo" });
  await expect(page.getByRole("row", { name: /^BA-HIN/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /^BA-MON/ })).toContainText("$700.000");
});

test("precios unitarios: se editan en la tabla y se guardan", async ({ page }) => {
  const writes = await mockSupabase(page, pricedDb());
  await page.goto("/actas");
  await page.getByRole("button", { name: "Precios unitarios" }).click();
  await page.getByLabel("Precio unitario de BB-ZAN").fill("25.000");
  await page.getByRole("button", { name: /Guardar 1 cambio/ }).click();
  await expect(page.getByText("1 ítem(s) con precio actualizado.")).toBeVisible();
  expect(writes.find((w) => w.table === "activities" && w.method === "PATCH")?.body).toMatchObject({ unit_price: 25000 });
});

test("acta con AIU e IVA sobre la utilidad: valor del acta y neto con la retención antes de IVA", async ({ page }) => {
  const writes = await mockSupabase(page, pricedDb());
  await page.goto("/actas");
  await page.getByLabel(/Administración/).fill("10");
  await page.getByLabel(/Imprevistos/).fill("5");
  await page.getByLabel(/Utilidad/).fill("5");
  await page.getByRole("combobox", { name: "IVA" }).selectOption("utility");
  await expect(page.getByText("Valor del acta", { exact: true })).toBeVisible();
  await page.getByLabel(/Retención/).fill("5");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Emitir acta N° 1" }).click();
  await expect(page.getByText(/Acta N° 1 emitida/)).toBeVisible();
  const t = (writes.find((w) => w.table === "payment_certificates" && w.method === "POST")?.body as { totals: Record<string, number | string> }).totals as Record<string, number> & {
    vatMode: string;
  };
  const d = t.periodAmount;
  expect(t.vatMode).toBe("utility");
  expect(t.subtotalAmount).toBeCloseTo(d * 1.2, 1);
  expect(t.vatAmount).toBeCloseTo(d * 0.05 * 0.19, 1);
  expect(t.grossAmount).toBeCloseTo(d * 1.2 + d * 0.05 * 0.19, 1);
  // Retención sobre el valor antes de IVA
  expect(t.netAmount).toBeCloseTo(t.grossAmount - d * 1.2 * 0.05, 1);
});

test("las condiciones de la última acta (AIU, IVA, retención) se proponen en la siguiente", async ({ page }) => {
  const db = pricedDb();
  db.tables.payment_certificates = [
    {
      id: "pc1",
      project_id: PROJECT_ID,
      company_id: null,
      number: 1,
      period_start: day(-30),
      period_end: day(-8),
      status: "emitida",
      retention_pct: 0.05,
      advance_pct: 0,
      lines: [],
      totals: { periodAmount: 0, retentionPct: 0.05, advancePct: 0, adminPct: 0.08, contingencyPct: 0.02, utilityPct: 0.05, vatMode: "utility", vatPct: 0.19 },
      issued_at: `${day(-7)}T15:00:00Z`,
      notes: null,
      void_reason: null,
    },
  ];
  await mockSupabase(page, db);
  await page.goto("/actas");
  await expect(page.getByRole("button", { name: "Emitir acta N° 2" })).toBeVisible();
  await expect(page.getByLabel(/Administración/)).toHaveValue("8");
  await expect(page.getByLabel(/Imprevistos/)).toHaveValue("2");
  await expect(page.getByLabel(/Retención/)).toHaveValue("5");
  await expect(page.getByRole("combobox", { name: "IVA" })).toHaveValue("utility");
  await expect(page.getByLabel(/Tarifa de IVA/)).toHaveValue("19");
});
