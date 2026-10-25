// Empaqueta el motor de cálculo (packages/engine) como un solo módulo ESM para las Edge Functions
// (Deno no resuelve los imports ".js" de los fuentes TypeScript del paquete).
// Uso: npm run build:functions  (lo corren también test:functions y el despliegue)
import { build } from "esbuild";

await build({
  entryPoints: ["packages/engine/src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "supabase/functions/_shared/engine.js",
  banner: { js: "// GENERADO por scripts/build-functions.mjs desde packages/engine. No editar a mano.\n// deno-lint-ignore-file" },
  logLevel: "info",
});
