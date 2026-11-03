import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

test("valor ganado: sin tarifas lo advierte; con tarifas el parte diario se vuelve costo real", async ({ page }) => {
  const db = buildDb();
  // Presupuesto solo en el hincado de los dos bloques
  for (const a of db.tables.activities!) if (String(a.code).endsWith("HIN")) a.budget_unit_cost = 50_000;
  db.tables.cost_rates = [];
  const writes = await mockSupabase(page, db);
  await page.goto("/valor-ganado");
  await expect(page.getByRole("heading", { name: "Valor ganado (EVM)" })).toBeVisible();
  await expect(page.getByText(/Aún no hay costo real/)).toBeVisible();
  await expect(page.getByText(/Solo 2 de 4 actividades tienen costo presupuestado/)).toBeVisible();
  await expect(page.getByText("CPI · costo").locator("..")).toContainText("—");

  await page.getByRole("button", { name: "Tarifas y precios" }).click();
  await page.getByLabel("Tarifa de Oficial de obra").fill("120.000");
  await page.getByLabel("Tarifa de Auxiliar de obra").fill("80000");
  await page.getByLabel("Tarifa de Hincadora").fill("900000");
  await page.getByRole("button", { name: "Guardar tarifas" }).click();
  await expect(page.getByText("Tarifas guardadas. El costo real se recalculó.")).toBeVisible();
  expect(writes.find((w) => w.table === "cost_rates")?.body).toMatchObject({
    personnel: { "Oficial de obra": 120_000, "Auxiliar de obra": 80_000 },
    equipment: { Hincadora: 900_000 },
  });
  // Parte del día: 4 oficiales y 8 auxiliares ($1,12 M) y 2 hincadoras ($1,8 M)
  await expect(page.getByRole("row", { name: /Personal \(parte diario × tarifa\) \$1,1 M/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Equipos \(parte diario × tarifa\) \$1,8 M/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Total \(AC\) \$2,9 M/ })).toBeVisible();
  await expect(page.getByText("CPI · costo").locator("..")).not.toContainText("—");
  await expect(page.getByRole("heading", { name: "Curvas en dinero" })).toBeVisible();
});
