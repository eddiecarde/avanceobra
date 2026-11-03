"use client";

import type { ParetoRow, SCurvePoint } from "@avanceobra/engine";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct } from "@/lib/dashboard";

const axisTick = { fill: "var(--viz-text-2)", fontSize: 12 };
const shortDate = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)}/${Number(m)}`;
};

/** Props del tooltip de Recharts, explícitas: según la versión de los tipos instalada, la inferencia se pierde. */
type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: string | number };

export function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 font-bold text-zinc-900 dark:text-zinc-100">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
          {r.color ? <LegendSwatch color={r.color} dashed={r.dashed} /> : null}
          <span>{r.label}</span>
          <span className="ml-auto pl-4 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function LegendSwatch({ color, dashed, bar }: { color: string; dashed?: boolean; bar?: boolean }) {
  if (bar) return <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />;
  return <span className="inline-block w-5 border-t-[3px]" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; bar?: boolean }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300" aria-hidden>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <LegendSwatch color={i.color} dashed={i.dashed} bar={i.bar} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const S_SERIES = [
  { key: "planned", label: "Programado", color: "var(--viz-2)", dashed: false },
  { key: "actual", label: "Real", color: "var(--viz-1)", dashed: false },
  { key: "projected", label: "Proyectado al ritmo actual", color: "var(--viz-1)", dashed: true },
] as const;

/** Curva S: avance global ponderado programado, real y proyectado, con marcas de hoy y fecha contractual. */
export function SCurveChart({
  points: raw,
  today,
  contractEnd,
  compact,
  baseline,
}: {
  points: SCurvePoint[];
  today: string;
  contractEnd: string | null;
  compact?: boolean;
  /** Programado de una línea base (p. ej. contractual), en las mismas fechas. */
  baseline?: { name: string; points: { date: string; value: number }[] } | null;
}) {
  const byDate = new Map(baseline?.points.map((p) => [p.date, p.value]));
  const points = baseline ? raw.map((p) => ({ ...p, baseline: byDate.get(p.date) ?? null })) : raw;
  const series = baseline ? [...S_SERIES, { key: "baseline" as const, label: baseline.name, color: "var(--viz-3)", dashed: true }] : S_SERIES;
  const last = points.at(-1);
  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
      <div
        className={compact ? "h-64 w-full" : "h-80 w-full"}
        role="img"
        aria-label={`Curva S. Al ${today}: real ${pct(points.find((p) => p.date === today)?.actual)}, programado ${pct(points.find((p) => p.date === today)?.planned)}.`}
      >
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 24, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} stroke="var(--viz-grid)" minTickGap={28} />
            <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => pct(v, 0)} tick={axisTick} stroke="var(--viz-grid)" width={52} />
            <Tooltip
              cursor={{ stroke: "var(--viz-text-2)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }: TipProps) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]!.payload as SCurvePoint & { baseline?: number | null };
                return (
                  <TooltipBox
                    title={String(label)}
                    rows={series.filter((s) => p[s.key] != null && !(s.key === "projected" && p.actual != null)).map((s) => ({
                      label: s.label,
                      value: pct(p[s.key]),
                      color: s.color,
                      dashed: s.dashed,
                    }))}
                  />
                );
              }}
            />
            <ReferenceLine x={today} stroke="var(--viz-text-2)" strokeDasharray="4 4" label={{ value: "Hoy", position: "top", fill: "var(--viz-text)", fontSize: 12, fontWeight: 700 }} />
            {contractEnd && last && contractEnd <= last.date ? (
              <ReferenceLine
                x={contractEnd}
                stroke="var(--viz-critical)"
                strokeWidth={2}
                label={{ value: "Fecha contractual", position: "insideTopLeft", fill: "var(--viz-text)", fontSize: 12, fontWeight: 700 }}
              />
            ) : null}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={s.key === "actual" ? 3 : 2}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={false}
                activeDot={{ r: 5, stroke: "var(--viz-surface)", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Pareto en un solo eje (% del total): barras por causa y línea del acumulado con la marca del 80 %.
 * Los "pocos vitales" van en color pleno; el resto, atenuado.
 */
export function ParetoChart({ rows, label, format }: { rows: (ParetoRow & { name: string })[]; label: string; format: (v: number) => string }) {
  if (!rows.length) return <p className="py-10 text-center text-zinc-500">Sin registros para este periodo.</p>;
  return (
    <div>
      <Legend
        items={[
          { label: `${label} (% del total)`, color: "var(--viz-1)", bar: true },
          { label: "Acumulado", color: "var(--viz-2)" },
        ]}
      />
      <div className="h-72 w-full" role="img" aria-label={`Pareto de ${label}: ${rows.filter((r) => r.vital).map((r) => r.name).join(", ")} explican el 80 %.`}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis dataKey="name" tick={{ ...axisTick, fill: "var(--viz-text)" }} stroke="var(--viz-grid)" interval={0} />
            <YAxis domain={[0, 1]} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]} tickFormatter={(v: number) => pct(v, 0)} tick={axisTick} stroke="var(--viz-grid)" width={52} />
            <Tooltip
              cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
              content={({ active, payload }: TipProps) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as ParetoRow & { name: string };
                return (
                  <TooltipBox
                    title={r.name}
                    rows={[
                      { label, value: format(r.value), color: "var(--viz-1)" },
                      { label: "% del total", value: pct(r.pct) },
                      { label: "Acumulado", value: pct(r.cumulativePct), color: "var(--viz-2)" },
                    ]}
                  />
                );
              }}
            />
            <ReferenceLine y={0.8} stroke="var(--viz-text-2)" strokeDasharray="4 4" label={{ value: "80 %", position: "insideTopRight", fill: "var(--viz-text)", fontSize: 12, fontWeight: 700 }} />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.key} fill="var(--viz-1)" fillOpacity={r.vital ? 1 : 0.4} stroke="var(--viz-surface)" strokeWidth={2} />
              ))}
            </Bar>
            <Line type="linear" dataKey="cumulativePct" stroke="var(--viz-2)" strokeWidth={2} dot={{ r: 4, fill: "var(--viz-2)", stroke: "var(--viz-surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Barras de un solo valor por día (personal en obra, horas de lluvia…), con tooltip por barra. */
export function DailyBarsChart({
  rows,
  label,
  color,
  format,
}: {
  rows: { date: string; value: number; detail?: string }[];
  label: string;
  color: string;
  format: (v: number) => string;
}) {
  if (!rows.length) return <p className="py-10 text-center text-zinc-500">Sin partes en este periodo.</p>;
  const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return (
    <div className="h-56 w-full" role="img" aria-label={`${label} por día`}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={short} tick={axisTick} stroke="var(--viz-grid)" minTickGap={16} />
          <YAxis tickFormatter={(v: number) => format(v)} tick={axisTick} stroke="var(--viz-grid)" width={44} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as { date: string; value: number; detail?: string };
              return <TooltipBox title={r.date} rows={[{ label, value: format(r.value), color }, ...(r.detail ? [{ label: "Detalle", value: r.detail }] : [])]} />;
            }}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Curvas del valor ganado en dinero (un solo eje): planeado (PV), ganado (EV) y costo real (AC). */
export function EvmChart({ rows, format }: { rows: { date: string; pv: number; ev: number; ac: number }[]; format: (v: number) => string }) {
  if (!rows.length) return <p className="py-10 text-center text-zinc-500">Sin datos todavía.</p>;
  const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const series = [
    { key: "pv", label: "Planeado (PV)", color: "var(--viz-1)", dashed: true },
    { key: "ev", label: "Ganado (EV)", color: "var(--viz-3)" },
    { key: "ac", label: "Costo real (AC)", color: "var(--viz-2)" },
  ] as const;
  const last = rows.at(-1)!;
  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: "dashed" in s }))} />
      <div
        className="h-72 w-full"
        role="img"
        aria-label={`Valor ganado al ${last.date}: planeado ${format(last.pv)}, ganado ${format(last.ev)}, costo real ${format(last.ac)}`}
      >
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} tick={axisTick} stroke="var(--viz-grid)" minTickGap={24} />
            <YAxis tickFormatter={(v: number) => format(v)} tick={axisTick} stroke="var(--viz-grid)" width={64} />
            <Tooltip
              content={({ active, payload }: TipProps) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as { date: string; pv: number; ev: number; ac: number };
                return <TooltipBox title={`Semana al ${r.date}`} rows={series.map((s) => ({ label: s.label, value: format(r[s.key]), color: s.color, dashed: "dashed" in s }))} />;
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={"dashed" in s ? "6 4" : undefined}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--viz-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Tendencia semanal de SPI y CPI con la línea de 1,0 (lo previsto). */
export function IndexTrendChart({ rows }: { rows: { date: string; spi: number | null; cpi: number | null }[] }) {
  if (rows.length < 2) return <p className="py-10 text-center text-zinc-500">Hace falta más de una semana de datos.</p>;
  const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const series = [
    { key: "spi", label: "SPI (plazo)", color: "var(--viz-1)" },
    { key: "cpi", label: "CPI (costo)", color: "var(--viz-2)" },
  ] as const;
  const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <div className="h-56 w-full" role="img" aria-label="Tendencia semanal de SPI y CPI">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} tick={axisTick} stroke="var(--viz-grid)" minTickGap={24} />
            <YAxis domain={[0, (max: number) => Math.max(1.2, Math.ceil(max * 10) / 10)]} tickFormatter={(v: number) => fmt(v)} tick={axisTick} stroke="var(--viz-grid)" width={44} />
            <ReferenceLine y={1} stroke="var(--viz-text-2)" strokeDasharray="4 4" label={{ value: "1,00 = lo previsto", position: "insideBottomRight", fill: "var(--viz-text)", fontSize: 12 }} />
            <Tooltip
              content={({ active, payload }: TipProps) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as { date: string; spi: number | null; cpi: number | null };
                return <TooltipBox title={`Semana al ${r.date}`} rows={series.map((s) => ({ label: s.label, value: fmt(r[s.key]), color: s.color }))} />;
              }}
            />
            {series.map((s) => (
              <Line key={s.key} type="linear" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 4, fill: s.color, stroke: "var(--viz-surface)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
