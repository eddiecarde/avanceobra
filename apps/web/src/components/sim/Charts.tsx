"use client";

import type { CurvePoint, PlanResult, ScenarioKey } from "@avanceobra/engine";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: n >= 1e9 ? 0 : 1 })} M`;
const axisTick = { fill: "var(--viz-text-2)", fontSize: 12 };

/** Props del tooltip de Recharts, explícitas: según la versión de los tipos instalada, la inferencia se pierde. */
type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: string | number };

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 font-bold text-zinc-900 dark:text-zinc-100">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
          {r.color ? <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} /> : null}
          <span>{r.label}</span>
          <span className="ml-auto pl-4 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Costo total vs. días de retraso (curva del escenario mixto): cada punto es un paso de
 * aceleración. El mínimo marca el punto de equilibrio.
 */
export function CostCurveChart({ curve }: { curve: CurvePoint[] }) {
  if (curve.length < 2) return <p className="text-sm text-zinc-500">No hay pasos de aceleración posibles para trazar la curva.</p>;
  const data = [...curve].sort((a, b) => b.delayDays - a.delayDays);
  const min = curve.reduce((a, b) => (b.total < a.total ? b : a));
  return (
    <div className="h-72 w-full" role="img" aria-label={`Costo total contra días de retraso. Mínimo ${M(min.total)} con ${min.delayDays} días de retraso.`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 28, right: 64, bottom: 24, left: 8 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis
            dataKey="delayDays"
            type="number"
            reversed
            domain={["dataMin", "dataMax"]}
            allowDecimals={false}
            tick={axisTick}
            stroke="var(--viz-grid)"
            label={{ value: "Días de retraso", position: "insideBottom", offset: -12, fill: "var(--viz-text-2)", fontSize: 12 }}
          />
          <YAxis tickFormatter={M} tick={axisTick} stroke="var(--viz-grid)" width={72} />
          <Tooltip
            cursor={{ stroke: "var(--viz-text-2)", strokeDasharray: "3 3" }}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as CurvePoint;
              return (
                <TooltipBox
                  title={`${p.delayDays} día(s) de retraso · ${p.projectDuration} días de obra`}
                  rows={[
                    { label: "Costo total", value: M(p.total), color: "var(--viz-1)" },
                    { label: "Paso", value: p.step },
                  ]}
                />
              );
            }}
          />
          <Line type="monotone" dataKey="total" stroke="var(--viz-1)" strokeWidth={2} dot={{ r: 4, fill: "var(--viz-1)", stroke: "var(--viz-surface)", strokeWidth: 2 }} activeDot={{ r: 6, stroke: "var(--viz-surface)", strokeWidth: 2 }} isAnimationActive={false} />
          <ReferenceDot
            x={min.delayDays}
            y={min.total}
            r={8}
            fill="var(--viz-good)"
            stroke="var(--viz-surface)"
            strokeWidth={2}
            label={{ value: `Mínimo ${M(min.total)}`, position: "top", fill: "var(--viz-text)", fontSize: 12, fontWeight: 700 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const COMPONENTS = [
  { key: "currentResources", label: "Recursos actuales", color: "var(--viz-1)" },
  { key: "acceleration", label: "Aceleración", color: "var(--viz-2)" },
  { key: "quality", label: "Calidad y reproceso", color: "var(--viz-3)" },
  { key: "penalty", label: "Multa", color: "var(--viz-4)" },
  { key: "indirect", label: "Indirectos", color: "var(--viz-5)" },
] as const;

/** Composición del costo total de cada escenario (barras apiladas horizontales). */
export function ScenarioStackChart({ scenarios, labels }: { scenarios: Record<ScenarioKey, PlanResult>; labels: Record<ScenarioKey, string> }) {
  const order: ScenarioKey[] = ["base", "uniform", "optimal", "claim"];
  const data = order.map((k) => ({ name: labels[k], key: k, ...Object.fromEntries(COMPONENTS.map((c) => [c.key, Math.max(0, scenarios[k][c.key])])), total: scenarios[k].total }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300" aria-hidden>
        {COMPONENTS.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
      <div className="h-64 w-full" role="img" aria-label="Composición del costo total por escenario">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 88, bottom: 4, left: 8 }} barCategoryGap={14}>
            <CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={M} tick={axisTick} stroke="var(--viz-grid)" />
            <YAxis type="category" dataKey="name" width={170} tick={{ ...axisTick, fill: "var(--viz-text)" }} stroke="var(--viz-grid)" />
            <Tooltip
              cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
              content={({ active, payload }: TipProps) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]!.payload as Record<string, number | string>;
                return (
                  <TooltipBox
                    title={String(row.name)}
                    rows={[
                      ...COMPONENTS.filter((c) => Number(row[c.key]) > 0).map((c) => ({ label: c.label, value: M(Number(row[c.key])), color: c.color })),
                      { label: "Total", value: M(Number(row.total)) },
                    ]}
                  />
                );
              }}
            />
            {COMPONENTS.map((c, i) => (
              <Bar
                key={c.key}
                dataKey={c.key}
                stackId="costo"
                fill={c.color}
                stroke="var(--viz-surface)"
                strokeWidth={2}
                isAnimationActive={false}
                radius={i === COMPONENTS.length - 1 ? [0, 4, 4, 0] : 0}
                label={
                  i === COMPONENTS.length - 1
                    ? (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) => {
                        // Total al final de la barra: la suma de todos los segmentos (no solo el último)
                        const row = data[props.index ?? 0];
                        if (!row) return null;
                        const x = Number(props.x ?? 0) + Number(props.width ?? 0) + 6;
                        const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2 + 4;
                        return (
                          <text x={x} y={y} fill="var(--viz-text)" fontSize={12} fontWeight={700}>
                            {M(row.total)}
                          </text>
                        );
                      }
                    : false
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
