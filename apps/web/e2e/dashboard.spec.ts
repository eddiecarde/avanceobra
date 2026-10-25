import { expect, test } from "@playwright/test";
import { buildDb, day } from "./fixtures";
import { mockSupabase } from "./mock";

test("inicia sesión y llega al dashboard de la obra", async ({ page }) => {
  await mockSupabase(page, buildDb(), { loggedIn: false });
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel(/correo/i).fill("e2e@avanceobra.test");
  await page.getByLabel(/contraseña/i).fill("clave-de-prueba");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Parque Solar Prueba", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
});

test("dashboard: indicadores, semáforos, Pareto y pendientes", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  await expect(page.getByText("Avance físico")).toBeVisible();
  // Resumen: indicadores, curva S, avance por actividad, alertas, cantidades, faltantes, plano y punch list
  for (const h of ["Curva S del proyecto", "Avance por actividad", "Alertas y notificaciones", "Cantidades ejecutadas y aprobadas", "Faltantes por contratista y subcampo", "Resumen ejecutivo", "Plano de avance", "Punch list de calidad"])
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Zanja sin señalizar" })).toBeVisible();
  // Alertas reales enviadas por el sistema (con su antigüedad), no las calculadas
  await expect(page.getByText("Baja la productividad")).toBeVisible();
  await expect(page.getByText(/^Enviadas por el sistema/)).toBeVisible();
  await expect(page.getByText("Hallazgo vencido: Zanja sin señalizar")).toHaveCount(0);
  await page.getByRole("tab", { name: "Avance" }).click();
  for (const h of ["Curva S", "Semáforo por actividad", "Pareto de causas", "Plano de avance"]) await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
  // Una fila por actividad, con su estado
  for (const code of ["BA-HIN", "BA-MON", "BB-HIN", "BB-ZAN"]) await expect(page.getByRole("cell", { name: new RegExp(`^${code}`) }).first()).toBeVisible();
  // Pareto: clima es la primera causa (3 h) y material la segunda (1 h)
  await expect(page.getByRole("cell", { name: "Clima" })).toBeVisible();
  await page.getByRole("tab", { name: "Calidad" }).click();
  await expect(page.getByRole("heading", { name: /Pendientes \(2\)/ })).toBeVisible();
  await expect(page.getByText("Zanja sin señalizar")).toBeVisible();
});

test("dashboard: la fecha de corte recalcula el avance", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  const kpi = page.locator("text=Avance físico").locator("..");
  await expect(kpi).toContainText("%");
  const before = await kpi.innerText();
  await page.getByLabel("Fecha de corte").fill(day(-10));
  await expect(kpi).not.toHaveText(before);
});

test("dashboard: crear un enlace de solo lectura", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  // Compartir queda detrás de un botón en la cabecera
  await expect(page.getByPlaceholder(/Interventoría Consorcio/)).toHaveCount(0);
  await page.getByRole("button", { name: "Compartir" }).click();
  await page.getByPlaceholder(/Interventoría Consorcio/).fill("Interventoría de prueba");
  await page.getByRole("button", { name: "Crear y copiar enlace" }).click();
  await expect(page.getByText("Enlace copiado")).toBeVisible();
  const insert = writes.find((w) => w.table === "share_links" && w.method === "POST");
  expect(insert?.body).toMatchObject({ label: "Interventoría de prueba", include_findings: true });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/ver\?t=token-enlace-prueba$/);
});

test("enlace compartido: se ve sin sesión, en solo lectura", async ({ page }) => {
  await mockSupabase(page, buildDb(), { loggedIn: false });
  await page.goto("/ver?t=token-valido");
  await expect(page.getByText("Solo lectura")).toBeVisible();
  await expect(page.getByText(/Enlace para Interventoría/)).toBeVisible();
  // Sin sesión no se leen las alertas enviadas: se ven las calculadas al corte
  await expect(page.getByText("Hallazgo vencido: Zanja sin señalizar")).toBeVisible();
  await page.getByRole("tab", { name: "Avance" }).click();
  await expect(page.getByRole("heading", { name: "Semáforo por actividad" })).toBeVisible();
  // Sin menú de administración ni opción de compartir
  await expect(page.getByRole("link", { name: "Formatos" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Compartir/ })).toHaveCount(0);
});

test("enlace compartido inválido muestra el aviso", async ({ page }) => {
  await mockSupabase(page, buildDb(), { loggedIn: false });
  await page.goto("/ver?t=otro");
  await expect(page.getByText(/no es válido, venció o fue revocado/)).toBeVisible();
});

test("menú: 4 grupos y debajo las páginas del grupo, sin desbordar en el celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  const groups = page.getByRole("navigation", { name: "Secciones" });
  await expect(groups.getByRole("link")).toHaveText(["Seguimiento", "Decisiones", "Campo", "Ajustes"]);
  await expect(page.getByRole("navigation", { name: "Seguimiento" }).getByRole("link")).toHaveText(["Dashboard", "Gerencia", "Centro de control", "Plan semanal", "Informe diario", "Informe semanal"]);
  await groups.getByRole("link", { name: "Ajustes" }).click();
  await expect(page).toHaveURL(/\/proyecto$/);
  await expect(page.getByRole("navigation", { name: "Ajustes" }).getByRole("link", { name: "Equipo" })).toBeVisible();
  for (const p of ["/dashboard", "/informe", "/semanal"]) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), p).toBeLessThanOrEqual(390);
  }
});

test("dashboard: puesta a punto del piloto y avance por empresa", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Puesta a punto del piloto · \d de 6 listas/ })).toBeVisible();
  const checklist = page.locator("div.border-l-amber-500");
  await expect(checklist.getByRole("link", { name: "Cargar costos →" })).toHaveAttribute("href", "/biblioteca");
  await expect(checklist.getByText("1 de 4 actividades con empresa")).toBeVisible();
  await checklist.getByRole("button", { name: "Ocultar" }).click();
  await expect(page.getByRole("button", { name: /Puesta a punto del piloto: \d de 6 listas · ver/ })).toBeVisible();

  await page.getByRole("tab", { name: "Contratistas" }).click();
  await expect(page.getByRole("heading", { name: "Avance por empresa" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Contratista Constructora Demo 1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sin empresa asignada 3/ })).toBeVisible();
  // El Pareto se puede ver solo para una empresa: BA-MON no tiene pérdidas registradas
  await page.getByRole("tab", { name: "Avance" }).click();
  await page.getByLabel("Empresa").selectOption({ label: "Constructora Demo" });
  await expect(page.getByRole("cell", { name: "Clima" })).toHaveCount(0);
});
