// Uso: npm run db:check
// Valida migraciones + semilla en PGlite (Postgres WASM) con PostGIS y stubs de Supabase (auth, storage).
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url));
const db = new PGlite({ extensions: { postgis } });

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text unique, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

let failures = 0;
const ok = (msg) => console.log("  ✓ " + msg);
const fail = (msg) => { failures++; console.log("  ✗ " + msg); };

async function run(label, sql) {
  try {
    await db.exec(sql);
    ok(label);
  } catch (e) {
    fail(`${label}: ${e.message}${e.position ? ` (posición ${e.position})` : ""}${e.where ? ` · ${e.where}` : ""}`);
    process.exit(1);
  }
}

async function expectError(label, sql, pattern) {
  try {
    await db.exec(sql);
    fail(`${label}: se esperaba error y no lo hubo`);
  } catch (e) {
    if (pattern.test(e.message)) ok(`${label} → "${e.message}"`);
    else fail(`${label}: error inesperado "${e.message}"`);
  }
}

const one = async (sql, params) => {
  try {
    return (await db.query(sql, params)).rows[0];
  } catch (e) {
    fail(`${sql.slice(0, 80)}…: ${e.message}${e.where ? ` · ${e.where.split(String.fromCharCode(10)).slice(-2).join(" | ")}` : ""}`);
    process.exit(1);
  }
};

async function as(userId, fn) {
  // Como PostgREST: el JWT trae el usuario (sub) y el rol
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false), set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`);
  }
}

console.log("Migraciones");
await run("stubs de Supabase", STUBS);
const migDir = join(root, "supabase", "migrations");
for (const f of readdirSync(migDir).sort()) await run(f, readFileSync(join(migDir, f), "utf8"));
await run("seed/demo_solar.sql", readFileSync(join(root, "supabase", "seed", "demo_solar.sql"), "utf8"));
await run(
  "permisos del rol authenticated (como en Supabase)",
  `grant usage on schema public, auth, storage to authenticated;
   grant all on all tables in schema public to authenticated;
   grant select on auth.users to authenticated;
   grant all on all tables in schema storage to authenticated;
   grant execute on all functions in schema public, auth, storage to authenticated;`,
);

console.log("\nSemilla");
const ADMIN = "11111111-1111-4111-8111-111111111111";
const FIELD = "22222222-2222-4222-8222-222222222222";
const RES = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${ADMIN}', 'admin@demo.co', '{"full_name":"Ana Directora"}'),
  ('${FIELD}', 'campo@demo.co', '{"full_name":"Carlos Supervisor"}'),
  ('${RES}', 'residente@demo.co', '{"full_name":"Rosa Residente"}'),
  ('${OTHER}', 'otro@demo.co', '{}')`);
await expectError("usuario inexistente", "select seed_demo_solar('nadie@demo.co')", /No existe el usuario/);
const { seed_demo_solar: projectId } = await one("select seed_demo_solar('admin@demo.co', 'campo@demo.co', 'residente@demo.co')");
ok(`proyecto creado ${projectId}`);
const again = await one("select seed_demo_solar('admin@demo.co')");
again.seed_demo_solar === projectId ? ok("idempotente: segunda ejecución devuelve el mismo proyecto") : fail("no idempotente");

const counts = await one(`select
  (select count(*) from fronts)::int fronts, (select count(*) from activities)::int acts,
  (select count(*) from elements where kind='tracker')::int trackers, (select count(*) from elements where kind='pile')::int piles,
  (select count(*) from progress_entries)::int entries, (select count(*) from entry_elements)::int marks,
  (select count(*) from progress_areas)::int areas, (select count(*) from findings)::int findings,
  (select count(*) from alerts)::int alerts, (select count(*) from memberships)::int members`);
console.log("  ", counts);
counts.trackers === 48 && counts.piles === 384 ? ok("48 trackers y 384 pilotes") : fail("conteo de elementos");
counts.alerts === 1 ? ok("el hallazgo crítico generó 1 alerta automática") : fail(`alertas: ${counts.alerts}`);

const progress = (await db.query(
  `select a.code, a.unit, a.contract_qty::float qty, ap.executed_qty::float done, ap.pct::float pct
   from activity_progress ap join activities a on a.id = ap.activity_id order by a.code`)).rows;
console.table(progress);

const area = await one("select round(sum(area_m2)) m2, min(lat) is not null as has_lat from progress_areas, (select lat from progress_entries limit 1) x");
area.m2 > 0 ? ok(`áreas de zanja calculadas con geography: ${area.m2} m²`) : fail("área");
const pareto = (await db.query(
  `select loss_cause, sum(lost_hours)::float horas from progress_entries where loss_cause <> 'none' group by 1 order by 2 desc`)).rows;
console.log("   Pareto de horas perdidas:", pareto.map((r) => `${r.loss_cause}=${r.horas}`).join(", "));
const geo = await one("select geojson from elements where code = 'A-T01'");
geo.geojson.includes('"Polygon"') ? ok("geojson generado para el plano") : fail("geojson");

console.log("\nReglas de negocio con RLS (rol authenticated)");
await as(OTHER, async () => {
  const r = await one("select count(*)::int n from progress_entries");
  r.n === 0 ? ok("usuario sin membresía no ve datos del proyecto") : fail(`usuario ajeno ve ${r.n} registros`);
});

const ids = await one(`select
  (select id from activities where code='BB-HIN') act, (select front_id from activities where code='BB-HIN') front,
  (select id from progress_entries where status='approved' limit 1) approved,
  (select id from progress_entries where status='submitted' limit 1) submitted,
  (select id from findings where status='open' and severity='medium') finding`);

