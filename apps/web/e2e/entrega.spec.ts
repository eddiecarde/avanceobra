import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

const punch = (id: string, activity: string, status: string, description: string) => ({
  id,
  project_id: PROJECT_ID,
  front_id: null,
  type: "quality",
  severity: "medium",
  status,
  description,
  lat: null,
  lon: null,
  due_date: day(2),
  created_at: `${day(-4)}T15:00:00Z`,
  closed_at: status === "closed" ? `${day(-1)}T15:00:00Z` : null,
  category: "punch",
  impeditive: false,
  activity_id: activity,
  element_id: null,
  company_id: null,
  verification_note: status === "closed" ? "Torque verificado en las 12 mesas" : null,
});

test("entrega del punch: bloqueada con pendientes; con todo cerrado se firma y queda registrada", async ({ page }) => {
  const db = buildDb();
  // Bloque A (BA-HIN = a1, BA-MON = a2): un punch cerrado con foto. Bloque B (BB-HIN = a3): uno abierto
  db.tables.findings!.push(punch("p1", "a2", "closed", "Faltan tornillos de torque en la mesa 7"), punch("p2", "a3", "open", "Pilote sin tapa en la fila 2"));
  db.tables.photos = [{ id: "ph1", project_id: PROJECT_ID, finding_id: "p1", storage_path: `${PROJECT_ID}/p1/ph1.jpg`, purpose: "cierre" }];
  db.tables.punch_handovers = [];
  const writes = await mockSupabase(page, db);
  await page.goto("/calidad");
  await page.getByRole("tab", { name: "Entrega del punch" }).click();

  // Todo el proyecto: hay un punch abierto, no se puede entregar
  await expect(page.getByText("Todavía no se puede entregar: faltan por cerrar")).toBeVisible();
  await expect(page.getByText("Pilote sin tapa en la fila 2")).toBeVisible();

  // Bloque A: todo cerrado → formulario de entrega con firma
  await page.getByLabel("Zona que se entrega").selectOption({ label: "BA · Bloque A" });
  await page.getByLabel(/Recibe/).fill("Ing. Carolina Bustos");
  await page.getByLabel("Cargo y empresa").fill("Supervisora civil · Interventoría");
  // Sin firma no se registra
  await page.getByRole("button", { name: /Registrar entrega/ }).click();
  await expect(page.getByText("Falta la firma de quien recibe.")).toBeVisible();
  const box = (await page.getByLabel("Recuadro de firma").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 5 });
  await page.mouse.move(box.x + 220, box.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Registrar entrega (1 punch)" }).click();
  await expect(page.getByText(/Acta de entrega de BA · Bloque A registrada con 1 punch/)).toBeVisible();

  expect(writes.some((w) => w.table === "storage" && (w.body as { path: string }).path.includes("/entregas/"))).toBe(true);
  const body = writes.find((w) => w.table === "punch_handovers" && w.method === "POST")?.body as Record<string, unknown> & { items: { id: string; photo_path: string }[] };
  expect(body).toMatchObject({ scope: "BA · Bloque A", received_by_name: "Ing. Carolina Bustos", received_by_role: "Supervisora civil · Interventoría" });
  expect(body.items).toEqual([expect.objectContaining({ id: "p1", photo_path: `${PROJECT_ID}/p1/ph1.jpg`, verification_note: "Torque verificado en las 12 mesas" })]);
  expect(String(body.signature_path)).toMatch(/\/entregas\/.+\.png$/);
});
