import { expect, test } from "@playwright/test";
import { buildDb, day } from "./fixtures";
import { mockSupabase } from "./mock";

test("dashboard: cantidades ejecutadas, aprobadas y saldo por actividad", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  await expect(page.getByRole("definition").filter({ hasText: /^\d+(,\d)? %$/ }).nth(2)).toBeVisible();
  await page.getByRole("tab", { name: "Cantidades" }).click();
  await expect(page.getByRole("heading", { name: "Cantidades por actividad" })).toBeVisible();
  // BA-HIN: 200 contratados, 15 días × 8 = 120 ejecutados, los 2 últimos días (16) aún por aprobar
  const row = page.getByRole("row", { name: /^BA-HIN · Hincado de pilotes pilotes 200/ });
  await expect(row).toContainText("200");
  await expect(row).toContainText("120");
  await expect(row).toContainText("104");
  await expect(row).toContainText("16");
  await expect(row).toContainText("96");
});

test("registros: el residente aprueba lo enviado", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/registros");
  await page.getByLabel("Estado").selectOption("submitted");
  await expect(page.getByRole("button", { name: "Aprobar" })).toHaveCount(2);
  await page.getByRole("button", { name: "Aprobar" }).first().click();
  await expect(page.getByText("Registro aprobado.")).toBeVisible();
  expect(writes.find((w) => w.table === "progress_entries" && w.method === "PATCH")?.body).toEqual({ status: "approved" });
});

test("registros: corrección de un aprobado con motivo, aprobación y versión", async ({ page }) => {
  const db = buildDb();
  await mockSupabase(page, db);
  await page.goto("/registros");
  await page.getByLabel("Desde").fill(day(-14));
  const first = page.getByRole("row", { name: new RegExp(`^${day(-14)} BA-HIN`) });
  await first.getByRole("button", { name: "Pedir corrección" }).click();
  await page.getByLabel(/^Cantidad \(pilotes\)/).fill("5");
  await page.getByRole("button", { name: "Enviar corrección" }).click();
  await expect(page.getByText("Explica el motivo de la corrección (al menos 10 letras).")).toBeVisible();
  await page.getByLabel(/Motivo de la corrección/).fill("Se digitó 8 en vez de 5; verificado con el plano");
  await page.getByRole("button", { name: "Enviar corrección" }).click();
  await expect(page.getByText(/Corrección enviada/)).toBeVisible();
  expect(db.tables.entry_corrections![0]).toMatchObject({ entry_id: "e1", proposed: { quantity: 5 }, previous: { quantity: 8 }, status: "pendiente" });

  // Pendiente: muestra el cambio y se decide (rechazar exige nota)
  await expect(page.getByRole("heading", { name: "Correcciones pendientes (1)" })).toBeVisible();
  await expect(page.getByText("Cantidad: 8 → 5")).toBeVisible();
  const pending = page.getByRole("listitem").filter({ hasText: "Cantidad: 8 → 5" });
  await pending.getByRole("button", { name: "Rechazar" }).click();
  await expect(page.getByText("Explica por qué se rechaza")).toBeVisible();
  await pending.getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByText("Corrección aprobada y aplicada al registro.")).toBeVisible();
  expect(db.tables.progress_entries!.find((e) => e.id === "e1")).toMatchObject({ quantity: 5, version: 2 });

  // Historial de versiones del registro
  await page.getByRole("button", { name: "Historial (1)" }).click();
  await expect(page.getByText("Aprobada · versión 2")).toBeVisible();
  await expect(page.getByText(/Motivo: Se digitó 8 en vez de 5/)).toBeVisible();
});