await as(FIELD, async () => {
  await run("supervisor inserta un avance con ubicación EWKT (como lo envía la app)", `
    insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, location,
      "values", created_by, device_id, client_created_at)
    values ('99999999-9999-4999-8999-999999999999', '${projectId}', '${ids.front}', '${ids.act}', current_date, 7, 8,
      'SRID=4326;POINT(-73.6487 9.9505)', '{"obs":"ok"}', '${FIELD}', 'test', now());
    insert into progress_areas (id, project_id, entry_id, geom)
    values (gen_random_uuid(), '${projectId}', '99999999-9999-4999-8999-999999999999',
      'SRID=4326;POLYGON((-73.65 9.95, -73.6499 9.95, -73.6499 9.9501, -73.65 9.9501, -73.65 9.95))');`);
  const r = await one("select lat, lon from progress_entries where id = '99999999-9999-4999-8999-999999999999'");
  Math.abs(r.lat - 9.9505) < 1e-9 ? ok("lat/lon derivados de la geometría para el móvil") : fail("lat/lon");
  await expectError("supervisor no puede aprobar", `update progress_entries set status='approved' where id='${ids.submitted}'`, /residente/);
  await db.exec(`update progress_entries set quantity = 1 where id='${ids.approved}'`);
  const q = await one(`select quantity::float q from progress_entries where id='${ids.approved}'`);
  q.q !== 1 ? ok(`supervisor no puede modificar un aprobado (RLS: 0 filas, sigue en ${q.q})`) : fail("aprobado modificado");
  await db.exec(`delete from progress_entries where id='${ids.submitted}'`);
  const del = await one(`select count(*)::int n from progress_entries where id='${ids.submitted}'`);
  del.n === 1 ? ok("supervisor no puede borrar registros enviados (sin política DELETE)") : fail("registro borrado");
  await expectError("transición inválida de hallazgo", `update findings set status='closed' where id='${ids.finding}'`, /Transición no permitida/);
  await expectError("supervisor inserta como otro usuario", `
    insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, created_by, device_id, client_created_at)
    values (gen_random_uuid(), '${projectId}', '${ids.front}', '${ids.act}', current_date, 1, '${RES}', 't', now())`, /row-level security/);
});

await as(FIELD, async () => {
  await db.exec(`insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, status, created_by, device_id, client_created_at)
    values ('88888888-8888-4888-8888-888888888888', '${projectId}', '${ids.front}', '${ids.act}', current_date, 1, 'draft', '${FIELD}', 't', now())`);
  await db.exec(`delete from progress_entries where id='88888888-8888-4888-8888-888888888888'`);
  const g = await one(`select count(*)::int n from progress_entries where id='88888888-8888-4888-8888-888888888888'`);
  g.n === 0 ? ok("el autor sí puede borrar su borrador") : fail("borrador no borrado");
});

await as(RES, async () => {
  await expectError("ni el residente modifica un aprobado (trigger)", `update progress_entries set quantity = 1 where id='${ids.approved}'`, /aprobado/);
  await db.exec(`delete from progress_entries where id='${ids.submitted}'`);
  const kept = await one(`select count(*)::int n from progress_entries where id='${ids.submitted}'`);
  kept.n === 1 ? ok("ni el residente borra un registro enviado") : fail("residente borró un enviado");
  await run("residente aprueba un registro enviado", `update progress_entries set status='approved' where id='${ids.submitted}'`);
  const r = await one(`select approved_by from progress_entries where id='${ids.submitted}'`);
  r.approved_by === RES ? ok("approved_by lo fija el servidor") : fail("approved_by");
  // Conflicto: el residente cambia el hallazgo (versión 1 → 2)
  await run("residente pasa hallazgo a 'en corrección'", `select update_finding_synced('${ids.finding}', '{"status":"in_correction"}', 1)`);
});

await as(FIELD, async () => {
  // El supervisor, offline, había visto la versión 1 y cambia la severidad
  const r = await one(`select update_finding_synced('${ids.finding}', '{"severity":"high"}', 1) as res`);
  r.res.conflict === true ? ok("cambio concurrente de otro usuario → conflicto registrado") : fail(`conflicto: ${JSON.stringify(r.res)}`);
  const f = await one(`select severity, status, version from findings where id='${ids.finding}'`);
  f.severity === "high" && f.status === "in_correction" ? ok("última modificación gana sin perder el cambio del otro") : fail(JSON.stringify(f));
  const r2 = await one(`select update_finding_synced('${ids.finding}', '{"severity":"critical"}', 1) as res`);
  r2.res.conflict === false ? ok("segunda edición offline del mismo usuario no es conflicto") : fail("falso conflicto");
  const c = await one("select count(*)::int n from sync_conflicts");
  c.n === 1 ? ok("1 conflicto visible para revisar") : fail(`conflictos: ${c.n}`);
});

console.log("\nCatálogo editable desde la app");
await as(FIELD, async () => {
  await db.exec(`insert into fronts (id, project_id, code, name) values (gen_random_uuid(), '${projectId}', 'BX', 'Intento supervisor')`).then(
    () => fail("el supervisor pudo crear un frente"),
    (e) => (/row-level security/.test(e.message) ? ok("el supervisor no puede crear frentes (RLS)") : fail(e.message)),
  );
});
await as(ADMIN, async () => {
  await run("el administrador crea un frente y una actividad", `
    insert into fronts (id, project_id, code, name) values ('77777777-7777-4777-8777-777777777777', '${projectId}', 'BC', 'Bloque C');
    insert into activities (id, project_id, front_id, code, name, unit, contract_qty)
    values (gen_random_uuid(), '${projectId}', '77777777-7777-4777-8777-777777777777', 'BC-HIN', 'Hincado de pilotes', 'pilotes', 1000);`);
  await expectError("código de actividad repetido en el frente", `
    insert into activities (id, project_id, front_id, code, name, unit, contract_qty)
    values (gen_random_uuid(), '${projectId}', '77777777-7777-4777-8777-777777777777', 'BC-HIN', 'Otra', 'm', 1)`, /duplicate key/);
});

console.log("\nAlertas programadas");
{
  // Mediodía de Colombia de hoy (17:00 UTC), para no depender de la hora a la que corra la prueba
  const noon = "(current_date + time '17:00') at time zone 'UTC'";
  const r1 = await one(`select generate_finding_due_alerts(${noon}) as n`);
  const kinds = (await db.query("select kind, severity from alerts where kind in ('overdue','due_soon') order by kind")).rows;
  r1.n === 2 && kinds[0]?.kind === "due_soon" && kinds[1]?.kind === "overdue" && kinds[1]?.severity === "critical"
    ? ok(`vencido (crítico) y por vencer generados: ${JSON.stringify(kinds)}`)
    : fail(`alertas de vencimiento: ${r1.n} ${JSON.stringify(kinds)}`);
  const r2 = await one(`select generate_finding_due_alerts(${noon}) as n`);
  r2.n === 0 ? ok("idempotente: no repite alertas el mismo día") : fail(`repitió ${r2.n}`);

  const sunday = (await one("select extract(isodow from current_date)::int as d")).d === 7;
  const nr = await one(`select generate_no_report_alerts(${noon}) as n`);
  const fronts = (await db.query("select f.code from alerts a join fronts f on f.id = a.ref_id where a.kind = 'no_report' order by 1")).rows.map((r) => r.code);
  if (sunday) nr.n === 0 ? ok("domingo: sin alertas de reporte") : fail("alertó en domingo");
  else
    !fronts.includes("BB") && fronts.includes("BA")
      ? ok(`frentes sin reporte hoy: ${fronts.join(", ")} (BB ya reportó)`)
      : fail(`no_report: ${fronts.join(",")}`);

  const contacts = (await db.query(`select * from alert_member_contacts('${projectId}') order by role`)).rows;
  contacts.length === 3 && contacts.every((c) => c.email && Array.isArray(c.push_tokens))
    ? ok(`contactos para despacho: ${contacts.map((c) => `${c.role}:${c.email}`).join(", ")}`)
    : fail(`contactos: ${JSON.stringify(contacts)}`);
}
await as(FIELD, async () => {
  const c = await one("select create_telegram_link_code() as code");
  /^[0-9A-F]{10}$/.test(c.code) ? ok("código de un solo uso para vincular Telegram") : fail(`código ${c.code}`);
  await db.exec(`select alert_member_contacts('${projectId}')`).then(
    () => fail("un usuario normal pudo leer los contactos"),
    () => ok("los contactos solo los lee la función de despacho"),
  );
});

