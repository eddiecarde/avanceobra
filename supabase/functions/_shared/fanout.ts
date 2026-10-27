// Una obra grande (miles de actividades) usa casi todo el cómputo de una llamada: cuando el job
// programado pide "todos los proyectos", la función se llama a sí misma una vez por proyecto.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function fanOut(db: SupabaseClient, req: Request, fn: string, body: Record<string, unknown>): Promise<Response> {
  // La URL pública de la función (req.url dentro del entorno de Supabase es interna)
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`;
  const { data: projects, error } = await db.from("projects").select("id, name").eq("suspended", false);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const results: unknown[] = [];
  for (const p of projects ?? []) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": req.headers.get("x-dispatch-secret") ?? "" },
      body: JSON.stringify({ ...body, project_id: p.id }),
    });
    results.push(r.ok ? await r.json() : { project: p.name, error: `${r.status} ${(await r.text()).slice(0, 200)}` });
  }
  return Response.json({ fan_out: true, results });
}
