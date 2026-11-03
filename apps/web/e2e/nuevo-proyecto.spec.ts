import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase, USER } from "./mock";

test("nuevo proyecto: se crea la obra, queda elegida y abre Programación con el formato del Excel", async ({ page }) => {
  const db = buildDb();
  const calls: Record<string, unknown>[] = [];
  db.rpc.create_project = (args) => {
    if (String(args.p_code) === "PSP") throw new Error("Ya existe una obra con el código PSP");
    calls.push(args);
    const id = "33333333-3333-4333-8333-000000000001";
    db.tables.projects!.push({ id, org_id: "org1", code: args.p_code, name: args.p_name, start_date: args.p_start, contract_end_date: args.p_end, workdays: [1, 2, 3, 4, 5, 6], holidays: [] });
    db.tables.memberships!.push({ user_id: USER.id, project_id: id, org_id: "org1", role: "admin", project: { id, code: args.p_code, name: args.p_name, org_id: "org1" } });
    return id;
  };
  await mockSupabase(page, db);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "+ Nuevo proyecto" }).first().click();
  await expect(page.getByRole("heading", { name: "Nuevo proyecto" })).toBeVisible();
  await page.getByRole("button", { name: "Crear obra y cargar la programación" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Falta el nombre, el código, la fecha de inicio, la fecha de terminación.");
  await page.getByLabel("Nombre de la obra").fill("Parque Solar Sur 80 MW");
  // El código se propone con las iniciales
  await expect(page.getByLabel(/^Código/)).toHaveValue("PSS80");
  await page.getByLabel(/^Cliente/).fill("Helios");
  await page.getByLabel("Inicio de la obra").fill("2026-11-02");
  await page.getByLabel("Terminación contractual").fill("2027-06-30");
  await page.getByRole("button", { name: "Crear obra y cargar la programación" }).click();
  await expect(page).toHaveURL(/\/importar/);
  await expect(page.getByRole("heading", { name: "Obra nueva: carga su programación" })).toBeVisible();
  expect(calls[0]).toMatchObject({ p_code: "PSS80", p_name: "Parque Solar Sur 80 MW", p_start: "2026-11-02", p_end: "2027-06-30", p_client: "Helios", p_org: "org1" });
  // La obra nueva quedó elegida en el menú lateral
  await expect(page.locator("aside select").first()).toHaveValue("33333333-3333-4333-8333-000000000001");
});