console.log("\nFormatos versionados y biblioteca");
{
  const org = (await one(`select org_id from projects where id = '${projectId}'`)).org_id;
  const schema = (v) => JSON.stringify({ schemaVersion: 1, name: "Hincado", category: "avance", workType: "solar", fields: [{ id: "profundidad", label: `Profundidad ${v}`, type: "number" }] });
  await as(FIELD, async () => {
    await db.exec(`insert into form_templates (id, org_id, name, category) values (gen_random_uuid(), '${org}', 'Intento', 'avance')`).then(
      () => fail("el supervisor pudo crear un formato"),
      (e) => (/row-level security/.test(e.message) ? ok("el supervisor no crea formatos (RLS)") : fail(e.message)),
    );
    await db.exec(`update resource_catalog set cost_per_hour = 1 where org_id = '${org}'`);
    const c = await one(`select count(*)::int n from resource_catalog where cost_per_hour = 1`);
    c.n === 0 ? ok("el supervisor no modifica costos de la biblioteca") : fail("supervisor cambió costos");
  });
  await as(ADMIN, async () => {
    await run("el administrador crea un formato", `insert into form_templates (id, org_id, name, category, work_type, current_version)
      values ('66666666-6666-4666-8666-666666666666', '${org}', 'Hincado', 'avance', 'solar', 0)`);
    const v1 = await one(`select * from publish_form_version('66666666-6666-4666-8666-666666666666', '${schema(1)}'::jsonb, 'inicial')`);
    const same = await one(`select * from publish_form_version('66666666-6666-4666-8666-666666666666', '${schema(1)}'::jsonb)`);
    const v2 = await one(`select * from publish_form_version('66666666-6666-4666-8666-666666666666', '${schema(2)}'::jsonb, 'cambia etiqueta')`);
    v1.version === 1 && v1.created && same.version === 1 && !same.created && v2.version === 2
      ? ok("publicar: v1, idéntico no crea versión, cambio crea v2")
      : fail(`versiones ${JSON.stringify([v1, same, v2])}`);
    const cur = await one(`select current_version from form_templates where id = '66666666-6666-4666-8666-666666666666'`);
    cur.current_version === 2 ? ok("current_version = 2") : fail(`current ${cur.current_version}`);
    await db.exec(`update form_template_versions set schema = '{}'::jsonb where template_id = '66666666-6666-4666-8666-666666666666'`);
    const intact = await one(`select count(*)::int n from form_template_versions where template_id = '66666666-6666-4666-8666-666666666666' and schema ? 'fields'`);
    intact.n === 2 ? ok("las versiones publicadas son inmutables") : fail("se modificó una versión");
    const act = (await one(`select id from activities where code = 'BA-HIN'`)).id;
    const res = (await one(`select id from resource_catalog where name like 'Hincadora%'`)).id;
    await run("asignar formato y recurso a la actividad", `
      update activities set template_id = '66666666-6666-4666-8666-666666666666' where id = '${act}';
      insert into activity_resources (project_id, activity_id, resource_id, units, use_real_rate) values ('${projectId}', '${act}', '${res}', 2, true);`);
  });
  const daily = (await db.query(`select quantity, crew_size from activity_daily_output o join activities a on a.id = o.activity_id where a.code = 'BA-HIN' order by work_date desc limit 1`)).rows;
  daily.length === 1 && daily[0].quantity > 0 ? ok(`rendimiento real diario disponible (último día: ${daily[0].quantity} pilotes)`) : fail("activity_daily_output vacío");
}

console.log("\nSimulaciones");
await as(FIELD, async () => {
  await db.exec(`insert into simulations (project_id, name, assumptions, results) values ('${projectId}', 'x', '{}', '{}')`).then(
    () => fail("el supervisor pudo guardar una simulación"),
    (e) => (/row-level security/.test(e.message) ? ok("el supervisor no guarda simulaciones (solo residente, director y admin)") : fail(e.message)),
  );
});
await as(ADMIN, async () => {
  await run("el administrador guarda una simulación con id y autor automáticos", `
    insert into simulations (project_id, name, assumptions, results, chosen_scenario, rationale, best_scenario, total_base, total_chosen, created_by)
    values ('${projectId}', 'Acelerar Bloque B', '{"availableDays": 26}', '{"best": "optimal"}', 'optimal', 'Ahorro neto', 'optimal', 800, 650, '${ADMIN}')`);
  const s = await one("select id is not null as tiene_id, created_by, created_by_name from simulations where name = 'Acelerar Bloque B'");
  s.tiene_id && s.created_by === ADMIN ? ok(`autor: ${s.created_by_name}`) : fail(JSON.stringify(s));
  await db.exec("update simulations set rationale = 'otra' where name = 'Acelerar Bloque B'");
  const kept = await one("select rationale from simulations where name = 'Acelerar Bloque B'");
  kept.rationale === "Ahorro neto" ? ok("una simulación guardada no se modifica (RLS: 0 filas)") : fail("se modificó la simulación");
});
{
  // El trigger también bloquea a quien no tiene RLS (p. ej. el dueño de la base)
  await expectError("ni siquiera el dueño de la base la borra", "delete from simulations where name = 'Acelerar Bloque B'", /no se modifican/);
}

