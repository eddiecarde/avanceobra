// Edge Function: el dueño de la plataforma da de alta una empresa con su primer administrador
// (contraseña temporal, o su cuenta de siempre si ya existe) y su primera obra. Desde ahí la empresa
// se maneja sola: su administrador crea obras y agrega a su equipo.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateNewCompany } from "../_shared/platform.ts";
import { CORS } from "../_shared/team.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Usa POST" });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Inicia sesión de nuevo." });
  const { data: owner } = await db.from("platform_admins").select("user_id").eq("user_id", caller.user.id).maybeSingle();
  if (!owner) return reply(403, { error: "Solo el dueño de la plataforma da de alta empresas." });

  const parsed = validateNewCompany(await req.json().catch(() => null));
  if (!parsed.ok) return reply(400, { error: parsed.errors.join(" ") });
  const c = parsed.value;

  const { data: same } = await db.from("organizations").select("id").ilike("name", c.company_name).maybeSingle();
  if (same) return reply(409, { error: `Ya existe una empresa llamada ${c.company_name}.` });

  // Administrador: cuenta nueva con contraseña temporal, o la que ya tiene
  const { data: existingId, error: e1 } = await db.rpc("auth_user_id_by_email", { p_email: c.admin_email });
  if (e1) return reply(500, { error: e1.message });
  let userId = existingId as string | null;
  let created = false;
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({
      email: c.admin_email,
      password: c.password,
      email_confirm: true,
      user_metadata: { full_name: c.admin_name, must_change_password: true },
    });
    if (error || !data.user) return reply(400, { error: error?.message ?? "No se pudo crear el usuario." });
    userId = data.user.id;
    created = true;
    await db.from("profiles").upsert({ id: userId, full_name: c.admin_name });
  }

  const { data: org, error: e2 } = await db.from("organizations").insert({ name: c.company_name, tax_id: c.tax_id }).select("id").single();
  if (e2 || !org) return reply(500, { error: e2?.message ?? "No se pudo crear la empresa." });

  // Si algo falla después de crear la empresa, se deshace (la obra se borra en cascada)
  const undo = async (message: string) => {
    await db.from("projects").delete().eq("org_id", org.id);
    await db.from("organizations").delete().eq("id", org.id);
    if (created) await db.auth.admin.deleteUser(userId!);
    return reply(500, { error: message });
  };
  // Administrador de la empresa: entra solo a esta obra y a las que cree después
  const { error: e4 } = await db.from("org_admins").insert({ org_id: org.id, user_id: userId, created_by: caller.user.id });
  if (e4) return undo(e4.message);
  const { data: project, error: e3 } = await db
    .from("projects")
    .insert({ org_id: org.id, code: c.project_code, name: c.project_name, start_date: c.start, contract_end_date: c.end })
    .select("id")
    .single();
  if (e3 || !project) return undo(e3?.message ?? "No se pudo crear la obra.");

  return reply(200, { status: created ? "created" : "added", org_id: org.id, project_id: project.id, user_id: userId });
});
