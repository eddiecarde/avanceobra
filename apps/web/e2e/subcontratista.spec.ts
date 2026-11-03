import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

// El filtrado de datos lo hace la base de datos (RLS y sincronización); aquí se prueba el aviso
test("quien es de un subcontratista ve el aviso de vista limitada", async ({ page }) => {
  const db = buildDb("field");
  for (const m of db.tables.memberships!) m.sub_company_id = "c-sub";
  await mockSupabase(page, db);
  await page.goto("/dashboard");
  await expect(page.getByText("Vista de subcontratista: ves solo las actividades de tu empresa.").first()).toBeVisible();
});

test("el contratista no ve el aviso", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Parque Solar Prueba/ }).first()).toBeVisible();
  await expect(page.getByText(/Vista de subcontratista/)).toHaveCount(0);
});
