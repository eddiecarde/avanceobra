import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

const LIST = {
  id: "cl1",
  project_id: PROJECT_ID,
  name: "Hincado de pilotes",
  activity_id: "a3",
  active: true,
  items: [
    { id: "1", text: "Verticalidad dentro de 1 %" },
    { id: "2", text: "Cota de cabeza según plano" },
    { id: "3", text: "Galvanizado sin daño" },
  ],
};

test("calidad: crear lista de chequeo y punto del plan de inspección", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/calidad");
  await page.getByRole("tab", { name: "Listas de chequeo" }).click();
  await page.getByLabel("Nombre").fill("Zanjas DC");
  await page.getByLabel(/Puntos a revisar/).fill("Profundidad 80 cm\nCama de arena\nCinta de señalización");
  await page.getByRole("button", { name: "Crear lista (3 puntos)" }).click();
  await expect(page.getByText("Lista de chequeo creada.")).toBeVisible();
  expect(writes.find((w) => w.table === "checklists")?.body).toMatchObject({
    name: "Zanjas DC",
    items: [
      { id: "1", text: "Profundidad 80 cm" },
      { id: "2", text: "Cama de arena" },
      { id: "3", text: "Cinta de señalización" },
    ],
  });

  await page.getByRole("tab", { name: "Plan de inspección" }).click();
  await page.getByLabel("Actividad").selectOption({ label: "BB-ZAN · Zanjas DC" });
  await page.getByLabel("Punto", { exact: true }).fill("Liberación de zanja antes de tapar");
  await page.getByLabel("Tipo").selectOption("espera");
  await page.getByLabel("Lista de chequeo").selectOption({ label: "Zanjas DC" });
  await page.getByRole("button", { name: "Agregar al plan" }).click();
  await expect(page.getByText("Punto agregado al plan de inspección.")).toBeVisible();
  expect(writes.find((w) => w.table === "inspection_points")?.body).toMatchObject({ activity_id: "a4", name: "Liberación de zanja antes de tapar", point_type: "espera" });
});

test("calidad: una inspección con un no cumple abre una no conformidad impeditiva", async ({ page }) => {
  const db = buildDb();
  db.tables.checklists = [LIST];
  await mockSupabase(page, db);
  await page.goto("/calidad");
  await page.getByRole("tab", { name: "Inspecciones" }).click();
  await page.getByLabel("Lista de chequeo").selectOption({ label: "Hincado de pilotes" });
  await page.getByRole("radiogroup", { name: "Verticalidad dentro de 1 %" }).getByRole("radio", { name: "Cumple", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Cota de cabeza según plano" }).getByRole("radio", { name: "No cumple" }).click();
  await page.getByLabel("Qué no cumple en Cota de cabeza según plano").fill("Cabeza 4 cm abajo en la fila 12");
  await page.getByLabel("Impeditivo").check();
  await page.getByRole("radiogroup", { name: "Galvanizado sin daño" }).getByRole("radio", { name: "No aplica" }).click();
  await page.getByRole("button", { name: "Registrar inspección" }).click();
  await expect(page.getByText("Inspección rechazada: se abrieron 1 no conformidad(es).")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Rechazada" })).toBeVisible();

  await page.getByRole("tab", { name: "No conformidades y punch" }).click();
  await expect(page.getByText("Hincado de pilotes: Cabeza 4 cm abajo en la fila 12")).toBeVisible();
});

test("calidad: cierre verificado de una NC y punch impeditivo con su empresa", async ({ page }) => {
  const db = buildDb();
  db.tables.findings!.push({
    id: "nc1",
    project_id: PROJECT_ID,
    front_id: null,
    type: "quality",
    severity: "high",
    status: "to_review",
    description: "Pilote fuera de plomo en la fila 3",
    due_date: day(2),
    created_at: `${day(-2)}T15:00:00Z`,
    closed_at: null,
    category: "no_conformidad",
    impeditive: true,
    activity_id: "a3",
    element_id: null,
    company_id: null,
    corrective_action: "Rehincar",
  });
  const writes = await mockSupabase(page, db);
  await page.goto("/calidad");
  await expect(page.getByText("Pilote fuera de plomo en la fila 3")).toBeVisible();
  await page.getByRole("button", { name: "Verificar y cerrar" }).click();
  await page.getByLabel(/Verificación del cierre/).fill("Verticalidad medida 0,5 %, dentro de tolerancia");
  // Sin la foto de cómo quedó no se cierra
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText(/Adjunta la foto de cierre/)).toBeVisible();
  await page.getByLabel(/Foto de cierre/).setInputFiles({ name: "cierre.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText("No conformidad: cerrado.")).toBeVisible();
  expect(writes.some((w) => w.table === "storage" && (w.body as { path: string }).path.startsWith("photos/"))).toBe(true);
  expect(writes.find((w) => w.table === "photos" && w.method === "POST")?.body).toMatchObject({ purpose: "cierre", annotation: "Cierre", uploaded: true });
  expect(writes.find((w) => w.table === "findings" && w.method === "PATCH")?.body).toEqual({ status: "closed", verification_note: "Verticalidad medida 0,5 %, dentro de tolerancia" });

  // Punch impeditivo: la empresa responsable sale de la actividad
  await page.getByRole("combobox", { name: "Categoría", exact: true }).last().selectOption("punch");
  await page.getByRole("combobox", { name: "Actividad", exact: true }).selectOption({ label: "BA-MON · Montaje de trackers" });
  await page.getByLabel("Descripción").fill("Faltan tornillos de torque en la mesa 7");
  await page.getByLabel(/Impeditivo \(no deja avanzar/).check();
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Punch registrada.")).toBeVisible();
  expect(writes.find((w) => w.table === "findings" && w.method === "POST")?.body).toMatchObject({ category: "punch", impeditive: true, activity_id: "a2", company_id: "co-contratista" });
});
