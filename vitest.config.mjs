import { defineConfig } from "vitest/config";

// Pruebas de las Edge Functions (supabase/tests): en Deno se importa "npm:pdf-lib@…";
// aquí se resuelve al paquete instalado en node_modules.
export default defineConfig({
  resolve: { alias: { "npm:pdf-lib@1.17.1": "pdf-lib" } },
});
