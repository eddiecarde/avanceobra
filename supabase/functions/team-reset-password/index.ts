// Edge Function: restablecer la contraseña de una persona con una contraseña temporal (que tendrá que
// cambiar al entrar). Sin correo: el administrador se la envía por WhatsApp u otro medio.
// - El administrador de una obra puede restablecer a la gente de esa obra, siempre que esa persona
//   trabaje solo con empresas que él administra (para no tomar la cuenta de alguien de otra empresa).
// - El dueño de la plataforma puede restablecer a cualquiera (p. ej. al administrador de una empresa).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, validateReset } from "../_shared/team.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Usa POST" });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Inicia sesión de nuevo." });

  const parsed = validateReset(await req.json().catch(() => null));
  if (!parsed.ok) return reply(400, { error: parsed.errors.join(" ") });
  const r = parsed.value;
  if (r.user_id === caller.user.id) return reply(400, { error: "Tu propia contraseña la cambias en Mi cuenta." });

  const { data: owner } = await db.from("platform_admins").select("user_id").eq("user_id", caller.user.id).maybeSingle();
  if (!owner) {
    if (!r.project_id) return reply(403, { error: "Falta la obra." });
    const { data: mine } = await db.from("memberships").select("role, org_id").eq("user_id", caller.user.id).eq("project_id", r.project_id).maybeSingle();
    if (mine?.role !== "admin") return reply(403, { error: "Solo el administrador de la obra restablece contraseñas." });
    const { data: target } = await db.from("memberships").select("user_id").eq("user_id", r.user_id).eq("project_id", r.project_id).maybeSingle();
    if (!target) return reply(404, { error: "Esa persona no está en esta obra." });
    // ¿Trabaja también con otra empresa (o es dueño de la plataforma)? Entonces no
    const { data: adminOrgs } = await db.from("memberships").select("org_id").eq("user_id", caller.user.id).eq("role", "admin");
    const allowed = new Set((adminOrgs ?? []).map((m) => m.org_id as string));
    const [{ data: theirs }, { data: theirClients }, { data: theirOwner }] = await Promise.all([
      db.from("memberships").select("org_id").eq("user_id", r.user_id),
      db.from("project_clients").select("project_id").eq("user_id", r.user_id),
      db.from("platform_admins").select("user_id").eq("user_id", r.user_id).maybeSingle(),
    ]);
    const otherCompany = (theirs ?? []).some((m) => !allowed.has(m.org_id as string)) || (theirClients ?? []).length > 0 || !!theirOwner;
    if (otherCompany)
      return reply(409, { error: "Esta persona también trabaja con otra empresa: que cambie ella misma su contraseña, o pídele al administrador de AvanceObra que la restablezca." });
  }

  const { data: user, error: e1 } = await db.auth.admin.getUserById(r.user_id);
  if (e1 || !user.user) return reply(404, { error: "No se encontró la cuenta." });
  const { error: e2 } = await db.auth.admin.updateUserById(r.user_id, {
    password: r.password,
    user_metadata: { ...(user.user.user_metadata ?? {}), must_change_password: true },
  });
  if (e2) return reply(400, { error: e2.message });
  return reply(200, { status: "reset", email: user.user.email });
});
