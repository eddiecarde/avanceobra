import { expect, test } from "@playwright/test";
import { buildDb } from "./fixtures";
import { mockSupabase } from "./mock";

test("hoy: lo que requiere atención según el rol, con enlace a donde se resuelve", async ({ page }) => {
  await mockSupabase(page, buildDb("resident"));
  await page.goto("/hoy");
  await expect(page.getByRole("heading", { name: "Requiere tu atención" })).toBeVisible();
  // Fixture: 2 registros enviados sin aprobar y 1 hallazgo crítico vencido
  await expect(page.getByText("2 registro(s) por aprobar")).toBeVisible();
  await expect(page.getByRole("link", { name: "Revisar registros →" })).toHaveAttribute("href", "/registros");
  await expect(page.getByText(/hallazgo\(s\) abierto\(s\)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Actividades más comprometidas" })).toBeVisible();
});

test("pregúntale a tu obra: envía los datos calculados y muestra el sustento", async ({ page }) => {
  const db = buildDb();
  let sent: Record<string, unknown> | null = null;
  db.functions = {
    ...db.functions,
    "ai-assist": (body) => {
      sent = body;
      return [200, { answer: "BB-HIN es la más atrasada.", sources: [{ kind: "actividad", ref: "BB-HIN", label: "BB-HIN · Hincado de pilotes" }], missing: "", ungrounded: [], cutoff: (body.facts as { corte: string }).corte }];
    },
  };
  await mockSupabase(page, db);
  await page.goto("/hoy");
  await page.getByRole("button", { name: "¿Qué actividades están más atrasadas y qué se recomienda?" }).click();
  await expect(page.getByText("BB-HIN es la más atrasada.")).toBeVisible();
  await expect(page.getByText("actividad: BB-HIN · Hincado de pilotes")).toBeVisible();
  expect(sent!.action).toBe("ask");
  expect(JSON.stringify(sent!.facts)).toContain("actividades_que_requieren_atencion");
});
