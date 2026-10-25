import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de punta a punta de la web. La app se compila aparte (.next-e2e) apuntando a un
 * Supabase ficticio (http://supabase.mock) que cada prueba simula con page.route: no se usan
 * cuentas reales ni se tocan los datos en vivo.
 */
const PORT = 3200;
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "es-CO", timezoneId: "America/Bogota", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase.mock",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "clave-publica-de-prueba",
      NEXT_PUBLIC_MAP_STYLE_URL: "http://tiles.mock/style.json",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
