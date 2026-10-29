"use client";

import type { ReactNode } from "react";

/**
 * Gráficos de los informes en SVG con viewBox: escalan al ancho de la hoja y se imprimen igual que en
 * pantalla (sin medir el contenedor). Un solo eje vertical por gráfico; leyenda siempre visible; cada
 * marca tiene <title> para ver el valor al pasar el mouse.
 */

const W = 720;
const PAD = { l: 52, r: 16, t: 14, b: 30 };
export const CAT = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];
export const OTHER = "#a1a09b";

export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  legend?: { label: string; color: string; dashed?: boolean; bar?: boolean }[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`break-inside-avoid rounded-md border border-zinc-200 p-3 ${className ?? ""}`}>
      <figcaption>
        <div className="text-[13px] font-bold">{title}</div>
        <div className="text-[11.5px] text-zinc-500">{subtitle}</div>
      </figcaption>
      {legend?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-zinc-700">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              {l.bar ? (
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              ) : (
                <span
                  className="inline-block w-5 border-t-[3px]"
                  style={{
                    borderColor: l.color,
                    borderStyle: l.dashed ? "dashed" : "solid",
                  }}
                />
              )}
              {l.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-1">{children}</div>
    </figure>
  );
}

/** Máximo del eje para conteos: múltiplo de 4 (cuatro divisiones enteras). */
export const ceil4 = (v: number) => Math.max(4, Math.ceil(v / 4) * 4);

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};

function YAxis({ h, max, fmt, ticks = 4 }: { h: number; max: number; fmt: (v: number) => string; ticks?: number }) {
  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max * i) / ticks;
        const y = PAD.t + (h - PAD.t - PAD.b) * (1 - i / ticks);
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--viz-text-2)">
              {fmt(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Líneas sobre un eje de categorías (fechas o semanas). Los null cortan la línea. */
export function LinesChart({
  labels,
  series,
  max,
  fmt,
  marks = [],
  height = 220,
  ariaLabel,
  labelEvery,
}: {
  labels: string[];
  series: {
    label: string;
    color: string;
    values: (number | null)[];
    dashed?: boolean;
    width?: number;
    dots?: boolean;
  }[];
  max?: number;
  fmt: (v: number) => string;
  /** Líneas verticales de referencia (índice de la categoría). */
  marks?: { at: number; label: string; color: string }[];
  height?: number;
  ariaLabel: string;
  labelEvery?: number;
}) {
  const top = max ?? niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)))));
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n;
  const y = (v: number) => PAD.t + (height - PAD.t - PAD.b) * (1 - Math.min(v, top) / top);
  const every = labelEvery ?? Math.max(1, Math.ceil(labels.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      <YAxis h={height} max={top} fmt={fmt} />
      {labels.map((l, i) =>
        (i % every === 0 && labels.length - 1 - i >= every * 0.7) || i === labels.length - 1 ? (
          <text key={i} x={x(i)} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--viz-text-2)">
            {l}
          </text>
        ) : null,
      )}
      {marks.map((m) => (
        <g key={m.label}>
          <line x1={x(m.at)} x2={x(m.at)} y1={PAD.t} y2={height - PAD.b} stroke={m.color} strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={x(m.at) + 4} y={PAD.t + 10} fontSize={11} fontWeight={700} fill="var(--viz-text)">
            {m.label}
          </text>
        </g>
      ))}
      {series.map((s) => {
        const segs: string[] = [];
        let cur = "";
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) {
            if (cur) segs.push(cur);
            cur = "";
          } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        });
        if (cur) segs.push(cur);
        return (
          <g key={s.label}>
            {segs.map((d, k) => (
              <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" />
            ))}
            {s.dots
              ? s.values.map((v, i) =>
                  v == null || !Number.isFinite(v) ? null : (
                    <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="#fff" strokeWidth={2}>
                      <title>{`${s.label} · ${labels[i]}: ${fmt(v)}`}</title>
                    </circle>
                  ),
                )
              : s.values.map((v, i) =>
                  v == null || !Number.isFinite(v) || (i % every !== 0 && i !== s.values.length - 1) ? null : (
                    <circle key={i} cx={x(i)} cy={y(v)} r={6} fill="transparent">
                      <title>{`${s.label} · ${labels[i]}: ${fmt(v)}`}</title>
                    </circle>
                  ),
                )}
          </g>
        );
      })}
    </svg>
  );
}

