"use client";

import { useMemo, useState } from "react";
import { BigButton, chip, InstallHint, QueueStatus } from "./FieldKit";
import type { Go } from "./FieldApp";
import { useCatalog } from "@/lib/field";
import { useCurrentProject, useSession } from "@/lib/session";

/** Inicio de campo: estado de la cola, instalación, parte, hallazgo y elección de la actividad. */
export function FieldHome({ go, saved }: { go: Go; saved?: string }) {
  const { memberships } = useSession();
  const [picked, setPicked] = useCurrentProject();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const projectId = picked || projects[0]?.id || "";
  const [front, setFront] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const catalog = useCatalog(projectId);

  const acts = useMemo(() => {
    if (!catalog) return [];
    const term = q.trim().toLowerCase();
    return catalog.activities
      .filter((a) => (front ? a.front_id === front : true))
      .filter((a) => !term || `${a.code} ${a.name}`.toLowerCase().includes(term))
      .slice(0, 60);
  }, [catalog, front, q]);

  if (!projects.length) return <p className="text-zinc-500">No tienes obras asignadas.</p>;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Registrar en campo</h1>
        {projects.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {projects.map((p) => (
              <button key={p.id} type="button" className={chip(p.id === projectId)} onClick={() => (setPicked(p.id), setFront(null))}>
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">{projects[0]?.name}</p>
        )}
      </div>

      {saved ? (
        <p className="rounded-lg bg-[#1f3a5f] px-3 py-2 font-semibold text-white" role="status">
          ✓ {saved}: guardado en el teléfono. Se sube solo cuando haya señal.
        </p>
      ) : null}
      <QueueStatus />
      <InstallHint />

      <div className="grid gap-2 sm:grid-cols-2">
        <BigButton onClick={() => go({ v: "parte" })}>📋 Parte diario</BigButton>
        <BigButton onClick={() => go({ v: "hallazgo" })}>⚑ Reportar hallazgo</BigButton>
      </div>

      <section>
        <h2 className="mb-2 text-xl font-bold">Registrar avance</h2>
        {!catalog ? (
          <p className="text-zinc-500">Cargando la obra… (la primera vez necesita señal; después queda guardada en el teléfono)</p>
        ) : (
          <>
            <p className="mb-1 font-semibold">1. ¿En qué frente?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(front === null)} onClick={() => setFront(null)}>
                Todos
              </button>
              {catalog.fronts.map((f) => (
                <button key={f.id} type="button" className={chip(front === f.id)} onClick={() => setFront(f.id)}>
                  {f.code}
                </button>
              ))}
            </div>
            <p className="mb-1 mt-3 font-semibold">2. ¿Qué actividad?</p>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por código o nombre"
              aria-label="Buscar actividad"
              className="mb-2 w-full rounded-lg border-2 border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-900"
            />
            <ul className="space-y-2">
              {acts.map((a) => {
                const p = a.contract_qty > 0 ? Math.min(1, a.executed / a.contract_qty) : 0;
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => go({ v: "registro", a: a.id })} className="block w-full rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 text-left dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="font-bold">
                        {a.code} · {a.name}
                      </div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        {Math.round(p * 100)} % · {a.executed.toLocaleString("es-CO")} de {a.contract_qty.toLocaleString("es-CO")} {a.unit}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!acts.length ? <p className="text-zinc-500">No hay actividades con ese filtro.</p> : null}
            <p className="mt-2 text-xs text-zinc-500">Datos de la obra guardados en este teléfono el {new Date(catalog.savedAt).toLocaleString("es-CO")}.</p>
          </>
        )}
      </section>
    </div>
  );
}
