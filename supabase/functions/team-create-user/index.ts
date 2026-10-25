// Edge Function: el administrador de un proyecto crea un usuario del equipo con contraseña temporal
// (o agrega al proyecto a alguien que ya tiene cuenta). Se llama desde la página Equipo de la web
// con la sesión del administrador; aquí se verifica que de verdad lo sea.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, validateNewMember } from "../_shared/team.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Usa POST" });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Inicia sesión de nuevo." });

  const parsed = validateNewMember(await req.json().catch(() => null));
  if (!parsed.ok) return reply(400, { error: parsed.errors.join(" ") });
  const m = parsed.value;

  const { data: own } = await db.from("memberships").select("role").eq("user_id", caller.user.id).eq("project_id", m.project_id).maybeSingle();
  if (own?.role !== "admin") return reply(403, { error: "Solo el administrador del proyecto agrega personas." });
  const { data: project } = await db.from("projects").select("org_id").eq("id", m.project_id).single();
  if (!project) return reply(404, { error: "Proyecto no encontrado." });

  const { data: existingId, error: e1 } = await db.rpc("auth_user_id_by_email", { p_email: m.email });
  if (e1) return reply(500, { error: e1.message });

  let userId = existingId as string | null;
  let created = false;
  if (userId) {
    const { data: already } = await db.from("memberships").select("role").eq("user_id", userId).eq("project_id", m.project_id).maybeSingle();
    if (already) return reply(409, { error: `${m.email} ya está en el proyecto (rol actual: ${already.role}). Cámbiale el rol en la lista.` });
    const { data: client } = await db.from("project_clients").select("name").eq("user_id", userId).eq("project_id", m.project_id).maybeSingle();
    if (client) return reply(409, { error: `${m.email} ya tiene acceso como cliente.` });
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: m.email,
      password: m.password,
      email_confirm: true,
      user_metadata: { full_name: m.name, must_change_password: true },
    });
    if (error || !data.user) return reply(400, { error: error?.message ?? "No se pudo crear el usuario." });
    userId = data.user.id;
    created = true;
    await db.from("profiles").upsert({ id: userId, full_name: m.name });
  }

  // El cliente no es miembro del proyecto: solo entra a su portal
  if (m.role === "client") {
    const { error } = await db.from("project_clients").insert({ project_id: m.project_id, user_id: userId, name: m.name, company: m.company, created_by: caller.user.id });
    if (error) return reply(500, { error: error.message });
    return reply(200, { status: created ? "created" : "added", user_id: userId });
  }
  const { error: e2 } = await db.from("memberships").insert({ user_id: userId, project_id: m.project_id, org_id: project.org_id, role: m.role, member_name: m.name });
  if (e2) return reply(500, { error: e2.message });
  return reply(200, { status: created ? "created" : "added", user_id: userId });
});
