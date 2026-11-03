"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, cx } from "@/components/ui";
import type { DashData } from "@/lib/dashboard";
import { supabase } from "@/lib/supabase";

interface Check {
  label: string;
  done: boolean;
  detail: string;
  href: string;
  action: string;
}

const hideKey = (projectId: string) => `avanceobra:checklist-oculta:${projectId}`;

/** Lo que falta configurar para que el piloto dé datos útiles (solo para el administrador; desaparece cuando todo está listo). */
export function PilotChecklist({ projectId, data }: { projectId: string; data: DashData }) {
  const [extra, setExtra] = useState<{ projectId: string; costs: number; team: { telegram_linked: boolean; company_id: string | null }[] } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(hideKey(projectId)) === "1");
    } catch {
      setHidden(false);
    }
    let off = false;
    void Promise.all([
      supabase.from("activity_resources").select("activity_id, resource:resource_catalog(cost_per_hour, operator_cost_per_hour)").eq("project_id", projectId),
      supabase.rpc("project_team", { p_project: projectId }),
    ]).then(([res, team]) => {
      if (off) return;
      const rows = (res.data ?? []) as unknown as { activity_id: string; resource: { cost_per_hour: number | null; operator_cost_per_hour: number | null } | null }[];
      const withCost = new Set(rows.filter((r) => Number(r.resource?.cost_per_hour ?? 0) + Number(r.resource?.operator_cost_per_hour ?? 0) > 0).map((r) => r.activity_id));
      setExtra({ projectId, costs: withCost.size, team: (team.data ?? []) as { telegram_linked: boolean; company_id: string | null }[] });
    });
    return () => {
      off = true;
    };
  }, [projectId]);

  if (!extra || extra.projectId !== projectId) return null;
  const acts = data.activities;
  const h = data.project.header;
  const scheduled = acts.filter((a) => a.plannedStart && a.plannedFinish).length;
  const assigned = acts.filter((a) => a.companyId).length;
  const linked = extra.team.filter((m) => m.telegram_linked).length;
  const withCompany = extra.team.filter((m) => m.company_id).length;

  const checks: Check[] = [
    {
      label: "Programación con fechas",
      done: acts.length > 0 && scheduled === acts.length,
      detail: acts.length ? `${scheduled} de ${acts.length} actividades con inicio y fin` : "Sin actividades",
      href: "/importar",
      action: "Importar programación",
    },
    {
      label: "Pesos del contrato",
      done: acts.some((a) => a.weight != null),
      detail: acts.some((a) => a.weight != null) ? "Definidos" : "Todas pesan igual",
      href: "/proyecto",
      action: "Definir pesos",
    },
    {
      label: "Cabecera del informe",
      done: !!(h.clientName && h.contractCode),
      detail: h.clientName && h.contractCode ? `${h.clientName} · ${h.contractCode}` : "Falta cliente o contrato",
      href: "/proyecto",
      action: "Completar cabecera",
    },
    {
      label: "Empresa de cada actividad",
      done: acts.length > 0 && assigned === acts.length,
      detail: data.companies.length ? `${assigned} de ${acts.length} actividades con empresa` : "Sin empresas registradas",
      href: data.companies.length ? "/proyecto" : "/equipo",
      action: data.companies.length ? "Asignar empresas" : "Registrar empresas",
    },
    {
      label: "Costos para el simulador",
      done: extra.costs > 0,
      detail: extra.costs ? `${extra.costs} actividad(es) con costo` : "Ninguna actividad tiene costo",
      href: "/biblioteca",
      action: "Cargar costos",
    },
    {
      label: "Equipo con empresa y Telegram",
      done: extra.team.length > 0 && linked === extra.team.length && withCompany === extra.team.length,
      detail: `${linked} de ${extra.team.length} con Telegram · ${withCompany} con empresa`,
      href: "/equipo",
      action: "Revisar equipo",
    },
  ];
  const pending = checks.filter((c) => !c.done);
  if (!pending.length) return null;

  const toggle = (v: boolean) => {
    setHidden(v);
    try {
      localStorage.setItem(hideKey(projectId), v ? "1" : "0");
    } catch {
      // Sin almacenamiento: solo dura esta visita
    }
  };

  if (hidden)
    return (
      <button type="button" onClick={() => toggle(false)} className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
        Puesta a punto del piloto: {checks.length - pending.length} de {checks.length} listas · ver
      </button>
    );

  return (
    <Card className="border-l-8 border-l-amber-500">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">
          Puesta a punto del piloto · {checks.length - pending.length} de {checks.length} listas
        </h2>
        <Button size="sm" variant="ghost" onClick={() => toggle(true)}>
          Ocultar
        </Button>
      </div>
      <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label} className="flex flex-wrap items-baseline gap-x-2 py-0.5">
            <span aria-hidden className={cx("font-bold", c.done ? "text-green-700 dark:text-green-400" : "text-amber-600")}>
              {c.done ? "✓" : "○"}
            </span>
            <span className={cx("font-semibold", c.done && "font-normal text-zinc-500")}>{c.label}</span>
            <span className="text-sm text-zinc-500">{c.detail}</span>
            {c.done ? null : (
              <Link href={c.href} className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                {c.action} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
