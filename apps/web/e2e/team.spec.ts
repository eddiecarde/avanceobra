import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

test("equipo: crear una persona con contraseña temporal y mensaje para enviarle", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/equipo");
  await expect(page.getByText("marta@obra.test")).toBeVisible();
  await expect(page.getByText("Sin vincular")).toBeVisible();

  await page.getByLabel("Nombre", { exact: true }).fill("Ana Pérez");
  await page.getByLabel("Correo", { exact: true }).fill("ana@obra.test");
  await page.locator("form").getByLabel(/^Rol/).selectOption("resident");
  await page.getByRole("button", { name: "Generar" }).first().click();
  const pwd = await page.getByLabel(/^Contraseña temporal/).first().inputValue();
  expect(pwd).toMatch(/^[A-Za-z2-9]{5}-[A-Za-z2-9]{5}-\d{2}$/);
  await page.getByRole("button", { name: "Crear y agregar al proyecto" }).click();
  await expect(page.getByText("Usuario creado: Ana Pérez.")).toBeVisible();
  expect(writes.find((w) => w.table === "fn:team-create-user")?.body).toMatchObject({ name: "Ana Pérez", email: "ana@obra.test", role: "resident", password: pwd });
  await expect(page.getByText(/contraseña temporal .* \(al entrar a la web te pedirá cambiarla\)/)).toBeVisible();
  await page.getByRole("button", { name: "Copiar mensaje" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Sincronía → Vincular Telegram");
});

test("equipo: si falta algo, el botón lo dice junto a él", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/equipo");
  await page.getByLabel("Nombre", { exact: true }).fill("Ana Pérez");
  await page.getByLabel("Correo", { exact: true }).fill("ana@obra.test");
  await page.getByRole("button", { name: "Crear y agregar al proyecto" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Falta la contraseña temporal (pulsa Generar).");
});

test("equipo: un correo que ya está en el proyecto muestra el aviso de la función", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/equipo");
  await page.getByLabel("Nombre", { exact: true }).fill("Marta");
  await page.getByLabel("Correo", { exact: true }).fill("marta@obra.test");
  await page.getByLabel(/^Contraseña temporal/).first().fill("Temporal12345");
  await page.getByRole("button", { name: "Crear y agregar al proyecto" }).click();
  await expect(page.getByText(/ya está en el proyecto \(rol actual: field\)/)).toBeVisible();
});

test("equipo: cambiar el rol de una persona", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/equipo");
  await page.getByLabel("Rol de Marta").selectOption("resident");
  await expect(page.getByText("Marta ahora es residente.")).toBeVisible();
  expect(writes.find((w) => w.table === "memberships" && w.method === "PATCH")).toMatchObject({ body: { role: "resident" } });
  // A uno mismo no se le ofrece retirarse
  await expect(page.getByRole("button", { name: "Retirar" })).toHaveCount(1);
});

test("equipo: agrupa por contratista y subcontratista, y corrige nombres", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/equipo");
  // Marta aún no tiene empresa: aparece en su propio grupo
  await expect(page.getByRole("row", { name: /Contratista Constructora Demo 1 persona/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sin empresa asignada 1 persona/ })).toBeVisible();

  await page.getByLabel("Nombre de la empresa").fill("Hincas del Caribe");
  await page.getByRole("button", { name: "Agregar empresa" }).click();
  await expect(page.getByText("Subcontratista agregado: Hincas del Caribe.")).toBeVisible();
  expect(writes.find((w) => w.table === "project_companies")?.body).toMatchObject({ name: "Hincas del Caribe", kind: "subcontratista" });

  await page.getByLabel("Empresa de Marta").selectOption({ label: "Hincas del Caribe (subcontratista)" });
  await expect(page.getByText("Marta quedó en Hincas del Caribe.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Subcontratista Hincas del Caribe 1 persona/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sin empresa asignada/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Editar nombre de Marta" }).click();
  await page.getByLabel("Nombre de Marta").fill("Marta Rincón");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Nombre actualizado: Marta Rincón.")).toBeVisible();
  expect(writes.filter((w) => w.table === "memberships" && w.method === "PATCH").at(-1)?.body).toEqual({ member_name: "Marta Rincón" });
  await expect(page.getByRole("button", { name: "Editar nombre de Marta Rincón" })).toBeVisible();
});

test("cuenta: con contraseña temporal obliga a cambiarla y luego sigue", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb(), { userMetadata: { must_change_password: true } });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByText("Entraste con una contraseña temporal")).toBeVisible();
  await page.getByLabel(/Contraseña nueva/).fill("corta1");
  await expect(page.getByText("Debe tener al menos 10 caracteres, con letras y números.")).toBeVisible();
  await page.getByLabel(/Contraseña nueva/).fill("MiClaveNueva2026");
  await page.getByLabel("Repítela").fill("MiClaveNueva2026");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(writes.find((w) => w.table === "auth.user")?.body).toMatchObject({ password: "MiClaveNueva2026", data: { must_change_password: false } });
});
