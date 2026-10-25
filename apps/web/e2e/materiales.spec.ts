import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase, USER } from "./mock";

function materialsDb() {
  const db = buildDb();
  db.tables.materials = [{ id: "m1", project_id: PROJECT_ID, name: "Pilotes", unit: "Ud", low_days: 3 }];
  // Un pilote por cada pilote hincado en los dos bloques
  db.tables.material_usage = [
    { material_id: "m1", activity_id: "a1", project_id: PROJECT_ID, factor: 1 },
    { material_id: "m1", activity_id: "a3", project_id: PROJECT_ID, factor: 1 },
  ];
  db.tables.material_deliveries = [{ id: "d1", project_id: PROJECT_ID, material_id: "m1", delivered_on: day(-30), quantity: 150, document: "REM-001", supplier: "Aceros del Norte" }];
  return db;
}

test("materiales: lo entregado contra lo instalado y los días que alcanza", async ({ page }) => {
  await mockSupabase(page, materialsDb());
  await page.goto("/materiales");
  const row = page.getByRole("row", { name: /^Pilotes/ });
  // 400 pilotes en los dos bloques; 150 entregados y más de 150 hincados: existencias negativas, agotado
  await expect(row).toContainText("400");
  await expect(row).toContainText("150");
  await expect(row).toContainText("■ Agotado");
  await expect(page.getByText(/Existencias negativas/)).toBeVisible();
  await expect(page.getByText("1 material(es) por agotarse")).toBeVisible();
});

test("materiales: registrar una entrega y vincular un material a un grupo de actividades", async ({ page }) => {
  const writes = await mockSupabase(page, materialsDb());
  await page.goto("/materiales");
  await page.getByRole("combobox", { name: /^Material/ }).first().selectOption({ label: "Pilotes (Ud)" });
  await page.getByRole("textbox", { name: "Cantidad", exact: true }).fill("200");
  await page.getByLabel(/Remisión/).fill("REM-002");
  await page.getByRole("button", { name: "Registrar entrega" }).click();
  await expect(page.getByText("Entrega registrada.")).toBeVisible();
  expect(writes.find((w) => w.table === "material_deliveries" && w.method === "POST")?.body).toMatchObject({ material_id: "m1", quantity: 200, document: "REM-002", created_by: USER.id });

  // Vincular: todas las actividades del grupo (sin grupos de trabajo, el grupo es el nombre)
  await page.getByRole("combobox", { name: /^Material/ }).last().selectOption({ label: "Pilotes" });
  await page.getByLabel("Lo consume el grupo").selectOption({ label: "Montaje de trackers" });
  await page.getByLabel(/Consumo por unidad/).fill("8");
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByText("1 actividad(es) vinculadas.")).toBeVisible();
  expect(writes.find((w) => w.table === "material_usage" && w.method === "POST")?.body).toEqual([{ material_id: "m1", activity_id: "a2", project_id: PROJECT_ID, factor: 8 }]);
});
