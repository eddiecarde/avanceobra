import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

test("costos: presupuesto, costo real, horas-hombre, productividad y alertas tempranas", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/costos");
  await expect(page.getByRole("heading", { name: "Costos y productividad" })).toBeVisible();
  // BA-HIN: 200 pilotes × $50.000 = $10 M de presupuesto; 15 días × 6 personas × 8 h = 720 HH
  const row = page.getByRole("row", { name: /^BA-HIN · Hincado de pilotes 120 de 200 pilotes/ });
  await expect(row).toContainText("$10 M");
  await expect(row).toContainText("720");
  await expect(row).toContainText("0,17 pilotes/HH");
  // Costo real = 720 HH × $15.000 = $10,8 M; al terminar = 10,8 + 80 × 90.000 = $18 M → sobrecosto de $8 M
  await expect(row).toContainText("$10,8 M");
  await expect(row).toContainText("$90.000");
  await expect(row).toContainText("−$8 M");
  await expect(page.getByText("Baja la productividad")).toBeVisible();

  // El administrador fija el costo unitario de otra actividad y registra un material
  await page.getByLabel("Costo unitario presupuestado de BB-HIN").fill("48000");
  await page.getByLabel("Costo unitario presupuestado de BB-HIN").blur();
  await expect(page.getByText("Costo unitario de BB-HIN actualizado.")).toBeVisible();
  expect(writes.find((w) => w.table === "activities" && w.method === "PATCH")?.body).toEqual({ budget_unit_cost: 48000 });
  await page.getByLabel("Descripción").fill("Factura 881 · pernos");
  await page.getByLabel("Valor").fill("1.250.000");
  await page.getByRole("button", { name: "Registrar costo" }).click();
  await expect(page.getByText("Costo registrado.")).toBeVisible();
  expect(writes.find((w) => w.table === "cost_records")?.body).toMatchObject({ kind: "material", description: "Factura 881 · pernos", amount: 1250000 });
});

test("costos: el supervisor de campo no ve costos", async ({ page }) => {
  await mockSupabase(page, buildDb("field"));
  await page.goto("/costos");
  await expect(page.getByText("Los costos los ven el residente, el director y el administrador.")).toBeVisible();
});
