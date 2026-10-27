import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase, USER } from "./mock";

test("demo: la página pública envía la solicitud (sin menú de la app)", async ({ page }) => {
  const db = buildDb();
  const calls: Record<string, unknown>[] = [];
  db.rpc.request_demo = (args) => {
    calls.push(args);
    return null;
  };
  await mockSupabase(page, db);
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Pide una demostración" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pedir demostración" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Escribe tu nombre, tu empresa y un correo válido.");
  await page.getByLabel("Tu nombre").fill("Carolina Ruiz");
  await page.getByLabel("Empresa").fill("Constructora Andina");
  await page.getByLabel("Correo").fill("carolina@andina.co");
  await page.getByLabel(/^Teléfono/).fill("3001234567");
  await page.getByLabel(/^¿Cuántas obras/).fill("3");
  await page.getByRole("button", { name: "Pedir demostración" }).click();
  await expect(page.getByRole("heading", { name: "¡Recibimos tu solicitud!" })).toBeVisible();
  expect(calls[0]).toMatchObject({ p_name: "Carolina Ruiz", p_company: "Constructora Andina", p_email: "carolina@andina.co", p_phone: "3001234567", p_projects_count: 3, p_website: null });
});

test("dueño: ve las solicitudes, crea la empresa desde una y cambia el plan de otra", async ({ page }) => {
  const db = buildDb();
  db.tables.platform_admins = [{ user_id: USER.id }];
  db.tables.demo_requests = [
    { id: "r1", name: "Carolina Ruiz", company: "Constructora Andina", email: "carolina@andina.co", phone: null, city: "Barranquilla", project_type: "Solar fotovoltaica", projects_count: 3, message: "Queremos probar", status: "nuevo", created_at: `${day(0)}T12:00:00Z` },
  ];
  const companies = [
    { id: "o1", name: "Constructora Prueba", tax_id: null, created_at: `${day(-60)}T12:00:00Z`, suspended_at: null, suspended_reason: null, projects: 1, project_names: ["Parque Solar Prueba"], users: 4, admins: ["Eddie"], last_sign_in: null, last_entry: null, entries_30d: 0, plan: "prueba", max_projects: 1, max_users: 10, paid_until: day(10), monthly_fee: null },
  ];
  db.rpc.platform_companies = () => companies;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  db.rpc.platform_set_plan = (args) => {
    calls.push({ fn: "plan", args });
    return null;
  };
  db.functions = {
    ...db.functions,
    "platform-create-company": (body) => {
      calls.push({ fn: "create", args: body });
      return [200, { status: "created", org_id: "o2" }];
    },
  };
  const writes = await mockSupabase(page, db);
  await page.goto("/dueno");
  await expect(page.getByRole("heading", { name: /Solicitudes de demostración \(1 nuevas\)/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Constructora Prueba/ })).toContainText("obras 1/1 · usuarios 4/10");

  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByLabel("Nombre de la empresa")).toHaveValue("Constructora Andina");
  await expect(page.getByLabel("Correo del administrador")).toHaveValue("carolina@andina.co");
  await page.getByRole("button", { name: "Generar" }).click();
  await page.getByLabel("Primera obra").fill("Parque Solar Norte");
  await page.getByLabel("Código de la obra").fill("PSN-01");
  await page.getByLabel("Inicio").fill("2026-11-02");
  await page.getByLabel("Terminación").fill("2027-05-30");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByText("Constructora Andina quedó creada con su primera obra.")).toBeVisible();
  expect(calls.find((c) => c.fn === "create")?.args).toMatchObject({ company_name: "Constructora Andina", plan: "prueba" });
  // La solicitud queda como convertida y ligada a la empresa nueva
  expect(writes.find((w) => w.table === "demo_requests" && w.method === "PATCH")?.body).toMatchObject({ status: "convertido", org_id: "o2" });

  await page.getByRole("button", { name: "Plan de Constructora Prueba" }).click();
  // El editor del plan queda arriba del formulario de alta (que también tiene «Plan»)
  await page.getByRole("combobox", { name: "Plan", exact: true }).first().selectOption("profesional");
  await page.getByLabel("Pagado hasta").fill("2027-10-31");
  await page.getByRole("button", { name: "Guardar plan" }).click();
  await expect(page.getByText("Plan de Constructora Prueba actualizado.")).toBeVisible();
  expect(calls.find((c) => c.fn === "plan")?.args).toEqual({
    p_org: "o1",
    p_plan: "profesional",
    p_max_projects: 5,
    p_max_users: 60,
    p_paid_until: "2027-10-31",
    p_monthly_fee: null,
  });
});

test("plan por vencer: el administrador ve el aviso; el logo sale en el informe diario", async ({ page }) => {
  const db = buildDb();
  db.tables.organizations = [{ id: "org1", name: "Constructora Prueba", paid_until: day(3), logo_path: "org1/logo.png" }];
  Object.assign(db.tables.projects!.find((p) => p.id === PROJECT_ID)!, { org: { logo_path: "org1/logo.png" } });
  await mockSupabase(page, db);
  await page.goto("/informe");
  await expect(page.getByText(/El plan de tu empresa vence el .* \(en 3 días\)/)).toBeVisible();
  await expect(page.getByAltText("Logo de la empresa")).toHaveAttribute("src", /\/storage\/v1\/object\/public\/logos\/org1\/logo\.png$/);
});

test("empresa: subir el logo lo guarda en la empresa", async ({ page }) => {
  const db = buildDb();
  db.tables.organizations = [{ id: "org1", name: "Constructora Prueba", tax_id: null, logo_path: null }];
  db.tables.org_settings = [];
  db.rpc.org_people = () => [{ user_id: USER.id, name: "Eddie", email: USER.email, admin: true }];
  const writes = await mockSupabase(page, db);
  await page.goto("/empresa");
  await page.getByLabel(/Subir logo/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(page.getByText("Logo guardado: ya sale en los informes y las actas.")).toBeVisible();
  const body = writes.find((w) => w.table === "organizations" && w.method === "PATCH")?.body as { logo_path: string };
  expect(body.logo_path).toMatch(/^org1\/logo-\d+\.png$/);
});
