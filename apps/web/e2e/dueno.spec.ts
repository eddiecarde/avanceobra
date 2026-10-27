import { expect, test } from "@playwright/test";
import { buildDb, day } from "./fixtures";
import { mockSupabase, USER } from "./mock";

function ownerDb() {
  const db = buildDb();
  db.tables.platform_admins = [{ user_id: USER.id }];
  const companies = [
    { id: "o1", name: "Constructora Prueba", tax_id: "900111222-3", created_at: `${day(-60)}T12:00:00Z`, suspended_at: null, suspended_reason: null, projects: 2, project_names: ["Parque Solar Prueba", "Pivijay"], users: 4, admins: ["Eddie"], last_sign_in: `${day(0)}T12:00:00Z`, last_entry: null, entries_30d: 45 },
  ];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  db.rpc.platform_companies = () => companies;
  db.rpc.platform_set_suspended = (args) => {
    calls.push({ fn: "suspend", args });
    Object.assign(companies[0]!, { suspended_at: args.p_suspended ? `${day(0)}T15:00:00Z` : null, suspended_reason: args.p_reason });
    return null;
  };
  db.functions = {
    ...db.functions,
    "platform-create-company": (body) => {
      calls.push({ fn: "create", args: body });
      companies.push({ ...companies[0]!, id: "o2", name: String(body.company_name), suspended_at: null, projects: 1, users: 1, project_names: [String(body.project_name)], entries_30d: 0 });
      return [200, { status: "created", org_id: "o2" }];
    },
  };
  return { db, calls };
}

test("panel del dueño: ve las empresas, suspende una y da de alta otra con su primera obra", async ({ page }) => {
  const { db, calls } = ownerDb();
  await mockSupabase(page, db);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Panel del dueño" }).first().click();
  await expect(page.getByRole("heading", { name: "Panel del dueño" })).toBeVisible();
  const row = page.getByRole("row", { name: /Constructora Prueba/ });
  await expect(row).toContainText("Activa");
  await expect(row).toContainText("45");

  page.once("dialog", (d) => void d.accept("Falta de pago"));
  await row.getByRole("button", { name: "Suspender" }).click();
  await expect(page.getByText("Constructora Prueba quedó suspendida.")).toBeVisible();
  await expect(row).toContainText("Falta de pago");
  expect(calls[0]).toEqual({ fn: "suspend", args: { p_org: "o1", p_suspended: true, p_reason: "Falta de pago" } });

  await page.getByLabel("Nombre de la empresa").fill("Constructora Andina SAS");
  await page.getByLabel("Nombre del administrador").fill("Carolina Ruiz");
  await page.getByLabel("Correo del administrador").fill("carolina@andina.co");
  await page.getByRole("button", { name: "Generar" }).click();
  await page.getByLabel("Primera obra").fill("Parque Solar Norte");
  await page.getByLabel("Código de la obra").fill("psn-01");
  await page.getByLabel("Inicio").fill("2026-11-02");
  await page.getByLabel("Terminación").fill("2027-05-30");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByText("Constructora Andina SAS quedó creada con su primera obra.")).toBeVisible();
  await expect(page.getByText(/administrador de Constructora Andina SAS/)).toBeVisible();
  expect(calls[1]?.args).toMatchObject({ company_name: "Constructora Andina SAS", admin_email: "carolina@andina.co", project_code: "PSN-01", start: "2026-11-02" });
  await expect(page.getByRole("row", { name: /Constructora Andina SAS/ })).toBeVisible();
});

test("el panel del dueño no aparece para un administrador normal", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/dueno");
  await expect(page.getByText("Esta página es solo para el dueño de la plataforma.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Panel del dueño" })).toHaveCount(0);
});

test("la gente de una empresa suspendida ve el aviso y no entra", async ({ page }) => {
  const db = buildDb();
  for (const m of db.tables.memberships!) m.org_suspended = true;
  await mockSupabase(page, db);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Tu empresa está suspendida" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
});
