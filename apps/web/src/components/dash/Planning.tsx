"use client";

import { energizationReadiness, progressMatrix, weeklyKpi, type GroupedActivity, type WeeklyKpiRow } from "@avanceobra/engine";
import { useMemo } from "react";
import { longDate, Panel, type Status } from "@/components/dash/Overview";
import { Badge, cx } from "@/components/ui";
import { pct, type DashData } from "@/lib/dashboard";

const n0 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 0 });

/**
 * Actividades con su grupo y su zona, y lo ejecutado al corte. Sirve para cualquier obra: sin grupo
 * de trabajo, el grupo es el nombre de la actividad (el mismo trabajo en varios frentes); sin zona
 * (subcampo, tramo…), la zona es el frente.
 */
function useGrouped(data: DashData, cutoff: string) {
  return useMemo(() => {
    const acts: GroupedActivity[] = data.activities.map((a) => ({ ...a, group: a.workGroup ?? a.name, subfield: a.subfield ?? a.frontCode }));
    const executed: Record<string, number> = {};
    for (const d of data.daily) if (d.date <= cutoff) executed[d.activityId] = (executed[d.activityId] ?? 0) + d.quantity;
    return { acts, executed };
  }, [data, cutoff]);
}

/** Grupos que no condicionan la energización de un subcampo. */
const NOT_FOR_ENERGIZATION = /cctv|vigilancia|tree removal|tala/i;

// Escala secuencial de un solo tono (azul): más oscuro = más avance
const STEPS = ["#eef4fc", "#cfe0f7", "#a6c6f0", "#6fa3e6", "#3c7fd9", "#1f5fb3"];
const cellColor = (p: number) => STEPS[Math.min(STEPS.length - 1, Math.floor(p * (STEPS.length - 1) + 1e-9))]!;

/** Pestaña "Subcampos": matriz subcampo × grupo y preparación para energizar por circuito. */
/** Nombre de las zonas de la obra en singular: el del proyecto, o "Zona"/"Frente" según los datos. */
export const zoneLabelOf = (data: DashData) => data.project.zoneLabel?.trim() || (data.activities.some((a) => a.subfield) ? "Zona" : "Frente");
export const plural = (w: string) => (/[aeiou]$/i.test(w) ? `${w}s` : `${w}es`);

