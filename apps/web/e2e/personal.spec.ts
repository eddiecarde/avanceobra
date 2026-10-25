import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

test("personal, equipos y lluvia: días-persona y días reclamables por lluvia en la jornada", async ({ page }) => {
  const db = buildDb();
  // Aguacero de 05:00 a 16:00: solo cuentan 9 h dentro de la jornada (07:00–17:00) y el día no pasa de 8 h
  db.tables.daily_log_latest!.push({
    project_id: PROJECT_ID,
    log_date: day(-3),
    personnel: [{ role: "Oficial de obra", qty: 10 }],
    equipment: [{ name: "Hincadora", qty: 1 }],
    rain: [{ start: "05:00", end: "16:00" }],
    observations: "",
  });
  await mockSupabase(page, db);
  await page.goto("/personal");
  await expect(page.getByRole("heading", { name: "Personal, equipos y lluvia" })).toBeVisible();
  // 12 + 10 personas en dos días
  await expect(page.locator("p").filter({ hasText: /^Días-persona$/ }).locator("..")).toContainText("22");
  await expect(page.getByText("Personal promedio por día").locator("..")).toContainText("11");
  await expect(page.getByRole("row", { name: /Oficial de obra 14 7 10/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Hincadora 3 1,5 2/ })).toBeVisible();
  // 8 h (aguacero) + 3 h (registro de avance por clima) + 0,75 h (lluvia corta) = 11,75 h → 1 día
  await expect(page.locator("p").filter({ hasText: /^Días reclamables por lluvia$/ }).locator("..")).toContainText("1");
  await expect(page.getByRole("row", { name: /05:00–16:00 9 h — 8 h/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /— 0 h 3 h 3 h/ })).toBeVisible();
  await expect(page.getByText("Total: 1 día(s) reclamables")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar soporte (Excel)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^reclamo_lluvia_.*\.xlsx$/);
});
