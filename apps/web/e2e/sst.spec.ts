import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

function sstDb(role: "admin" | "field" = "admin") {
  const db = buildDb(role);
  db.tables.project_companies!.push({ id: "co-hincas", project_id: PROJECT_ID, name: "Hincas del Caribe", kind: "subcontratista" });
  db.tables.workers = [
    { id: "w1", project_id: PROJECT_ID, company_id: "co-hincas", full_name: "Pedro Pérez", document_id: "1001", role: "Operador", works_at_height: true, active: true },
  ];
  db.tables.compliance_documents = [
    { id: "d1", project_id: PROJECT_ID, company_id: "co-hincas", worker_id: null, doc_type: "pila", issued_on: null, expires_on: day(-3), file_path: null, notes: "Septiembre" },
    { id: "d2", project_id: PROJECT_ID, company_id: "co-hincas", worker_id: "w1", doc_type: "arl", issued_on: null, expires_on: null, file_path: null, notes: null },
    { id: "d3", project_id: PROJECT_ID, company_id: "co-hincas", worker_id: "w1", doc_type: "eps", issued_on: null, expires_on: null, file_path: null, notes: null },
    { id: "d4", project_id: PROJECT_ID, company_id: "co-hincas", worker_id: "w1", doc_type: "examen_medico", issued_on: null, expires_on: day(200), file_path: null, notes: null },
  ];
  return db;
}

test("SST: estado por trabajador y empresa; agregar documentos lo habilita y el bloqueo se activa", async ({ page }) => {
  const db = sstDb();
  const writes = await mockSupabase(page, db);
  await page.goto("/sst");
  await expect(page.getByRole("heading", { name: "Seguridad social y SST" })).toBeVisible();
  const row = page.getByRole("row", { name: /Pedro Pérez/ });
  // Le faltan la inducción y el curso de alturas
  await expect(row).toContainText("No habilitado");
  await expect(row).toContainText("Falta: Inducción SST de la obra, Curso de trabajo seguro en alturas");
  // Ni el contratista ni Hincas tienen planilla vigente
  await expect(page.getByText("Planilla: no vigente")).toHaveCount(2);

  await row.getByRole("button", { name: "Documentos de Pedro Pérez" }).click();
  for (const [type, value] of [["induccion", day(300)], ["alturas", day(10)]] as const) {
    await page.getByLabel("Tipo de documento de Pedro Pérez").selectOption(type);
    await page.getByLabel("Vencimiento de documento de Pedro Pérez").fill(value);
    await page.getByRole("button", { name: "Guardar documento de Pedro Pérez" }).click();
    await expect(page.getByRole("status")).toContainText("guardado");
  }
  // Con todo, el curso de alturas vence en 10 días: queda "por vencer"
  await expect(page.getByRole("row", { name: /Pedro Pérez/ })).toContainText("Por vencer");
  const docs = writes.filter((w) => w.table === "compliance_documents" && w.method === "POST").map((w) => w.body as Record<string, unknown>);
  expect(docs.map((d) => [d.doc_type, d.worker_id])).toEqual([
    ["induccion", "w1"],
    ["alturas", "w1"],
  ]);

  const block = page.getByLabel(/Bloquear el avance de una empresa sin planilla vigente/);
  await block.click();
  await expect(page.getByText("Bloqueo activado.")).toBeVisible();
  await expect(block).toBeChecked();
  expect(writes.find((w) => w.table === "projects" && w.method === "PATCH")?.body).toEqual({ compliance_block: true });
});

test("el subcontratista ve solo su empresa y puede agregar su gente; no ve el bloqueo", async ({ page }) => {
  const db = sstDb("field");
  for (const m of db.tables.memberships!) m.sub_company_id = "co-hincas";
  const writes = await mockSupabase(page, db);
  await page.goto("/sst");
  await expect(page.getByRole("heading", { name: "Hincas del Caribe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal directo del contratista" })).toHaveCount(0);
  await expect(page.getByText(/Bloquear el avance/)).toHaveCount(0);
  await page.getByLabel("Nombre del trabajador").fill("Luis Gómez");
  await page.getByLabel("Cédula").fill("1002");
  await page.getByRole("button", { name: "Agregar trabajador" }).click();
  await expect(page.getByText(/Luis Gómez agregado/)).toBeVisible();
  expect(writes.find((w) => w.table === "workers")?.body).toMatchObject({ company_id: "co-hincas", full_name: "Luis Gómez", document_id: "1002" });
});
