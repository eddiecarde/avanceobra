// Lo que bloquea la obra para los informes automáticos: restricciones abiertas, hallazgos
// impeditivos abiertos y materiales con alerta reciente de agotarse.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Blockers, RawDashboard } from "./report.ts";

export async function loadBlockers(db: SupabaseClient, projectId: string, raw: RawDashboard, since: string): Promise<Blockers> {
  const [c, a] = await Promise.all([
    db.from("project_constraints").select("description, need_by").eq("project_id", projectId).eq("status", "abierta").order("need_by", { ascending: true, nullsFirst: false }),
    db.from("alerts").select("title").eq("project_id", projectId).eq("kind", "material_low").gte("created_at", `${since}T00:00:00-05:00`),
  ]);
  return {
    constraints: ((c.data ?? []) as { description: string; need_by: string | null }[]).map((x) => ({ description: x.description, needBy: x.need_by })),
    impeditive: raw.findings.filter((f) => f.impeditive && f.status !== "closed").map((f) => f.description),
    materials: [...new Set(((a.data ?? []) as { title: string }[]).map((x) => x.title.replace(/^Material por agotarse:\s*/, "")))],
  };
}
