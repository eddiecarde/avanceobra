"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DashboardView } from "@/components/dash/DashboardView";
import { loadSharedDashboard, type DashData, type SharedLinkInfo } from "@/lib/dashboard";

export default function VerPage() {
  return (
    <Suspense fallback={<p className="p-8 text-zinc-500">Cargando…</p>}>
      <Ver />
    </Suspense>
  );
}

/** Dashboard de solo lectura por enlace compartido (sin sesión). */
function Ver() {
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<{ token: string; data?: DashData; link?: SharedLinkInfo; error?: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    loadSharedDashboard(token).then(
      (r) => setState({ token, ...r }),
      (e: Error) => setState({ token, error: e.message }),
    );
  }, [token]);

  const current = state?.token === token ? state : null;
  const expires = current?.link ? new Date(current.link.expiresAt).toLocaleDateString("es-CO", { dateStyle: "long" }) : null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-extrabold tracking-tight">
            Avance<span className="text-blue-700">Obra</span>
          </span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Solo lectura</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">
        {!token ? (
          <p className="text-zinc-600">Falta el código del enlace. Pide de nuevo el enlace a quien te lo compartió.</p>
        ) : (
          <DashboardView
            data={current?.data ?? null}
            error={current?.error ?? null}
            showFindings={current?.link?.includeFindings ?? true}
            note={current?.link ? `Enlace para ${current.link.label} · vence el ${expires} · datos al momento de abrir la página` : null}
          />
        )}
      </main>
    </div>
  );
}