console.log("\nEnlaces de solo lectura");
// En Supabase el rol anónimo puede usar el esquema public (la web sin sesión llama a la función)
await db.exec("grant usage on schema public to anon; grant execute on function shared_dashboard(text) to anon;");
async function asAnon(fn) {
  await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);");
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.role', '', false);");
  }
}
await as(FIELD, async () => {
  await db.exec(`insert into share_links (project_id, label, expires_at) values ('${projectId}', 'x', now() + interval '7 days')`).then(
    () => fail("el supervisor pudo crear un enlace"),
    (e) => (/row-level security/.test(e.message) ? ok("el supervisor no crea enlaces (solo admin y director)") : fail(e.message)),
  );
});
let token, tokenNoFindings;
await as(ADMIN, async () => {
  await run("el administrador crea un enlace de 30 días", `insert into share_links (project_id, label, expires_at, created_by)
    values ('${projectId}', 'Interventoría', now() + interval '30 days', '${OTHER}')`);
  const l = await one("select token, created_by, view_count from share_links where label = 'Interventoría'");
  token = l.token;
  /^[0-9a-f]{64}$/.test(token) && l.created_by === ADMIN ? ok("token de 64 caracteres hex y autor fijado por el servidor") : fail(JSON.stringify(l));
  await expectError("no se crean enlaces de más de un año", `insert into share_links (project_id, label, expires_at) values ('${projectId}', 'Largo', now() + interval '2 years')`, /check constraint/);
  await run("enlace sin hallazgos", `insert into share_links (project_id, label, expires_at, include_findings) values ('${projectId}', 'Cliente', now() + interval '7 days', false)`);
  tokenNoFindings = (await one("select token from share_links where label = 'Cliente'")).token;
  await expectError("el enlace no se alarga ni se cambia", "update share_links set expires_at = expires_at + interval '1 day' where label = 'Interventoría'", /no se modifica/);
});
const expected = await one(`select (select count(*) from activities where project_id = '${projectId}')::int acts,
  (select count(*) from findings where project_id = '${projectId}')::int findings`);
await asAnon(async () => {
  const d = (await one("select shared_dashboard($1) d", [token])).d;
  const keys = Object.keys(d.entries[0] ?? {});
  d.activities.length === expected.acts && d.entries.length > 0 && d.findings.length === expected.findings
    ? ok(`sin sesión ve el dashboard: ${d.activities.length} actividades, ${d.entries.length} registros, ${d.findings.length} hallazgos, ${d.elements.length} elementos`)
    : fail(`dashboard compartido incompleto: ${JSON.stringify({ a: d.activities.length, e: d.entries.length, f: d.findings.length })}`);
  !keys.includes("notes") && !keys.includes("created_by") && !("resources" in d) ? ok("no expone notas, autores ni costos") : fail(`campos expuestos: ${keys.join(",")}`);
  const d2 = (await one("select shared_dashboard($1) d", [tokenNoFindings])).d;
  d2.findings.length === 0 ? ok("el enlace sin hallazgos no los muestra") : fail("mostró hallazgos");
  await expectError("token inventado", `select shared_dashboard('${"0".repeat(64)}')`, /no válido/);
  await expectError("sin sesión no se leen tablas", "select count(*) from share_links", /permission denied/);
});
await as(ADMIN, async () => {
  const v = await one("select view_count from share_links where label = 'Interventoría'");
  v.view_count === 1 ? ok("cuenta las visitas") : fail(`visitas: ${v.view_count}`);
  await run("el administrador revoca el enlace", "update share_links set revoked_at = now() where label = 'Interventoría'");
});
await asAnon(async () => {
  await expectError("un enlace revocado deja de funcionar", `select shared_dashboard('${token}')`, /revocado/);
});

console.log("\nInforme diario automático");
{
  const d = (await one("select dashboard_json($1) d", [projectId])).d;
  d.activities.length > 0 && d.entries.length > 0 && "notes" in d.entries[0]
    ? ok(`el servicio (sin JWT, como pg_cron) obtiene los datos con notas: ${d.entries.length} registros`)
    : fail("dashboard_json sin datos");
}
await asAnon(async () => {
  await expectError("sin sesión no se piden datos de cualquier obra", `select dashboard_json('${projectId}')`, /No autorizado|permission denied/);
  await expectError("ni la consulta interna", `select private.dashboard_data('${projectId}', true, true)`, /permission denied/);
});
await as(ADMIN, async () => {
  await expectError("ni un administrador la llama desde la web", `select dashboard_json('${projectId}')`, /No autorizado/);
});
await run("el servicio registra un envío", `insert into daily_report_deliveries (project_id, report_date, user_id, channel, status) values ('${projectId}', '2026-10-21', '${RES}', 'telegram', 'sent')`);
await as(FIELD, async () => {
  const r = await one("select count(*)::int n from daily_report_deliveries");
  r.n === 0 ? ok("el supervisor no ve los envíos del informe") : fail("supervisor ve envíos");
  await expectError("ni los registra", `insert into daily_report_deliveries (project_id, report_date, user_id, channel, status) values ('${projectId}', '2026-10-22', '${FIELD}', 'telegram', 'sent')`, /row-level security/);
});
await as(ADMIN, async () => {
  const r = await one("select count(*)::int n from daily_report_deliveries");
  r.n === 1 ? ok("el administrador revisa los envíos") : fail(`admin ve ${r.n}`);
});

console.log("\nFormato de informe del cliente (ponderación, calendario, cabecera)");
await as(FIELD, async () => {
  await db.exec(`update activities set weight = 0.5 where project_id = '${projectId}'`);
  const r = await one(`select count(*)::int n from activities where project_id = '${projectId}' and weight is not null`);
  r.n === 0 ? ok("el supervisor no cambia la ponderación (RLS: 0 filas)") : fail("el supervisor cambió pesos");
});
await as(ADMIN, async () => {
  await run("el administrador pondera las actividades y ajusta calendario y cabecera", `
    update activities set weight = 0.1 where project_id = '${projectId}';
    update projects set colombian_holidays = false, client_name = 'HELIOS', contract_code = 'CNX-PSS-CIV-001',
      report_code = 'CNX-PSS-001', report_signers = '{"Residente civil","Director HSE","Director de obra","Interventoría"}'
    where id = '${projectId}';`);
  await expectError("un peso mayor que 1 se rechaza", `update activities set weight = 1.5 where project_id = '${projectId}'`, /check constraint/);
});
{
  const d = (await one("select dashboard_json($1) d", [projectId])).d;
  d.activities.every((a) => a.weight === 0.1) && d.project.colombian_holidays === false
    ? ok("los datos del dashboard traen pesos y calendario")
    : fail(`pesos/calendario: ${JSON.stringify([d.activities[0]?.weight, d.project.colombian_holidays])}`);
}

