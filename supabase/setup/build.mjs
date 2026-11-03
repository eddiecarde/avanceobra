// Une migraciones + semilla en un solo archivo para pegar en el SQL Editor de Supabase.
// Uso: npm run db:bundle
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const mig = join(root, "supabase", "migrations");
const parts = readdirSync(mig).sort().map((f) => `-- >>>>> ${f}\n${readFileSync(join(mig, f), "utf8")}`);
parts.push(`-- >>>>> seed/demo_solar.sql\n${readFileSync(join(root, "supabase", "seed", "demo_solar.sql"), "utf8")}`);
const out = join(root, "supabase", "setup", "01_esquema_y_semilla.sql");
writeFileSync(
  out,
  `-- GENERADO por supabase/setup/build.mjs — no editar a mano.\n-- Pegar completo en Supabase > SQL Editor > New query > Run.\n\n${parts.join("\n\n")}`,
);
console.log(`Escrito ${out}`);
