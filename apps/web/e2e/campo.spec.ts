import { expect, test } from "@playwright/test";
import { buildDb, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

// Una imagen real: el navegador la convierte a JPEG con la marca de agua antes de guardarla
const PHOTO = "public/icons/icon-192.png";

test.use({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 9.95, longitude: -73.65 }, permissions: ["geolocation"] });

test("campo en el navegador: registro de avance con foto y GPS, guardado en el teléfono y subido", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb("field"));
  page.on("dialog", (d) => void d.accept());
  await page.goto("/campo");
  await expect(page.getByRole("heading", { name: "Registrar en campo" })).toBeVisible();
  await page.getByRole("button", { name: /BA-HIN · Hincado de pilotes/ }).click();
  await expect(page.getByText(/Acumulado .* de 200 pilotes/)).toBeVisible();
  await page.getByLabel("Cantidad").fill("12");
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(page.getByRole("img", { name: "Foto del avance" })).toBeVisible();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText(/Avance BA-HIN: 12 pilotes: guardado en el teléfono/)).toBeVisible();

  // Sube la fila (con su id del teléfono, GPS y quien lo registró), el archivo y el registro de la foto
  await expect.poll(() => writes.filter((w) => w.table === "photos").length).toBe(1);
  const entry = writes.find((w) => w.table === "progress_entries" && w.method === "POST")!.body as Record<string, unknown>;
  // El servidor calcula lat/lon desde la ubicación: escribirlas directo lo rechaza
  expect(entry).toMatchObject({ project_id: PROJECT_ID, quantity: 12, status: "submitted", location: "SRID=4326;POINT(-73.65 9.95)" });
  expect(entry).not.toHaveProperty("lat");
  const file = writes.find((w) => w.table === "storage")!.body as { path: string; bytes: number };
  expect(file.path).toMatch(new RegExp(`^photos/${PROJECT_ID}/${entry.id}/[0-9a-f-]+\\.jpg$`));
  expect(file.bytes).toBeGreaterThan(100);
  await expect(page.getByText("Todo lo registrado aquí ya lo recibió el servidor")).toBeVisible();
});

test("campo en el navegador: el parte diario y el hallazgo se guardan y se suben", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb("field"));
  page.on("dialog", (d) => void d.accept());
  await page.goto("/campo/parte");
  await page.getByRole("button", { name: "Sumar Oficial de obra" }).click();
  await page.getByRole("button", { name: "Sumar Oficial de obra" }).click();
  await page.getByLabel("Inicio de la lluvia").fill("10:00");
  await page.getByLabel("Fin de la lluvia").fill("11:30");
  await page.getByRole("button", { name: "+ Agregar lluvia" }).click();
  await page.getByRole("button", { name: "Enviar parte" }).click();
  await expect.poll(() => writes.find((w) => w.table === "daily_logs")?.body).toMatchObject({
    personnel: [{ role: "Oficial de obra", qty: 2 }],
    rain: [{ start: "10:00", end: "11:30" }],
  });

  await page.goto("/campo/hallazgo");
  await page.getByRole("button", { name: "Crítica" }).click();
  await page.getByRole("button", { name: "Sí, es impeditivo" }).click();
  await page.getByPlaceholder("Qué pasa, dónde y qué hay que corregir").fill("Zanja abierta sin señalizar");
  await page.getByRole("button", { name: "Guardar hallazgo" }).click();
  await expect.poll(() => writes.find((w) => w.table === "findings" && w.method === "POST")?.body).toMatchObject({
    severity: "critical",
    impeditive: true,
    category: "observacion",
    description: "Zanja abierta sin señalizar",
  });
});

test("app instalada: solo las funciones de campo; lo demás queda en la web", async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q === "(display-mode: standalone)" ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList) : real(q));
  });
  await mockSupabase(page, buildDb("field"));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/campo$/);
  const nav = page.getByRole("navigation", { name: "Campo" });
  await expect(nav.getByRole("link", { name: "Registrar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Revisar registros" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Actas de cobro" })).toHaveCount(0);
  await expect(page.getByText(/Instalar en este teléfono/)).toHaveCount(0);
  await nav.getByRole("link", { name: "Pendientes y calidad" }).click();
  await expect(page).toHaveURL(/\/calidad/);
});

test("web en el navegador: conserva todo el menú", async ({ page }) => {
  await mockSupabase(page, buildDb("field"));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Seguimiento" })).toBeVisible();
});

test("sin señal al abrir: no la manda al portal del cliente; reintenta y entra a su obra", async ({ page }) => {
  await mockSupabase(page, buildDb("field"));
  let fails = 1;
  await page.route(/supabase\.mock\/rest\/v1\/memberships/, (r) => (fails-- > 0 ? r.abort() : r.fallback()));
  await page.goto("/campo");
  await expect(page.getByRole("heading", { name: "Registrar en campo" })).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/cliente/);
});

test("web instalable: manifiesto con íconos y entrada al registro de campo", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m).toMatchObject({ name: "AvanceObra", start_url: "/campo", display: "standalone" });
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect((await request.get("/sw.js")).headers()["cache-control"]).toContain("no-cache");
});
