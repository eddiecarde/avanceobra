import { expect, test } from "@playwright/test";
import { buildDb, PROJECT_ID } from "./fixtures";
import { mockSupabase, USER } from "./mock";

function orgDb() {
  const db = buildDb();
  db.tables.organizations = [{ id: "org1", name: "Constructora Prueba", tax_id: null }];
  db.tables.org_settings = [];
  db.tables.org_admins = [{ org_id: "org1", user_id: USER.id }];
  db.tables.cost_rates = [{ project_id: PROJECT_ID, personnel: { "Oficial de obra": 120000 }, equipment: {} }];
  const people = [
    { user_id: USER.id, name: "Eddie", email: USER.email, admin: true },
    { user_id: "u-marta", name: "Marta", email: "marta@obra.test", admin: false },
  ];
  db.rpc.org_people = () => people.map((p) => ({ ...p, admin: db.tables.org_admins!.some((a) => a.user_id === p.user_id) }));
  return db;
}

test("empresa: nombra administrador y guarda los valores para obras nuevas copiándolos de la obra", async ({ page }) => {
  const db = orgDb();
  const writes = await mockSupabase(page, db);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Empresa" }).first().click();
  await expect(page.getByRole("heading", { name: "Empresa", exact: true })).toBeVisible();
  // Con un solo administrador no se puede quitar
  await expect(page.getByRole("listitem").filter({ hasText: "Eddie" }).getByRole("button", { name: "Quitar" })).toBeDisabled();

  await page.getByLabel("Nombrar administrador").selectOption("u-marta");
  await page.getByRole("button", { name: "Nombrar" }).click();
  await expect(page.getByText("Marta ahora administra la empresa y todas sus obras.")).toBeVisible();
  expect(writes.find((w) => w.table === "org_admins" && w.method === "POST")?.body).toEqual({ org_id: "org1", user_id: "u-marta" });

  await page.getByRole("button", { name: "Copiar de la obra actual" }).click();
  await expect(page.getByText(/Copiados los valores de Parque Solar Prueba/)).toBeVisible();
  await expect(page.getByLabel("Tarifa de Oficial de obra")).toHaveValue("120000");
  await page.getByLabel("Día 6").click();
  await page.getByRole("button", { name: "Guardar valores" }).click();
  await expect(page.getByText(/Las obras que se creen de ahora en adelante arrancan con estos valores/)).toBeVisible();
  const saved = writes.find((w) => w.table === "org_settings")?.body as Record<string, unknown>;
  expect(saved).toMatchObject({ org_id: "org1", contractor_name: "CNX", personnel_rates: { "Oficial de obra": 120000 } });
  expect(saved.workdays).toEqual([1, 2, 3, 4, 5]);
  expect(saved.personnel_roles).toEqual(["Oficial de obra", "Auxiliar de obra"]);
});

test("el supervisor de campo no ve Empresa en el menú", async ({ page }) => {
  await mockSupabase(page, buildDb("field"));
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Empresa" })).toHaveCount(0);
});
