"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, cx } from "@/components/ui";
import { AiSummary } from "@/components/AiSummary";
import { localToday, pct } from "@/lib/dashboard";
import { loadRow, M, summaryFacts, type Row } from "@/lib/gerencia";
import { useSession } from "@/lib/session";

/** Vista de gerencia: todas las obras lado a lado, de la más comprometida a la más tranquila. */
export default function Gerencia() {
  const { memberships, setCurrentProjectId, canUseAi } = useSession();
  const router = useRouter();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const today = localToday();
  const [rows, setRows] = useState<Record<string, Row | { error: string }>>({});
  const [aiFor, setAiFor] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    for (const p of projects)
      loadRow(p.id, today).then(
        (r) => !off && setRows((s) => ({ ...s, [p.id]: r })),
        (e: Error) => !off && setRows((s) => ({ ...s, [p.id]: { error: e.message } })),
      );
    return () => {
      off = true;
    };
  }, [projects, today]);

  const ready = Object.values(rows).filter((r): r is Row => !("error" in r));
  // Primero las obras con más días de atraso proyectado
  const sorted = [...ready].sort((a, b) => (b.delayDays ?? -1e9) - (a.delayDays ?? -1e9));
  const totals = {
    penalty: ready.reduce((t, r) => t + (r.penalty ?? 0), 0),
    critical: ready.reduce((t, r) => t + r.critical, 0),
    late: ready.filter((r) => (r.delayDays ?? 0) > 0).length,
  };
  const open = (id: string, path: string) => {
    setCurrentProjectId(id);
    router.push(path);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Gerencia</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Todas las obras lado a lado: avance, atraso, multa estimada, plan cumplido, hallazgos críticos, materiales y lo cobrado. Corte: hoy.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Obras</div>
          <div className="text-2xl font-extrabold">{projects.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Con atraso proyectado</div>
          <div className={cx("text-2xl font-extrabold", totals.late > 0 && "text-red-700 dark:text-red-400")}>{totals.late}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Multa estimada total</div>
          <div className={cx("text-2xl font-extrabold", totals.penalty > 0 && "text-red-700 dark:text-red-400")}>{M(totals.penalty)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Hallazgos críticos abiertos</div>
          <div className={cx("text-2xl font-extrabold", totals.critical > 0 && "text-red-700 dark:text-red-400")}>{totals.critical}</div>
        </Card>
      </div>

      {ready.length < projects.length ? <p className="text-sm text-zinc-500">{`Cargando ${projects.length - ready.length} obra(s)…`}</p> : null}
      {Object.entries(rows)
        .filter(([, r]) => "error" in r)
        .map(([id, r]) => (
          <Card key={id} className="text-red-700">
            {projects.find((p) => p.id === id)?.name}: {(r as { error: string }).error}
          </Card>
        ))}

      {aiFor && rows[aiFor] && !("error" in rows[aiFor]) ? (
        <AiSummary key={aiFor} projectId={aiFor} title={(rows[aiFor] as Row).name} facts={summaryFacts(rows[aiFor] as Row, today)} onClose={() => setAiFor(null)} />
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
              <tr>
                <th className="px-2 py-2">Obra</th>
                <th className="px-2">Avance real / programado</th>
                <th className="px-2 text-right">SPI</th>
                <th className="px-2">Fin proyectado</th>
                <th className="px-2 text-right">Multa estimada</th>
                <th className="px-2 text-right">PPC</th>
                <th className="px-2">Hallazgos</th>
                <th className="px-2">Materiales</th>
                <th className="px-2 text-right">Cobrado</th>
                <th className="px-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                  <td className="px-2 py-2 font-semibold">{r.name}</td>
                  <td className="px-2">
                    <div className="relative h-3 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min(100, r.actual * 100)}%` }} />
                      <div className="absolute inset-y-0 w-0.5 bg-[var(--viz-text)]" style={{ left: `${Math.min(100, r.planned * 100)}%` }} />
                    </div>
                    <div className="mt-0.5 tabular-nums">
                      {pct(r.actual)} de {pct(r.planned)}
                    </div>
                  </td>
                  <td className={cx("px-2 text-right tabular-nums", r.spi != null && r.spi < 0.9 && "font-semibold text-red-700 dark:text-red-400")}>{pct(r.spi, 0)}</td>
                  <td className="px-2 tabular-nums">
                    {r.projectedFinish ?? "Sin fecha"}
                    {r.delayDays != null && r.delayDays !== 0 ? (
                      <div className={cx("text-xs", r.delayDays > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400")}>
                        {r.delayDays > 0 ? `+${r.delayDays} días` : `${-r.delayDays} días antes`}
                      </div>
                    ) : null}
                  </td>
                  <td className={cx("px-2 text-right tabular-nums", (r.penalty ?? 0) > 0 && "font-semibold text-red-700 dark:text-red-400")}>{r.penalty == null ? "sin contrato" : M(r.penalty)}</td>
                  <td className="px-2 text-right tabular-nums">{r.ppc == null ? "—" : pct(r.ppc, 0)}</td>
                  <td className="px-2">
                    <div className="flex flex-wrap gap-1">
                      {r.critical ? <Badge tone="red">{`${r.critical} crítico(s)`}</Badge> : null}
                      {r.impeditive ? <Badge tone="red">{`${r.impeditive} impeditivo(s)`}</Badge> : null}
                      {r.overdue ? <Badge tone="amber">{`${r.overdue} vencido(s)`}</Badge> : null}
                      {!r.critical && !r.impeditive && !r.overdue ? <Badge tone="green">Al día</Badge> : null}
                    </div>
                  </td>
                  <td className="px-2">{r.materialsLow.length ? <Badge tone="amber">{`Por agotarse: ${r.materialsLow.slice(0, 2).join(", ")}`}</Badge> : "—"}</td>
                  <td className="px-2 text-right tabular-nums">
                    {r.billed == null ? "—" : M(r.billed)}
                    {r.billed != null && r.contractValue ? <div className="text-xs text-zinc-500">{pct(r.billed / r.contractValue, 0)} del contrato</div> : null}
                  </td>
                  <td className="space-x-2 px-2 text-right whitespace-nowrap">
                    <button className="font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => open(r.id, "/dashboard")}>
                      Panel
                    </button>
                    <button className="font-semibold text-blue-700 hover:underline dark:text-blue-400" onClick={() => open(r.id, "/simulador")}>
                      Multa
                    </button>
                    {canUseAi(r.id) ? (
                      <button
                        className="font-semibold text-blue-700 hover:underline dark:text-blue-400"
                        onClick={() => setAiFor(r.id)}
                        aria-label={`Resumen con IA de ${r.name}`}
                      >
                        Resumen IA
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Multa estimada: días de atraso proyectado × multa diaria del contrato, con su tope. Cobrado: acumulado de la última acta al cliente.
        </p>
      </Card>
    </div>
  );
}