console.log("\nParte diario, ensayos y restricciones");
await as(FIELD, async () => {
  await run("el supervisor envía su parte diario (personal, equipos y lluvia)", `
    insert into daily_logs (id, project_id, log_date, personnel, equipment, rain, observations, created_by, client_created_at)
    values ('77777777-7777-4777-8777-000000000001', '${projectId}', '2026-10-20',
      '[{"role":"Oficial de obra","qty":4},{"role":"Auxiliar de obra","qty":6}]', '[{"name":"Retroexcavadora","qty":1}]',
      '[{"start":"10:15","end":"11:00"}]', 'Lluvia a media mañana', '${OTHER}', '2026-10-20T15:00:00Z')`);
  const a = await one("select created_by from daily_logs where id = '77777777-7777-4777-8777-000000000001'");
  a.created_by === FIELD ? ok("el autor lo fija el servidor") : fail(`autor ${a.created_by}`);
  await run("y lo corrige con un envío nuevo", `
    insert into daily_logs (id, project_id, log_date, personnel, client_created_at)
    values ('77777777-7777-4777-8777-000000000002', '${projectId}', '2026-10-20', '[{"role":"Oficial de obra","qty":5}]', '2026-10-20T22:00:00Z')`);
  const latest = (await db.query(`select personnel from daily_log_latest where project_id = '${projectId}' and log_date = '2026-10-20'`)).rows;
  latest.length === 1 && latest[0].personnel[0].qty === 5 ? ok("para el informe vale el último envío") : fail(JSON.stringify(latest));
  await expectError("lluvia con fin antes del inicio", `insert into daily_logs (id, project_id, log_date, rain) values (gen_random_uuid(), '${projectId}', '2026-10-20', '[{"start":"11:00","end":"10:00"}]')`, /lluvia/);
  await expectError("cantidad no entera", `insert into daily_logs (id, project_id, log_date, personnel) values (gen_random_uuid(), '${projectId}', '2026-10-20', '[{"role":"Soldador","qty":-1}]')`, /cantidad entera/);
  await expectError("parte de una fecha futura", `insert into daily_logs (id, project_id, log_date) values (gen_random_uuid(), '${projectId}', '2099-01-01')`, /futura/);
  await db.exec("update daily_logs set observations = 'x' where id = '77777777-7777-4777-8777-000000000001'");
  const u = await one("select observations from daily_logs where id = '77777777-7777-4777-8777-000000000001'");
  u.observations === "Lluvia a media mañana" ? ok("un parte enviado no se edita (RLS: 0 filas)") : fail("se editó el parte");
  await db.exec(`insert into lab_tests (project_id, name) values ('${projectId}', 'x')`).then(
    () => fail("el supervisor creó un ensayo"),
    (e) => (/row-level security/.test(e.message) ? ok("el supervisor no registra ensayos (residente, director, admin)") : fail(e.message)),
  );
});
await as(OTHER, async () => {
  const r = await one(`select count(*)::int n from daily_logs where project_id = '${projectId}'`);
  r.n === 0 ? ok("otra empresa no ve los partes") : fail("usuario ajeno ve partes");
});
await as(RES, async () => {
  await run("el residente registra un ensayo y una restricción", `
    insert into lab_tests (project_id, name, standard, sample_date, sent_date, lab, status)
    values ('${projectId}', 'Compactación (densidad en campo)', 'INV E-161', '2026-10-19', '2026-10-20', 'Lab. Costa', 'enviado');
    insert into project_constraints (project_id, description, responsible, need_by)
    values ('${projectId}', 'Falta permiso de servidumbre para la vía de acceso', 'Helios', '2026-10-24');`);
  await run("y libera la restricción", "update project_constraints set status = 'liberada' where description like 'Falta permiso%'");
  const c = await one("select released_at is not null as liberada, created_by from project_constraints where description like 'Falta permiso%'");
  c.liberada && c.created_by === RES ? ok("fecha de liberación y autor automáticos") : fail(JSON.stringify(c));
});

console.log("\nEquipo del proyecto");
await as(FIELD, async () => {
  await expectError("el supervisor no ve los datos del equipo", `select * from project_team('${projectId}')`, /Solo el administrador/);
});
await as(ADMIN, async () => {
  await expectError("nadie busca cuentas por correo desde la web (solo la función)", "select auth_user_id_by_email('campo@demo.co')", /No autorizado/);
});
{
  const r = await one("select auth_user_id_by_email(' CAMPO@demo.co ') id");
  r.id === FIELD ? ok("la función de servicio encuentra la cuenta por correo") : fail(`id ${r.id}`);
}
await as(ADMIN, async () => {
  const team = (await db.query(`select name, email, role, telegram_linked from project_team('${projectId}')`)).rows;
  team.length >= 3 && team.some((m) => m.email === "campo@demo.co" && m.role === "field")
    ? ok(`el administrador ve el equipo con correo y rol (${team.length} personas)`)
    : fail(JSON.stringify(team));
  await expectError("el único administrador no se quita su rol", `update memberships set role = 'director' where user_id = '${ADMIN}' and project_id = '${projectId}'`, /al menos un administrador/);
  await expectError("ni se retira del proyecto", `delete from memberships where user_id = '${ADMIN}' and project_id = '${projectId}'`, /al menos un administrador/);
  await run("cambia el rol de otra persona", `update memberships set role = 'director' where user_id = '${RES}' and project_id = '${projectId}'`);
  await run("y lo devuelve", `update memberships set role = 'resident' where user_id = '${RES}' and project_id = '${projectId}'`);
});
console.log("\nEmpresas del equipo (contratista y subcontratistas)");
await as(FIELD, async () => {
  await expectError("el supervisor no crea empresas", `insert into project_companies (project_id, name, kind) values ('${projectId}', 'Hincas SAS', 'subcontratista')`, /row-level security/);
});
await as(ADMIN, async () => {
  await run("el administrador registra contratista y subcontratista", `
    insert into project_companies (project_id, name, kind) values ('${projectId}', 'Constructora Demo', 'contratista'), ('${projectId}', 'Hincas SAS', 'subcontratista')`);
  await expectError("no repite una empresa", `insert into project_companies (project_id, name, kind) values ('${projectId}', ' hincas sas ', 'subcontratista')`, /duplicate key/);
  await expectError("el tipo es contratista o subcontratista", `insert into project_companies (project_id, name, kind) values ('${projectId}', 'Otra', 'proveedor')`, /check constraint/);
  await run("asigna a la persona a su empresa y le corrige el nombre", `
    update memberships set company_id = (select id from project_companies where name = 'Hincas SAS'), member_name = '  Marta Rincón '
    where user_id = '${FIELD}' and project_id = '${projectId}'`);
  await expectError("el nombre no queda vacío", `update memberships set member_name = ' x ' where user_id = '${FIELD}' and project_id = '${projectId}'`, /al menos 2 letras/);
  const m = (await db.query(`select name, company_name, company_kind from project_team('${projectId}') where email = 'campo@demo.co'`)).rows[0];
  m?.name === "Marta Rincón" && m.company_name === "Hincas SAS" && m.company_kind === "subcontratista"
    ? ok("el equipo trae el nombre corregido y la empresa")
    : fail(JSON.stringify(m));
  await run("borrar la empresa deja a la persona sin empresa", "delete from project_companies where name = 'Hincas SAS'");
  const after = await one(`select company_id from memberships where user_id = '${FIELD}' and project_id = '${projectId}'`);
  after.company_id === null ? ok("sigue en el proyecto, sin empresa") : fail(JSON.stringify(after));
});
await expectError("una empresa de otro proyecto no se asigna", `
  insert into projects (id, org_id, code, name) select '00000000-0000-4000-8000-00000000b0b0', org_id, 'OTRO', 'Otro proyecto' from projects where id = '${projectId}';
  insert into project_companies (id, project_id, name, kind) values ('00000000-0000-4000-8000-00000000c0c0', '00000000-0000-4000-8000-00000000b0b0', 'Ajena', 'contratista');
  update memberships set company_id = '00000000-0000-4000-8000-00000000c0c0' where user_id = '${FIELD}' and project_id = '${projectId}'`, /no pertenece a este proyecto/);

