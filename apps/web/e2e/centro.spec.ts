import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

test("centro de control: las cuatro preguntas, empresas y filtros", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/centro");
  await expect(page.getByRole("heading", { name: "Centro de control" })).toBeVisible();
  for (const q of [
    "1 · ¿Cuánto debíamos ejecutar y cuánto se ejecutó?",
    "2 · ¿Cuánto está verificado y aprobado?",
    "3 · ¿Qué impide avanzar y quién debe resolverlo?",
    "4 · ¿Cuánto cuesta el atraso y cuál es la fecha realista?",
  ])
    await expect(page.getByRole("heading", { name: q })).toBeVisible();
  await expect(page.getByText(/% ejecutado de .*% programado/)).toBeVisible();
  // Los 2 últimos días de BA-HIN están por aprobar
  await expect(page.getByText(/^2 registro\(s\) por aprobar/)).toBeVisible();
  // La restricción abierta con su responsable y el hallazgo crítico
  await expect(page.getByText("Falta permiso de servidumbre")).toBeVisible();
  await expect(page.getByText("Cliente", { exact: true })).toBeVisible();
  await expect(page.getByText("Zanja sin señalizar")).toBeVisible();
  await expect(page.getByRole("link", { name: "Simular cuánto cuesta acelerar →" })).toHaveAttribute("href", "/simulador");
  // Comparación por empresa
  await expect(page.getByRole("row", { name: /^Contratista Constructora Demo 1 / })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Sin empresa asignada 3 / })).toBeVisible();
  // Filtro por subcampo
  await page.getByLabel("Subcampo").selectOption("SC-02");
  await expect(page.getByText(/1 de 4 actividades con estos filtros/)).toBeVisible();
  await expect(page.getByRole("row", { name: /^BB-HIN · Hincado de pilotes Sin empresa SC-02 \/ C-02/ })).toBeVisible();
});
