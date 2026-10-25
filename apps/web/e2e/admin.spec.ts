import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

// Playwright corre desde apps/web
const XER = resolve(process.cwd(), "../../packages/importers/test/fixtures/proyecto.xer");

test("importar Primavera: vista previa contra la obra y creación de lo nuevo", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/importar");
  await expect(page.getByText(/hoy tiene 2 frente\(s\) y 4 actividad\(es\)/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(XER);
  await expect(page.getByText("Primavera P6", { exact: true })).toBeVisible();
  // BA-HIN y BA-MON existen (cambian fechas); CS-TMT es nueva y le faltan unidad y cantidad
  await expect(page.getByText("Les falta un dato")).toBeVisible();
  await page.getByLabel("Unidad de CS-TMT").fill("m");
  await page.getByLabel("Cantidad de CS-TMT").fill("2.400");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/Importación lista/)).toBeVisible();
  const created = writes.find((w) => w.table === "activities" && w.method === "POST");
  expect(created?.body).toMatchObject({ code: "CS-TMT", unit: "m", contract_qty: 2400, external_ref: "p6:13" });
  expect(writes.some((w) => w.table === "fronts" && w.method === "POST")).toBe(true); // frente CS nuevo
  // Sin autorizar, lo existente no se toca; la importación queda registrada
  expect(writes.some((w) => w.table === "activities" && w.method === "PATCH" && !("predecessors" in (w.body as object)))).toBe(false);
  expect(writes.find((w) => w.table === "import_runs")?.body).toMatchObject({ kind: "programacion", file_name: "proyecto.xer", source: "primavera", updated_existing: false, changes: [] });
});

test("importar: actualizar lo existente se autoriza y queda registrado qué cambió", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/importar");
  await page.locator('input[type="file"]').setInputFiles(XER);
  await page.getByLabel("Unidad de CS-TMT").fill("m");
  await page.getByLabel("Cantidad de CS-TMT").fill("2.400");
  await page.getByLabel(/Autorizo actualizar las actividades existentes/).check();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/Importación lista/)).toBeVisible();
  const run = writes.find((w) => w.table === "import_runs")?.body as { updated_existing: boolean; changes: { codigo: string; cambios: { campo: string }[] }[] };
  expect(run.updated_existing).toBe(true);
  expect(run.changes.length).toBeGreaterThan(0);
  expect(run.changes[0]!.cambios.length).toBeGreaterThan(0);
  expect(writes.some((w) => w.table === "activities" && w.method === "PATCH")).toBe(true);
  await expect(page.getByRole("heading", { name: "Importaciones anteriores" })).toBeVisible();
});

test("proyecto: los pesos deben sumar 100 % para guardar", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/proyecto");
  await expect(page.getByRole("heading", { name: "Actividades: peso, empresa y ubicación" })).toBeVisible();
  await page.getByLabel("Peso de BA-HIN").fill("60");
  await expect(page.getByText("Los pesos deben sumar 100 % para guardar.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
  for (const [code, w] of [["BA-MON", "20"], ["BB-HIN", "10"], ["BB-ZAN", "10"]]) await page.getByLabel(`Peso de ${code}`).fill(w!);
  await expect(page.getByRole("cell", { name: "100 %" })).toBeVisible();
  // La empresa responsable se elige en la misma tabla; la barra avisa que hay cambios
  await page.getByLabel("Empresa de BA-HIN").selectOption({ label: "Constructora Demo (contratista)" });
  await expect(page.getByText("Cambios sin guardar")).toBeVisible();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/Guardado\. 4 actividad\(es\) actualizadas/)).toBeVisible();
  const weights = writes.filter((w) => w.table === "activities" && w.method === "PATCH").map((w) => (w.body as { weight: number }).weight);
  expect(weights.sort()).toEqual([0.1, 0.1, 0.2, 0.6]);
  expect(writes.find((w) => w.table === "activities" && (w.body as { weight: number }).weight === 0.6)?.body).toMatchObject({ company_id: "co-contratista" });
  expect(writes.find((w) => w.table === "projects")?.body).toMatchObject({ client_name: "HELIOS", colombian_holidays: true });
});

test("ensayos y restricciones: registrar un ensayo y liberar una restricción", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/control");
  await expect(page.getByText("Densidad en campo")).toBeVisible();
  await page.getByLabel("Ensayo / prueba").fill("Resistencia de cilindros");
  await page.getByLabel("Norma").fill("NTC 673");
  await page.getByRole("button", { name: "Agregar" }).first().click();
  await expect.poll(() => writes.find((w) => w.table === "lab_tests" && w.method === "POST")?.body).toMatchObject({ name: "Resistencia de cilindros", standard: "NTC 673", status: "pendiente" });
  await page.getByRole("button", { name: "Liberar" }).click();
  await expect.poll(() => writes.find((w) => w.table === "project_constraints" && w.method === "PATCH")?.body).toEqual({ status: "liberada" });
});

test("permisos: un supervisor ve la web en modo lectura", async ({ page }) => {
  await mockSupabase(page, buildDb("field"));
  await page.goto("/dashboard");
  await expect(page.getByText(/Estás en modo lectura/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Compartir/ })).toHaveCount(0);
  await page.goto("/importar");
  await expect(page.getByText(/Solo el administrador del proyecto puede importar/)).toBeVisible();
  await page.goto("/control");
  await expect(page.getByText(/Solo lectura: los registra el residente/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar" })).toHaveCount(0);
});

test("programación: exportar el avance real a MS Project y a Primavera P6", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/importar");
  await expect(page.getByRole("heading", { name: "Exportar el avance real al cronograma" })).toBeVisible();

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "MS Project (.xml)" }).click();
  const xml = readFileSync(await (await download).path(), "utf8");
  expect(xml).toContain("<Title>Parque Solar Prueba</Title>");
  // BA-HIN: 15 días × 8 = 120 de 200 pilotes → 60 %
  expect(xml).toMatch(/<Name>Hincado de pilotes<\/Name>.*<PercentComplete>60<\/PercentComplete>/);
  await expect(page.getByText(/Exportado al .*: 0 terminada\(s\), 3 en curso, 1 sin iniciar/)).toBeVisible();

  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Primavera P6 (hoja para importar)" }).click();
  const bytes = readFileSync(await (await download).path());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ws = wb.getWorksheet("TASK")!;
  expect(ws.getRow(1).values).toEqual([undefined, "task_code", "task_name", "status_code", "act_start_date", "act_end_date", "phys_complete_pct"]);
  expect(ws.getRow(3).getCell(1).value).toBe("BA-HIN");
  expect(ws.getRow(3).getCell(3).value).toBe("TK_Active");
  expect(ws.getRow(3).getCell(6).value).toBe(60);
});
