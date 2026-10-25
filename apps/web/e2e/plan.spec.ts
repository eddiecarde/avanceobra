import { addDays, mondayOf } from "@avanceobra/engine";
import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

const thisMonday = mondayOf(day(0));

test("plan semanal: solo lo liberado entra y el plan se compromete", async ({ page }) => {
  const db = buildDb();
  // BB-HIN (a3) tiene una restricción abierta: no se puede comprometer
  db.tables.project_constraints!.push({ id: "c2", project_id: PROJECT_ID, activity_id: "a3", description: "Falta liberar el predio del bloque B", responsible: "Cliente", need_by: day(5), status: "abierta", released_at: null, created_at: `${day(-1)}T15:00:00Z` });
  db.tables.weekly_plans = [];
  db.tables.weekly_plan_items = [];
  const writes = await mockSupabase(page, db);
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Programación a 3 semanas" })).toBeVisible();
  await expect(page.getByRole("row", { name: /^BB-HIN/ })).toContainText("1 restricción(es)");
  await expect(page.getByLabel("Incluir BB-HIN en el plan")).toBeDisabled();
  await expect(page.getByRole("row", { name: /^BA-HIN/ })).toContainText("Liberada");

  await page.getByLabel("Incluir BA-HIN en el plan").check();
  await page.getByLabel("Cantidad de BA-HIN").fill("40");
  await page.getByLabel("Responsable de BA-HIN").fill("Cuadrilla 1");
  await page.getByRole("button", { name: "Comprometer plan de la semana" }).click();
  await expect(page.getByText(/comprometido\./)).toBeVisible();

  expect(writes.find((w) => w.table === "weekly_plans" && w.method === "POST")?.body).toMatchObject({ project_id: PROJECT_ID, week_start: addDays(thisMonday, 7) });
  expect(writes.find((w) => w.table === "weekly_plan_items" && w.method === "POST")?.body).toMatchObject({ activity_id: "a1", planned_qty: 40, responsible: "Cuadrilla 1" });
  expect(writes.find((w) => w.table === "weekly_plans" && w.method === "PATCH")?.body).toMatchObject({ status: "comprometido" });
});

test("cerrar la semana: cumplimiento con lo registrado, causas y PPC", async ({ page }) => {
  const db = buildDb();
  const lastMonday = addDays(thisMonday, -7);
  db.tables.weekly_plans = [{ id: "wp1", project_id: PROJECT_ID, week_start: lastMonday, status: "comprometido" }];
  db.tables.weekly_plan_items = [
    // BA-HIN se registra 8 por día: con 7 días de la semana pasada pasa de 10
    { id: "wi1", plan_id: "wp1", project_id: PROJECT_ID, activity_id: "a1", planned_qty: 10, responsible: null, executed_qty: null, done: null, failure_cause: null, failure_note: null },
    { id: "wi2", plan_id: "wp1", project_id: PROJECT_ID, activity_id: "a4", planned_qty: 100000, responsible: null, executed_qty: null, done: null, failure_cause: null, failure_note: null },
  ];
  const writes = await mockSupabase(page, db);
  await page.goto("/plan");
  await page.getByRole("button", { name: "Semana anterior" }).click();
  await page.getByRole("button", { name: "Semana anterior" }).click();
  await expect(page.getByRole("heading", { name: "Cumplimiento de la semana" })).toBeVisible();
  // Sin la causa de lo no cumplido no se cierra
  await page.getByRole("button", { name: "Cerrar semana y calcular PPC" }).click();
  await expect(page.getByText("Falta la causa de 1 tarea(s) no cumplida(s).")).toBeVisible();
  await page.getByLabel("Causa de BB-ZAN").selectOption({ label: "Material" });
  await page.getByLabel("Detalle de BB-ZAN").fill("No llegó la tubería");
  await page.getByRole("button", { name: "Cerrar semana y calcular PPC" }).click();
  await expect(page.getByText("Semana cerrada: plan cumplido 50 %.")).toBeVisible();
  const patches = writes.filter((w) => w.table === "weekly_plan_items" && w.method === "PATCH").map((w) => w.body as Record<string, unknown>);
  expect(patches).toContainEqual(expect.objectContaining({ done: true, failure_cause: null }));
  expect(patches).toContainEqual(expect.objectContaining({ done: false, failure_cause: "material", failure_note: "No llegó la tubería" }));
  expect(writes.find((w) => w.table === "weekly_plans" && w.method === "PATCH")?.body).toMatchObject({ status: "cerrado" });
});