await as(ADMIN, async () => {
  await run("la actividad queda a cargo de una empresa", `
    insert into project_companies (project_id, name, kind) values ('${projectId}', 'Montajes del Norte', 'subcontratista');
    update activities set company_id = (select id from project_companies where name = 'Montajes del Norte')
    where id = (select id from activities where project_id = '${projectId}' order by code limit 1)`);
  await expectError("una actividad no toma la empresa de otro proyecto", `
    update activities set company_id = '00000000-0000-4000-8000-00000000c0c0' where project_id = '${projectId}'`, /no pertenece a este proyecto/);
  await run("borrar la empresa deja la actividad sin empresa", "delete from project_companies where name = 'Montajes del Norte'");
});
{
  const n = await one(`select count(*)::int n from activities where project_id = '${projectId}' and company_id is not null`);
  n.n === 0 ? ok("las actividades quedan sin empresa, no se borran") : fail(`${n.n} con empresa`);
}

console.log("\nPlanos por empresa");
await as(ADMIN, async () => {
  await run("empresas y planos: general, del contratista y de dos subcontratistas", `
    insert into project_companies (project_id, name, kind) values
      ('${projectId}', 'Contratista Principal', 'contratista'), ('${projectId}', 'Hincas Uno', 'subcontratista'), ('${projectId}', 'Montajes Dos', 'subcontratista');
    update memberships set company_id = (select id from project_companies where name = 'Hincas Uno') where user_id = '${FIELD}' and project_id = '${projectId}';
    update memberships set company_id = (select id from project_companies where name = 'Montajes Dos') where user_id = '${RES}' and project_id = '${projectId}';
    insert into site_plans (project_id, name, storage_path, source_format, company_id) values
      ('${projectId}', 'P-General', '${projectId}/general.jpg', 'pdf', null),
      ('${projectId}', 'P-Hincas', '${projectId}/hincas.jpg', 'pdf', (select id from project_companies where name = 'Hincas Uno')),
      ('${projectId}', 'P-Montajes', '${projectId}/montajes.jpg', 'pdf', (select id from project_companies where name = 'Montajes Dos'));
    insert into storage.objects (bucket_id, name) values ('plans', '${projectId}/hincas.jpg'), ('plans', '${projectId}/montajes.jpg')`);
});
const seen = async (user) =>
  as(user, async () => (await db.query("select name from site_plans where name like 'P-%' order by name")).rows.map((r) => r.name).join(","));
{
  const f = await seen(FIELD);
  f === "P-General,P-Hincas" ? ok("el subcontratista ve el general y los suyos, no los de otra empresa") : fail(`campo ve ${f}`);
  const a = await seen(ADMIN);
  a === "P-General,P-Hincas,P-Montajes" ? ok("el administrador ve todos") : fail(`admin ve ${a}`);
  const files = await as(FIELD, async () => (await db.query("select name from storage.objects where bucket_id = 'plans' and name like '%.jpg' order by name")).rows.map((r) => r.name));
  files.length === 1 && files[0].endsWith("hincas.jpg") ? ok("tampoco puede descargar el archivo de otra empresa") : fail(JSON.stringify(files));
  const acc = await one(`select string_agg(sp.name, ',' order by sp.name) n from plan_access pa join site_plans sp on sp.id = pa.plan_id where pa.user_id = '${FIELD}' and sp.name like 'P-%'`);
  acc.n === "P-General,P-Hincas" ? ok("la tabla de acceso del teléfono coincide") : fail(`acceso ${acc.n}`);
}
await as(ADMIN, async () => {
  await run("el residente pasa al contratista principal", `update memberships set company_id = (select id from project_companies where name = 'Contratista Principal') where user_id = '${RES}' and project_id = '${projectId}'`);
});
{
  const r = await seen(RES);
  r === "P-General,P-Hincas,P-Montajes" ? ok("el personal del contratista ve los planos de sus subcontratistas") : fail(`residente ve ${r}`);
  const acc = await one(`select count(*)::int n from plan_access pa join site_plans sp on sp.id = pa.plan_id where pa.user_id = '${RES}' and sp.name like 'P-%'`);
  acc.n === 3 ? ok("y su acceso en el teléfono se recalcula solo") : fail(`acceso ${acc.n}`);
}
await as(FIELD, async () => {
  await expectError("el supervisor no sube planos", `insert into site_plans (project_id, name, storage_path, source_format, company_id) values ('${projectId}', 'X', 'x.jpg', 'pdf', my_company('${projectId}'))`, /row-level security/);
});
await as(ADMIN, async () => {
  await run("el residente de una subcontratista", `update memberships set company_id = (select id from project_companies where name = 'Montajes Dos') where user_id = '${RES}' and project_id = '${projectId}'`);
});
await as(RES, async () => {
  await run("sube un plano de su empresa", `insert into site_plans (project_id, name, storage_path, source_format, company_id) values ('${projectId}', 'P-Montajes-2', 'm2.jpg', 'pdf', my_company('${projectId}'))`);
  await expectError("pero no uno de otra empresa", `insert into site_plans (project_id, name, storage_path, source_format, company_id) values ('${projectId}', 'X', 'x.jpg', 'pdf', (select id from project_companies where name = 'Hincas Uno'))`, /row-level security/);
  await expectError("ni uno general", `insert into site_plans (project_id, name, storage_path, source_format) values ('${projectId}', 'X', 'x.jpg', 'pdf')`, /row-level security/);
});