export function SubfieldsView({ data, cutoff, statuses }: { data: DashData; cutoff: string; statuses: Status[] }) {
  const zone = zoneLabelOf(data);
  const { acts, executed } = useGrouped(data, cutoff);
  const matrix = useMemo(() => progressMatrix(acts, executed), [acts, executed]);
  // Fecha de cada pendiente: el fin proyectado de su grupo (la cuadrilla pasa de un subcampo al
  // siguiente, así que el ritmo útil es el del grupo); si el grupo no tiene ritmo, el de la actividad;
  // y si aún no debía empezar, su fin planeado. Sin ninguna de las tres, no avanza
  const energy = useMemo(() => {
    const groupFinish = new Map(weeklyKpi(acts, data.daily, cutoff, 3).map((g) => [g.group, g.forecastFinish]));
    const byId = new Map(acts.map((a) => [a.id, a]));
    const projected = Object.fromEntries(
      statuses.map((s) => {
        const a = byId.get(s.id);
        const notDue = a?.plannedStart && a.plannedStart > cutoff ? a.plannedFinish : null;
        return [s.id, groupFinish.get(a?.group ?? "") ?? s.projectedFinish ?? notDue ?? null];
      }),
    );
    // CCTV y tala no condicionan la energización: no cuentan como pendientes
    const needed = acts.filter((a) => !NOT_FOR_ENERGIZATION.test(a.group ?? ""));
    return energizationReadiness(data.subfields, needed, executed, projected, cutoff);
  }, [data.subfields, data.daily, acts, executed, statuses, cutoff]);
  const frontNames = new Map(data.activities.map((a) => [a.frontCode, a.frontName]));
  const label = (code: string) => data.subfields.find((s) => s.code === code)?.name ?? (frontNames.has(code) ? `${code} · ${frontNames.get(code)}` : code);

  return (
    <div className="space-y-4">
      {data.subfields.some((s) => s.circuit) ? (
        <Panel title="Energización por circuito">
          <p className="-mt-2 mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Cada circuito se energiza de cabecera a cola: queda listo cuando todas las actividades de sus subcampos están completas (sin contar CCTV ni tala). La
            fecha proyectada sale del ritmo de las actividades pendientes; se compara con la energización del plan vigente y con la línea base contractual.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {energy.circuits.map((c) => {
              const late = c.planned && c.projectedReady && !c.ready && c.projectedReady > c.planned;
              return (
                <section key={c.circuit} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800" aria-label={c.circuit}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="mr-auto font-bold">{c.circuit}</h3>
                    {c.ready ? (
                      <Badge tone="green">✓ Listo para energizar</Badge>
                    ) : c.projectedReady ? (
                      <Badge tone={late ? "red" : "amber"}>{`${late ? "■" : "▲"} Listo el ${longDate(c.projectedReady)}`}</Badge>
                    ) : (
                      <Badge tone="red">■ Sin ritmo para proyectar</Badge>
                    )}
                  </div>
                  {!c.ready && c.sets && !c.blockers.length ? (
                    <p className="mb-1 text-xs text-zinc-600 dark:text-zinc-400">
                      <b>Marca la fecha:</b> {c.sets} (el grupo pendiente que termina último a su ritmo actual)
                    </p>
                  ) : null}
                  {c.blockers.length ? (
                    <p className="mb-1 text-xs text-red-700 dark:text-red-400">
                      <b>Frenan:</b> {c.blockers.slice(0, 4).join(", ")}
                      {c.blockers.length > 4 ? ` y ${c.blockers.length - 4} más` : ""} (sin avance en las últimas 3 semanas)
                    </p>
                  ) : null}
                  <div className="mb-2 text-xs text-zinc-500">
                    Energización plan vigente {longDate(c.planned)} · contractual {longDate(c.baseline)}
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {c.subfields.map((s) => (
                      <li key={s.code} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs font-semibold uppercase text-zinc-500">{s.position ?? "—"}</span>
                        <span className="min-w-0 flex-1 truncate" title={s.name}>
                          {s.name}
                        </span>
                        <span className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${s.pct * 100}%`, background: s.ready ? "var(--viz-good)" : "var(--viz-1)" }} />
                        </span>
                        <span className="w-12 text-right tabular-nums">{pct(s.pct, 0)}</span>
                        <span className={cx("w-28 shrink-0 text-right text-xs whitespace-nowrap", s.delayDays != null && s.delayDays > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-zinc-500")}>
                          {s.ready ? "listo" : `${s.pending} pend.${s.delayDays != null && s.delayDays > 0 ? ` · +${s.delayDays} d` : ""}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <Panel title={`Matriz de avance por ${zone.toLowerCase()}`}>
        {matrix.subfields.length === 0 ? (
          <p className="text-sm text-zinc-500">No hay actividades para mostrar.</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden>
              <span>0 %</span>
              {STEPS.map((c) => (
                <span key={c} className="h-3 w-6 rounded-sm" style={{ background: c }} />
              ))}
              <span>100 %</span>
              <span className="ml-3">✓ = terminado · vacío = sin actividades</span>
            </div>
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white px-2 text-left dark:bg-zinc-900">{zone}</th>
                    {matrix.groups.map((g) => (
                      <th key={g} className="h-36 min-w-9 align-bottom font-semibold text-zinc-600 dark:text-zinc-400" title={g}>
                        <span className="inline-block max-h-34 -rotate-180 overflow-hidden text-ellipsis whitespace-nowrap [writing-mode:vertical-rl]">{g}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.subfields.map((sf) => (
                    <tr key={sf}>
                      <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-semibold whitespace-nowrap dark:bg-zinc-900" title={label(sf)}>
                        {label(sf)}
                      </th>
                      {matrix.groups.map((g) => {
                        const c = matrix.cells[sf]?.[g];
                        return (
                          <td
                            key={g}
                            title={c ? `${label(sf)} · ${g}: ${pct(c.pct)}` : `${label(sf)} · ${g}: sin actividades`}
                            className="h-8 min-w-9 rounded text-center tabular-nums"
                            style={{ background: c ? cellColor(c.pct) : "transparent", color: c && c.pct > 0.6 ? "#fff" : "var(--viz-text)" }}
                          >
                            {c ? (c.pct >= 0.999 ? "✓" : Math.round(c.pct * 100)) : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/** Pestaña "Semanal": rendimiento real vs. requerido por grupo y fin proyectado con las últimas 3 semanas. */
export function WeeklyView({ data, cutoff }: { data: DashData; cutoff: string }) {
  const { acts } = useGrouped(data, cutoff);
  const rows = useMemo(() => weeklyKpi(acts, data.daily, cutoff, 6), [acts, data.daily, cutoff]);
  const open = rows.filter((r) => !r.done);
  const finished = rows.length - open.length;

  if (!rows.length)
    return (
      <Panel title="KPI semanal">
        <p className="text-sm text-zinc-500">No hay actividades para mostrar.</p>
      </Panel>
    );
  return (
    <Panel title={data.activities.some((a) => a.workGroup) ? "KPI semanal por grupo de trabajo" : "KPI semanal por actividad"}>
      <p className="-mt-2 mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Semanas de 7 días que terminan el {longDate(cutoff)}. KPI = lo hecho la última semana ÷ lo que hay que hacer por semana para terminar en la fecha planeada.
        {finished ? ` ${finished} grupo(s) terminados al final de la tabla.` : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
            <tr>
              <th className="rounded-l-lg px-2 py-2 font-semibold">Grupo</th>
              <th className="px-2 font-semibold">Avance</th>
              <th className="px-2 font-semibold">Últimas 6 semanas</th>
              <th className="px-2 text-right font-semibold">Última semana</th>
              <th className="px-2 text-right font-semibold">Prom. 3 sem.</th>
              <th className="px-2 text-right font-semibold">Requerido / sem.</th>
              <th className="px-2 font-semibold">KPI</th>
              <th className="px-2 font-semibold">Fin planeado</th>
              <th className="rounded-r-lg px-2 font-semibold">Fin proyectado</th>
            </tr>
          </thead>
          <tbody>
            {[...open, ...rows.filter((r) => r.done)].map((r) => (
              <KpiRow key={r.group} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function KpiRow({ r }: { r: WeeklyKpiRow }) {
  const fmt = (v: number) => (r.unit ? `${n0(v)} ${r.unit}` : pct(v));
  const max = Math.max(...r.weeks, r.requiredPerWeek ?? 0, 1e-9);
  const late = r.forecastFinish && r.plannedFinish && r.forecastFinish > r.plannedFinish;
  return (
    <tr className={cx("border-b border-zinc-100 dark:border-zinc-800", r.done && "text-zinc-500")}>
      <td className="px-2 py-2 font-medium">{r.group}</td>
      <td className="px-2 tabular-nums">{pct(r.total ? r.executed / r.total : 0, 0)}</td>
      <td className="px-2">
        {/* Barras por semana con la línea del ritmo requerido */}
        <svg width="132" height="28" role="img" aria-label={`Semanas: ${r.weeks.map(fmt).join(", ")}`}>
          {r.weeks.map((w, i) => {
            const h = (w / max) * 24;
            return <rect key={i} x={i * 22 + 2} y={26 - h} width="16" height={Math.max(h, 0.5)} rx="2" fill="var(--viz-1)" opacity={i === r.weeks.length - 1 ? 1 : 0.55} />;
          })}
          {r.requiredPerWeek ? <line x1="0" x2="132" y1={26 - (r.requiredPerWeek / max) * 24} y2={26 - (r.requiredPerWeek / max) * 24} stroke="var(--viz-2)" strokeWidth="2" strokeDasharray="4 3" /> : null}
        </svg>
      </td>
      <td className="px-2 text-right tabular-nums">{fmt(r.lastWeek)}</td>
      <td className="px-2 text-right tabular-nums">{fmt(r.avg3)}</td>
      <td className="px-2 text-right tabular-nums">{r.done ? "—" : r.requiredPerWeek == null ? "vencido" : fmt(r.requiredPerWeek)}</td>
      <td className="px-2">
        {r.done ? (
          <Badge tone="green">✓ Terminado</Badge>
        ) : r.kpi == null ? (
          <Badge tone="red">■ Fecha vencida</Badge>
        ) : (
          <Badge tone={r.kpi >= 1 ? "green" : r.kpi >= 0.8 ? "amber" : "red"}>{`${r.kpi >= 1 ? "●" : r.kpi >= 0.8 ? "▲" : "■"} ${r.kpi.toLocaleString("es-CO", { maximumFractionDigits: 2 })}`}</Badge>
        )}
      </td>
      <td className="px-2 tabular-nums">{longDate(r.plannedFinish)}</td>
      <td className={cx("px-2 tabular-nums", late && "font-semibold text-red-700 dark:text-red-400")}>{r.done ? "—" : r.forecastFinish ? longDate(r.forecastFinish) : "sin ritmo"}</td>
    </tr>
  );
}
