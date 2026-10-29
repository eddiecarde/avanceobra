import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { buildDb, PROJECT_ID, TODAY } from "./fixtures";
import { mockSupabase } from "./mock";

test("informe semanal: secciones del formato del cliente y Excel con sus 4 hojas", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/semanal");
  const sheet = page.locator("article");
  await expect(sheet.getByText("INFORME SEMANAL DE CONSTRUCCIÓN")).toBeVisible();
  await expect(sheet.getByText("HELIOS")).toBeVisible();
  await expect(sheet.getByText("CNX-PRUEBA-001")).toBeVisible();
  for (const s of ["Control de avance por actividad", "Seguimiento semanal de avance", "Personal y equipos por día", "Ensayos y pruebas — estado"])
    await expect(sheet.getByRole("heading", { name: s })).toBeVisible();
  await expect(sheet.getByText("Densidad en campo")).toBeVisible();
  await expect(sheet.getByText(/Restricción abierta: Falta permiso de servidumbre/)).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exportar Excel/ }).click();
  const file = await (await download).path();
  const wb = new ExcelJS.Workbook();
  const bytes = readFileSync(file);
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["REPORTE SEMANAL", "EJECUTADO", "%", "SEGUIMIENTO SEMANAL"]);
  const rs = wb.getWorksheet("REPORTE SEMANAL")!;
  const text = rs.getSheetValues().flat().filter(Boolean).map(String).join(" ");
  expect(text).toContain("CNX-PRUEBA-001");
  expect(text).toContain("Oficial de obra");
  expect(text).toContain("10:00 – 10:45");
});

test("informe diario: resumen del día y producción por actividad", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto(`/informe?p=${PROJECT_ID}&d=${TODAY}`);
  const sheet = page.locator("article");
  await expect(sheet.getByText("Informe diario de obra")).toBeVisible();
  for (const s of [
    "Resumen ejecutivo",
    "Situaciones del día",
    "Actividades que requieren atención",
    "Producción del día",
    "Hallazgos y riesgos",
    "Anexo A · Seguimiento completo de actividades",
  ])
    await expect(sheet.getByRole("heading", { name: s })).toBeVisible();
  await expect(sheet.getByRole("cell", { name: /BA-HIN/ }).first()).toBeVisible();
  await expect(sheet.getByText("8 pilotes").first()).toBeVisible();
  // Personal del parte diario (no la suma de cuadrillas) y criterios del semáforo documentados
  await expect(sheet.getByText("Parte diario · 2 equipo(s)")).toBeVisible();
  await expect(sheet.getByText("Criterios del semáforo")).toBeVisible();
});

test("informe semanal: análisis antes de los anexos, con gráficos y desviaciones", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/semanal");
  const sheet = page.locator("article");
  for (const s of ["Resumen semanal", "Situaciones de la semana", "Gráficos y tendencias", "Análisis de desviaciones", "Riesgos y acciones pendientes"])
    await expect(sheet.getByRole("heading", { name: s })).toBeVisible();
  await expect(sheet.getByRole("img", { name: /Curva S al/ })).toBeVisible();
  await expect(sheet.getByText("Fecha compromiso: no registrada").first()).toBeVisible();
  // Las desviaciones por actividad no se repiten en la lista de riesgos
  await expect(sheet.getByText(/ejecutado contra .* programado \(desviación/)).toHaveCount(0);
});

test("simulador: sin costos guía a cargarlos en vez de mostrar escenarios iguales", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/simulador");
  await expect(page.getByRole("heading", { name: "¿Acelerar o pagar la multa?" })).toBeVisible();
  await expect(page.getByText("Faltan costos para comparar")).toBeVisible();
  await expect(page.getByRole("link", { name: "Rendimientos y costos" }).last()).toHaveAttribute("href", "/biblioteca");
  await expect(page.getByText("Base: continuar igual")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exportar Excel" })).toBeDisabled();
});

test("simulador: con costos compara escenarios y recomienda", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/simulador");
  await page.getByLabel("Equipo por día de BB-HIN").fill("3000000");
  await expect(page.getByText("Faltan costos para comparar")).toHaveCount(0);
  await expect(page.getByText("Recomendación", { exact: false }).first()).toBeVisible();
  for (const s of ["Base: continuar igual", "Aceptar multa y reclamar"]) await expect(page.getByText(s).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Costo total vs. días de retraso" })).toBeVisible();
});
