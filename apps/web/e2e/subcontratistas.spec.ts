import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

/** Hincas del Caribe (subcontratista) con el hincado del bloque B a $50.000 el pilote. */
function subDb() {
  const db = buildDb();
  db.tables.project_companies!.push({ id: "co-hincas", project_id: PROJECT_ID, name: "Hincas del Caribe", kind: "subcontratista" });
  Object.assign(db.tables.activities!.find((a) => a.code === "BB-HIN")!, { company_id: "co-hincas", subcontract_unit_price: 50_000 });
  db.tables.payment_certificates = [
    { id: "pc-s1", project_id: PROJECT_ID, company_id: "co-hincas", number: 1, period_end: day(-7), status: "emitida", totals: { cumulativeAmount: 1_000_000, retentionAmount: 50_000 } },
  ];
  db.tables.findings!.push({ id: "nc1", project_id: PROJECT_ID, front_id: null, type: "quality", severity: "high", status: "open", description: "Pilote fuera de plomo", lat: null, lon: null, due_date: day(-2), created_at: `${day(-6)}T15:00:00Z`, closed_at: null, category: "no_conformidad", impeditive: false, activity_id: null, element_id: null, company_id: "co-hincas" });
  db.tables.weekly_plan_items = [
    { id: "w1", project_id: PROJECT_ID, company_id: "co-hincas", done: true, plan: { week_start: day(-7) } },
    { id: "w2", project_id: PROJECT_ID, company_id: "co-hincas", done: false, plan: { week_start: day(-7) } },
  ];
  db.tables.subcontracts = [];
  return db;
}

test("subcontratistas: desempeño en plazo, plata, plan y calidad; el contrato se guarda", async ({ page }) => {
  const writes = await mockSupabase(page, subDb());
  await page.goto("/subcontratistas");
  await expect(page.getByRole("heading", { name: "Subcontratistas", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: /Hincas del Caribe/ });
  // 200 pilotes × $50.000 = $10 M; facturado $1 M en el acta 1, retenido $50.000
  await expect(row).toContainText("$10 M");
  await expect(row).toContainText("acta 1");
  await expect(row).toContainText("50 %");
  await expect(row).toContainText("1 vencida(s)");
  await expect(row).toContainText("sin contrato registrado");
  await expect(page.getByText(/Hincas del Caribe:.*no conformidad\(es\) vencida/)).toBeVisible();

  await row.getByRole("button", { name: "Contrato" }).click();
  await expect(page.getByRole("heading", { name: "Contrato de Hincas del Caribe" })).toBeVisible();
  await page.getByLabel("Número de contrato").fill("SUB-HIN-001");
  await page.getByLabel(/Retención/).fill("5");
  await page.getByLabel(/Anticipo entregado/).fill("2.000.000");
  await page.getByRole("button", { name: "Guardar contrato" }).click();
  await expect(page.getByText(/Contrato guardado/)).toBeVisible();
  expect(writes.find((w) => w.table === "subcontracts")?.body).toMatchObject({
    project_id: PROJECT_ID,
    company_id: "co-hincas",
    contract_code: "SUB-HIN-001",
    retention_pct: 0.05,
    advance_amount: 2_000_000,
  });
});

test("la primera acta del subcontratista arranca con las condiciones de su contrato", async ({ page }) => {
  const db = subDb();
  db.tables.payment_certificates = [];
  db.tables.subcontracts = [
    { id: "sc1", project_id: PROJECT_ID, company_id: "co-hincas", contract_code: "SUB-HIN-001", scope: null, start_date: null, end_date: null, retention_pct: 0.1, advance_pct: 0.2, advance_amount: 0, admin_pct: 0, contingency_pct: 0, utility_pct: 0, vat_mode: "none", vat_pct: 0.19, notes: null },
  ];
  await mockSupabase(page, db);
  await page.goto("/actas");
  await page.getByLabel("Acta para").selectOption("co-hincas");
  await expect(page.getByLabel(/Retención/)).toHaveValue("10");
  await expect(page.getByLabel(/Amortización anticipo/)).toHaveValue("20");
});
