// Respaldo de los datos de la base (todas las tablas de public y los usuarios de auth) en JSON, una
// carpeta por fecha. El esquema está en supabase/migrations; esto guarda los datos.
// Uso: node scripts/backup-db.mjs [carpeta]   (por defecto ~/Documents/AvanceObra-respaldos)
// Lee SUPABASE_ACCESS_TOKEN de supabase/.secrets.local. Las fotos (Storage) no se incluyen.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync("supabase/.secrets.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const REF = "jxhewajalkuarupdwwiq";
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
};

const stamp = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dir = join(process.argv[2] ?? join(homedir(), "Documents", "AvanceObra-respaldos"), stamp);
mkdirSync(dir, { recursive: true });

const tables = (await sql(
  "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'spatial_ref_sys' order by 1",
)).map((r) => r.table_name);
const summary = {};
for (const t of tables) {
  // En páginas de 5.000 filas para no pasar el límite de respuesta
  const rows = [];
  for (let off = 0; ; off += 5000) {
    const page = await sql(`select coalesce(json_agg(x), '[]') as d from (select * from public."${t}" order by 1 limit 5000 offset ${off}) x`);
    rows.push(...page[0].d);
    if (page[0].d.length < 5000) break;
  }
  writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows));
  summary[t] = rows.length;
}
const users = await sql("select coalesce(json_agg(x), '[]') as d from (select id, email, raw_user_meta_data, created_at, last_sign_in_at from auth.users) x");
writeFileSync(join(dir, "auth_users.json"), JSON.stringify(users[0].d));
summary["auth.users"] = users[0].d.length;
writeFileSync(join(dir, "_resumen.json"), JSON.stringify({ fecha: stamp, proyecto: REF, filas: summary }, null, 2));
console.log(dir);
console.log(Object.entries(summary).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(" · "));