console.log("\nCorrecciones de registros aprobados");
{
  const ap = await one(`select id, quantity::float8 q, version from progress_entries where status = 'approved' order by work_date desc limit 1`);
  const sub = await one(`select id from progress_entries where status = 'submitted' limit 1`);
  await as(FIELD, async () => {
    await expectError("el motivo es obligatorio", `select request_correction('${ap.id}', 'error', '{"quantity": 1}')`, /motivo/);
  });
  await as(RES, async () => {
    await expectError("un registro enviado no pasa por corrección", `select request_correction('${sub.id}', 'Se digitó mal la cantidad del día', '{"quantity": 1}')`, /aprobados/);
    await expectError("no se cambian campos fuera de la lista", `select request_correction('${ap.id}', 'Se digitó mal la cantidad del día', '{"status": "draft"}')`, /no se puede corregir/);
    await run("el residente pide corregir la cantidad", `select request_correction('${ap.id}', 'Se digitó 10 en vez de 1 en la cantidad', '{"quantity": ${ap.q + 7}}')`);
    await expectError("una sola corrección pendiente por registro", `select request_correction('${ap.id}', 'Otra vez la cantidad del día', '{"quantity": 2}')`, /pendiente/);
    await expectError("quien la pide no la aprueba", `select decide_correction((select id from entry_corrections where entry_id = '${ap.id}' and status = 'pendiente'), true)`, /otra persona/);
    await expectError("el registro aprobado sigue sin editarse directo", `update progress_entries set quantity = 1 where id = '${ap.id}'`, /pide una corrección/);
  });
  await as(FIELD, async () => {
    await expectError("el supervisor no decide correcciones", `select decide_correction((select id from entry_corrections where entry_id = '${ap.id}' and status = 'pendiente'), true)`, /residente, el director o el administrador/);
  });
  await as(ADMIN, async () => {
    const v = await one(`select decide_correction((select id from entry_corrections where entry_id = '${ap.id}' and status = 'pendiente'), true, 'Verificado con el plano') v`);
    v.v === ap.version + 1 ? ok(`al aprobarla el registro pasa a la versión ${v.v}`) : fail(JSON.stringify(v));
  });
  {
    const e = await one(`select quantity::float8 q, status from progress_entries where id = '${ap.id}'`);
    const c = await one(`select (previous ->> 'quantity')::float8 antes, (proposed ->> 'quantity')::float8 despues, status, result_version from entry_corrections where entry_id = '${ap.id}'`);
    e.q === ap.q + 7 && e.status === "approved" && c.antes === ap.q && c.despues === ap.q + 7 && c.status === "aprobada"
      ? ok("queda la versión anterior y la nueva; el registro sigue aprobado con la cantidad corregida")
      : fail(JSON.stringify({ e, c }));
  }
  await as(RES, async () => {
    await run("otra corrección", `select request_correction('${ap.id}', 'La fecha quedó corrida un día', '{"work_date": "2026-10-01"}')`);
  });
  await as(ADMIN, async () => {
    await expectError("rechazar exige explicar por qué", `select decide_correction((select id from entry_corrections where entry_id = '${ap.id}' and status = 'pendiente'), false)`, /por qué/);
    await run("se rechaza con su razón", `select decide_correction((select id from entry_corrections where entry_id = '${ap.id}' and status = 'pendiente'), false, 'La fecha está bien según el parte')`);
  });
  const e2 = await one(`select quantity::float8 q, work_date::text d from progress_entries where id = '${ap.id}'`);
  e2.q === ap.q + 7 && e2.d !== "2026-10-01" ? ok("una corrección rechazada no cambia el registro") : fail(JSON.stringify(e2));
  const au = await one("select count(*)::int n from audit_log where table_name = 'entry_corrections'");
  au.n >= 4 ? ok(`las correcciones quedan en la auditoría (${au.n})`) : fail(`auditoría ${au.n}`);
}

console.log("\nSubcampo y circuito de las actividades");
await as(ADMIN, async () => {
  await run("el administrador asigna subcampo y circuito", `update activities set subfield = 'SC-01', circuit = 'C-03' where project_id = '${projectId}' and code = 'BB-HIN'`);
});
await as(FIELD, async () => {
  await db.exec(`update activities set subfield = 'X' where project_id = '${projectId}' and code = 'BB-HIN'`);
});
{
  const z = await one(`select subfield, circuit from activities where project_id = '${projectId}' and code = 'BB-HIN'`);
  z.subfield === "SC-01" && z.circuit === "C-03" ? ok("el supervisor no los cambia (RLS)") : fail(JSON.stringify(z));
}

console.log("\nCalidad: inspecciones, no conformidades y punch list");
await as(FIELD, async () => {
  await expectError("el supervisor no crea listas de chequeo", `insert into checklists (project_id, name, items) values ('${projectId}', 'Zanja', '[{"id":"1","text":"Profundidad"}]')`, /row-level security/);
});
await as(RES, async () => {
  await run("el residente crea la lista y el punto del plan de inspección", `
    insert into checklists (id, project_id, name, activity_id, items) values ('00000000-0000-4000-8000-0000000c4ec1', '${projectId}', 'Hincado de pilotes',
      (select id from activities where project_id = '${projectId}' and code = 'BB-HIN'),
      '[{"id":"1","text":"Verticalidad dentro de 1 %"},{"id":"2","text":"Cota de cabeza según plano"},{"id":"3","text":"Sin daño en el galvanizado"}]');
    insert into inspection_points (project_id, activity_id, name, criterion, point_type, checklist_id)
    values ('${projectId}', (select id from activities where project_id = '${projectId}' and code = 'BB-HIN'), 'Liberación de hincado', 'Tolerancias del fabricante', 'espera', '00000000-0000-4000-8000-0000000c4ec1')`);
});
await as(FIELD, async () => {
  await expectError("toda la lista debe responderse", `select submit_inspection('{"project_id":"${projectId}","checklist_id":"00000000-0000-4000-8000-0000000c4ec1","answers":[{"id":"1","result":"ok"}]}')`, /Falta responder/);
  await expectError("un no cumple exige describirlo", `select submit_inspection('{"project_id":"${projectId}","checklist_id":"00000000-0000-4000-8000-0000000c4ec1","answers":[{"id":"1","result":"ok"},{"id":"2","result":"no_ok"},{"id":"3","result":"na"}]}')`, /Describe qué no cumple/);
  const r = await one(`select submit_inspection('{"project_id":"${projectId}","checklist_id":"00000000-0000-4000-8000-0000000c4ec1","answers":[{"id":"1","result":"ok"},{"id":"2","result":"no_ok","note":"Cabeza 4 cm abajo","impeditive":true},{"id":"3","result":"na"}]}') r`);
  r.r.non_conformities === 1 ? ok("la inspección con un no cumple abre una no conformidad") : fail(JSON.stringify(r));
});
{
  const nc = await one(`select f.category, f.impeditive, f.severity, f.inspection_id is not null ligada, a.code, i.result
    from findings f join activities a on a.id = f.activity_id join inspections i on i.id = f.inspection_id where f.category = 'no_conformidad' limit 1`);
  nc?.impeditive && nc.code === "BB-HIN" && nc.result === "rechazada" && nc.severity === "high"
    ? ok("la NC queda impeditiva, ligada a la actividad y a la inspección rechazada")
    : fail(JSON.stringify(nc));
}
await as(RES, async () => {
  const id = (await one("select id from findings where category = 'no_conformidad' limit 1")).id;
  await run("la NC pasa a corrección y a revisión", `update findings set status = 'in_correction', corrective_action = 'Rehincar' where id = '${id}'; update findings set status = 'to_review' where id = '${id}'`);
  await expectError("no se cierra sin verificación", `update findings set status = 'closed' where id = '${id}'`, /describe la verificación/);
  await run("se cierra con la verificación", `update findings set status = 'closed', verification_note = 'Cota verificada con topografía' where id = '${id}'`);
  const v = await one(`select verified_by, closed_at is not null cerrado from findings where id = '${id}'`);
  v.verified_by === RES && v.cerrado ? ok("queda quién verificó el cierre") : fail(JSON.stringify(v));
});
await as(FIELD, async () => {
  await run("una observación del teléfono sigue igual (sin categoría ni verificación)", `
    insert into findings (id, project_id, type, severity, description, created_by) values ('00000000-0000-4000-8000-00000000f0f0', '${projectId}', 'safety', 'low', 'Cono caído', '${FIELD}')`);
});
{
  const o = await one("select category, impeditive from findings where id = '00000000-0000-4000-8000-00000000f0f0'");
  o.category === "observacion" && o.impeditive === false ? ok("por defecto es observación, no impeditiva") : fail(JSON.stringify(o));
}

