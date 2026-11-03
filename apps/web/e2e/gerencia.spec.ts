import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

test("gerencia: cada obra con avance, atraso, multa estimada y hallazgos; abre su panel", async ({ page }) => {
  const db = buildDb();
  Object.assign(db.tables, { weekly_plans: [], weekly_plan_items: [], materials: [], material_usage: [], material_deliveries: [], payment_certificates: [] });
  await mockSupabase(page, db);
  await page.goto("/gerencia");
  await expect(page.getByRole("heading", { name: "Gerencia" })).toBeVisible();
  const row = page.getByRole("row", { name: /^Parque Solar Prueba/ });
  await expect(row).toContainText("%");
  await expect(row).toContainText("1 crítico(s)");
  // El contrato de prueba tiene multa de $20 M por día: si hay atraso, aparece en millones
  await expect(row).toContainText(/\$[\d.,]+ M|sin contrato/);
  await row.getByRole("button", { name: "Panel" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
