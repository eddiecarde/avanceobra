"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DashboardView } from "@/components/dash/DashboardView";
import { PilotChecklist } from "@/components/dash/PilotChecklist";
import { ShareLinks } from "@/components/dash/ShareLinks";
import { Button, Field, Select } from "@/components/ui";
import { loadDashboard, type DashData } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";

/** Dashboard con sesión: elige el proyecto, carga con RLS, muestra lo que falta configurar y permite compartir un enlace de solo lectura. */
export default function Dashboard() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [pickedProject, setProjectId] = useCurrentProject();
  const projectId = pickedProject || projects[0]?.id || "";
  const canShare = memberships.some((m) => m.project_id === projectId && (m.role === "admin" || m.role === "director"));
  const isAdmin = memberships.some((m) => m.project_id === projectId && m.role === "admin");
  const [sharing, setSharing] = useState(false);
  // Resultado de la carga, marcado con su proyecto: al cambiar de proyecto se ve "cargando" sin reiniciar estado
  const [loaded, setLoaded] = useState<{ projectId: string; data?: DashData; error?: string } | null>(null);
  const data = loaded?.projectId === projectId ? (loaded.data ?? null) : null;
  const error = loaded?.projectId === projectId ? (loaded.error ?? null) : null;

  useEffect(() => {
    if (!projectId) return;
    loadDashboard(projectId).then(
      (d) => setLoaded({ projectId, data: d }),
      (e: Error) => setLoaded({ projectId, error: e.message }),
    );
  }, [projectId]);

  if (!projects.length) return <p className="text-zinc-500">No tienes proyectos asignados.</p>;

  return (
    <div className="space-y-5">
      <DashboardView
        data={data}
        error={error}
        top={
          <>
            {canShare && data && sharing ? <ShareLinks projectId={projectId} /> : null}
            {isAdmin && data ? <PilotChecklist projectId={projectId} data={data} /> : null}
          </>
        }
        actions={(cutoff) => (
          <>
            {projects.length > 1 ? (
              <Field label="Proyecto">
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {canShare && data ? (
              <Button onClick={() => setSharing((v) => !v)} aria-expanded={sharing}>
                {sharing ? "Cerrar compartir" : "Compartir"}
              </Button>
            ) : null}
            <Link href={`/informe?p=${projectId}&d=${cutoff}`} className="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800">
              Informe diario (PDF)
            </Link>
          </>
        )}
      />
    </div>
  );
}