console.log("\nCostos y alertas tempranas");
await run("actividad de prueba: rinde 10 al día y la última semana cae a 4", `
  insert into activities (id, project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish, budget_unit_cost)
  values ('00000000-0000-4000-8000-0000000a1e01', '${projectId}', '${ids.front}', 'ALR-1', 'Zanja de prueba', 'm', 1000, current_date - 30, current_date + 5, 85000);
  insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, crew_size, status, created_by, device_id, client_created_at)
  select gen_random_uuid(), '${projectId}', '${ids.front}', '00000000-0000-4000-8000-0000000a1e01', current_date - d,
         case when d <= 6 then 4 else 10 end, 8, 4, 'approved', '${FIELD}', 'test', now()
  from generate_series(0, 27) d;
  insert into project_constraints (project_id, activity_id, description, responsible, need_by) values
    ('${projectId}', '00000000-0000-4000-8000-0000000a1e01', 'Falta tubería', 'Compras', current_date - 1),
    ('${projectId}', '00000000-0000-4000-8000-0000000a1e01', 'Falta permiso de cruce', 'Cliente', current_date + 3)`);
{
  const n = await one("select generate_production_alerts() n");
  const kinds = (await db.query("select kind, severity::text s, body from alerts where ref_id = '00000000-0000-4000-8000-0000000a1e01' order by kind")).rows;
  const k = kinds.map((x) => x.kind).join(",");
  k === "constraints,late_projection,productivity_drop" ? ok(`alertas tempranas: ${k} (${n.n} nuevas)`) : fail(`alertas ${JSON.stringify(kinds)}`);
  const p = kinds.find((x) => x.kind === "productivity_drop");
  p?.s === "high" && /−60 %/.test(p.body) ? ok(`la caída de productividad se cuantifica: «${p.body}»`) : fail(JSON.stringify(p));
  const again = await one("select generate_production_alerts() n");
  again.n === 0 ? ok("no repite la misma alerta el mismo día") : fail(`repitió ${again.n}`);
}
await as(FIELD, async () => {
  const c = await one(`select count(*)::int n from cost_records`);
  await expectError("el supervisor no registra costos", `insert into cost_records (project_id, kind, description, amount) values ('${projectId}', 'material', 'Cable', 100)`, /row-level security/);
  c.n === 0 ? ok("ni los ve") : fail("ve costos");
});
await as(ADMIN, async () => {
  await run("el administrador registra un costo de material", `insert into cost_records (project_id, activity_id, kind, description, amount) values ('${projectId}', '00000000-0000-4000-8000-0000000a1e01', 'material', 'Arena para cama', 1250000)`);
});

console.log("\nRegistro de importaciones");
await as(RES, async () => {
  await expectError("el residente no registra importaciones", `insert into import_runs (project_id, kind, file_name, source) values ('${projectId}', 'dxf', 'layout.dxf', 'dxf')`, /row-level security/);
});
await as(ADMIN, async () => {
  await run("el administrador registra una importación con sus cambios", `
    insert into import_runs (project_id, kind, file_name, source, summary, changes, updated_existing) values ('${projectId}', 'programacion', 'cronograma.xer', 'primavera',
      '{"creados": 2, "actualizados": 1}', '[{"codigo": "BA-HIN", "cambios": [{"campo": "fin", "antes": "2026-10-24", "despues": "2026-10-28"}]}]', true)`);
  await run("y un elemento del plano", `insert into elements (project_id, kind, code, qty) values ('${projectId}', 'tracker', 'TRK-AUD-1', 1)`);
});
await as(RES, async () => {
  const r = await one("select count(*)::int n from import_runs");
  r.n === 1 ? ok("el residente consulta el registro") : fail(`ve ${r.n}`);
  await db.exec(`update import_runs set file_name = 'otro' where project_id = '${projectId}'`);
});
{
  const f = await one("select file_name from import_runs limit 1");
  f.file_name === "cronograma.xer" ? ok("el registro no se puede editar") : fail(f.file_name);
  const a = await one("select count(*)::int n from audit_log where table_name = 'elements'");
  a.n >= 1 ? ok("los elementos del plano quedan en la auditoría") : fail("sin auditoría de elementos");
}

const ma = await one("select count(*)::int n from audit_log where table_name = 'memberships'");
ma.n >= 2 ? ok(`los cambios de rol quedan en la auditoría (${ma.n})`) : fail("auditoría de membresías");

const audit = await one("select count(*)::int n from audit_log where table_name='progress_entries' and action='UPDATE'");
audit.n >= 1 ? ok(`auditoría registró ${audit.n} actualización(es)`) : fail("auditoría");
const pub = (await db.query("select tablename from pg_publication_tables where pubname='powersync'")).rows.length;
pub > 15 ? ok(`publicación powersync con ${pub} tablas`) : fail("publicación");

console.log(failures ? `\n${failures} FALLA(S)` : "\nTodo OK");
process.exit(failures ? 1 : 0);