/** Barras apiladas por categoría (p. ej. avance aportado por día y frente). */
export function StackedBars({
  labels,
  stacks,
  fmt,
  height = 210,
  ariaLabel,
  line,
}: {
  labels: string[];
  stacks: { label: string; color: string; values: number[] }[];
  fmt: (v: number) => string;
  height?: number;
  ariaLabel: string;
  /** Línea de referencia por categoría (p. ej. lo programado), mismo eje. */
  line?: { label: string; color: string; values: (number | null)[] };
}) {
  const totals = labels.map((_, i) => stacks.reduce((s, st) => s + Math.max(0, st.values[i] ?? 0), 0));
  const top = niceMax(Math.max(...totals, ...(line?.values.filter((v): v is number => v != null) ?? []), 0));
  const band = (W - PAD.l - PAD.r) / Math.max(1, labels.length);
  const bw = Math.min(48, band * 0.6);
  const y = (v: number) => PAD.t + (height - PAD.t - PAD.b) * (1 - v / top);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      <YAxis h={height} max={top} fmt={fmt} />
      {labels.map((l, i) => {
        const cx = PAD.l + band * i + band / 2;
        let acc = 0;
        return (
          <g key={i}>
            {stacks.map((st) => {
              const v = Math.max(0, st.values[i] ?? 0);
              if (!v) return null;
              const y1 = y(acc + v);
              const y0 = y(acc);
              acc += v;
              return (
                <rect key={st.label} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1 - 1.5)} fill={st.color} rx={1.5}>
                  <title>{`${l} · ${st.label}: ${fmt(v)}`}</title>
                </rect>
              );
            })}
            {totals[i] ? (
              <text x={cx} y={y(totals[i]!) - 4} textAnchor="middle" fontSize={10.5} fill="var(--viz-text)">
                {fmt(totals[i]!)}
              </text>
            ) : null}
            <text x={cx} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--viz-text-2)">
              {l}
            </text>
          </g>
        );
      })}
      {line ? (
        <path
          d={line.values.map((v, i) => (v == null ? "" : `${i && line.values[i - 1] != null ? "L" : "M"}${(PAD.l + band * i + band / 2).toFixed(1)},${y(v).toFixed(1)}`)).join("")}
          fill="none"
          stroke={line.color}
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      ) : null}
    </svg>
  );
}

/** Barras horizontales de cumplimiento (ratio) con la referencia del 100 %. */
export function RatioBars({ rows, ariaLabel }: { rows: { label: string; ratio: number; detail: string }[]; ariaLabel: string }) {
  const rowH = 24;
  const labelW = 210;
  const h = PAD.t + rows.length * rowH + 22;
  const maxR = Math.max(1.2, ...rows.map((r) => Math.min(r.ratio, 3)));
  const x = (r: number) => labelW + ((W - labelW - 70) * Math.min(r, 3)) / maxR;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const yy = PAD.t + i * rowH;
        const color = r.ratio >= 1 ? "var(--viz-good)" : r.ratio >= 0.8 ? "var(--viz-4)" : "var(--viz-critical)";
        return (
          <g key={r.label}>
            <text x={labelW - 8} y={yy + 15} textAnchor="end" fontSize={11} fill="var(--viz-text)">
              {r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label}
            </text>
            <rect x={labelW} y={yy + 4} width={Math.max(2, x(r.ratio) - labelW)} height={14} fill={color} rx={2}>
              <title>{`${r.label}: ${r.detail}`}</title>
            </rect>
            <text x={x(r.ratio) + 5} y={yy + 15} fontSize={10.5} fill="var(--viz-text-2)">
              {`${Math.round(r.ratio * 100)} %`}
            </text>
          </g>
        );
      })}
      <line x1={x(1)} x2={x(1)} y1={PAD.t - 4} y2={h - 18} stroke="var(--viz-text)" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={x(1)} y={h - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--viz-text)">
        100 % = ritmo necesario
      </text>
    </svg>
  );
}

/** Barras agrupadas (dos series) con una línea en el mismo eje, p. ej. hallazgos abiertos/cerrados/vigentes. */
export function GroupedBarsLine({
  labels,
  bars,
  line,
  ariaLabel,
  height = 200,
}: {
  labels: string[];
  bars: { label: string; color: string; values: number[] }[];
  line: { label: string; color: string; values: number[] };
  ariaLabel: string;
  height?: number;
}) {
  const top = ceil4(Math.max(1, ...bars.flatMap((b) => b.values), ...line.values));
  const band = (W - PAD.l - PAD.r) / Math.max(1, labels.length);
  const bw = Math.min(20, (band * 0.7) / bars.length);
  const y = (v: number) => PAD.t + (height - PAD.t - PAD.b) * (1 - v / top);
  const cx = (i: number) => PAD.l + band * i + band / 2;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString("es-CO", { maximumFractionDigits: 1 }));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      <YAxis h={height} max={top} fmt={fmt} />
      {labels.map((l, i) => (
        <g key={i}>
          {bars.map((b, k) => {
            const v = b.values[i] ?? 0;
            const x0 = cx(i) - (bw * bars.length) / 2 + k * bw;
            return (
              <rect key={b.label} x={x0 + 1} y={y(v)} width={bw - 2} height={Math.max(0, y(0) - y(v))} fill={b.color} rx={1.5}>
                <title>{`${l} · ${b.label}: ${v}`}</title>
              </rect>
            );
          })}
          <text x={cx(i)} y={height - 10} textAnchor="middle" fontSize={11} fill="var(--viz-text-2)">
            {l}
          </text>
        </g>
      ))}
      <path d={line.values.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none" stroke={line.color} strokeWidth={2} />
      {line.values.map((v, i) => (
        <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={line.color} stroke="#fff" strokeWidth={2}>
          <title>{`${labels[i]} · ${line.label}: ${v}`}</title>
        </circle>
      ))}
    </svg>
  );
}
