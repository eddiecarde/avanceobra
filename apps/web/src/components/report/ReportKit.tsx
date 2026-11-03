"use client";

import { REPORT_STATUS_LABEL, REPORT_STATUS_ORDER, type Observation, type ReportStatus, type Situation } from "@avanceobra/engine";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { STATUS_STYLE } from "@/lib/report";

/**
 * Piezas comunes de los informes diario y semanal: hoja clara (igual en pantalla e impresa), encabezado
 * de página con proyecto y periodo, numeración de páginas, tarjetas KPI, semáforo y situaciones.
 */

const cssString = (s: string) => `"${s.replace(/["\\]/g, "\\$&").replace(/\n/g, " ")}"`;

export function ReportSheet({ running, children, wide }: { running: string; children: ReactNode; wide?: boolean }) {
  return (
    <>
      {/* Encabezado y pie de cada página impresa: proyecto, periodo y "Página X de Y" */}
      <style>{`@page { margin: 16mm 13mm 15mm;
  @top-left { content: ${cssString(running)}; font: 8pt Arial, sans-serif; color: #52514e; }
  @bottom-left { content: "AvanceObra"; font: 8pt Arial, sans-serif; color: #8a8985; }
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt Arial, sans-serif; color: #52514e; } }`}</style>
      <article
        className={cx(
          "report-sheet mx-auto overflow-x-auto rounded-lg bg-white p-4 text-[13.5px] sm:p-8 print:overflow-visible leading-snug text-zinc-900 shadow-sm ring-1 ring-zinc-200 print:max-w-none print:p-0 print:text-[11.5px] print:shadow-none print:ring-0",
          wide ? "max-w-[1100px]" : "max-w-[960px]",
        )}
      >
        {children}
      </article>
    </>
  );
}

/** Título de sección numerado; no queda solo al pie de una página. */
export function Section({ n, title, note, children, className }: { n?: string; title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-7", className)}>
      <div className="mb-2 flex items-baseline gap-2 border-b-2 border-[#1f3a5f] pb-1 [break-after:avoid]">
        <h2 className="text-[15px] font-extrabold uppercase tracking-wide text-[#1f3a5f]">
          {n ? <span className="mr-1.5 text-zinc-400">{n}</span> : null}
          {title}
        </h2>
        {note ? <span className="ml-auto text-xs text-zinc-500">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Origen del dato: lo registrado en campo, lo calculado por el motor o lo recomendado por regla. */
export function SourceTag({ kind }: { kind: "registrado" | "calculado" | "recomendacion" }) {
  const t = {
    registrado: ["Registrado", "bg-zinc-100 text-zinc-700"],
    calculado: ["Calculado", "bg-sky-100 text-sky-800"],
    recomendacion: ["Recomendación", "bg-emerald-100 text-emerald-800"],
  }[kind];
  return <span className={cx("mr-1.5 inline-block rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide", t[1])}>{t[0]}</span>;
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 }) {
  return (
    <div
      className={cx(
        "grid grid-cols-2 gap-2.5",
        cols === 3 ? "sm:grid-cols-3 print:grid-cols-3" : cols === 5 ? "sm:grid-cols-5 print:grid-cols-5" : "sm:grid-cols-4 print:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
}

const TONE_BORDER = {
  critical: "border-l-red-600",
  warning: "border-l-amber-500",
  good: "border-l-emerald-600",
  info: "border-l-[#1f3a5f]",
  neutral: "border-l-zinc-300",
};

export function Kpi({
  label,
  value,
  sub,
  tone = "info",
  bar,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof TONE_BORDER;
  /** Barra de avance: real y programado (fracciones 0..1). */
  bar?: { actual: number; planned: number };
}) {
  return (
    <div className={cx("break-inside-avoid rounded-md border border-l-4 border-zinc-200 bg-zinc-50/60 px-3 py-2", TONE_BORDER[tone])}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-[19px] font-extrabold leading-tight tabular-nums text-zinc-900 print:text-[16px]">{value}</div>
      {bar ? (
        <div className="relative mt-1 h-1.5 rounded-full bg-zinc-200" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full bg-[#1f3a5f]" style={{ width: `${Math.min(100, bar.actual * 100)}%` }} />
          <div className="absolute -top-0.5 h-2.5 w-0.5 bg-[#eb6834]" style={{ left: `${Math.min(100, bar.planned * 100)}%` }} title="Programado" />
        </div>
      ) : null}
      {sub ? <div className="mt-0.5 text-[11.5px] leading-tight text-zinc-600">{sub}</div> : null}
    </div>
  );
}

export function StatusChip({ status }: { status: ReportStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset", s.cls)}>
      <span aria-hidden>{s.icon}</span>
      {REPORT_STATUS_LABEL[status]}
    </span>
  );
}

/** Conteo de actividades por estado (todas suman el total del programa). */
export function StatusStrip({ counts, total }: { counts: Record<ReportStatus, number>; total: number }) {
  return (
    <div className="mt-3 break-inside-avoid">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100" aria-hidden>
        {REPORT_STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <div key={s} className={cx("h-full border-r-2 border-white last:border-r-0", BAR[s])} style={{ width: `${(counts[s] / Math.max(1, total)) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
        {REPORT_STATUS_ORDER.map((s) => (
          <span key={s} className={cx("inline-flex items-center gap-1", counts[s] ? "text-zinc-800" : "text-zinc-400")}>
            <span aria-hidden className={cx("inline-block h-2.5 w-2.5 rounded-sm", BAR[s])} />
            {REPORT_STATUS_LABEL[s]} <b className="tabular-nums">{counts[s]}</b>
          </span>
        ))}
        <span className="ml-auto text-zinc-500">
          Total <b className="tabular-nums text-zinc-800">{total}</b> actividades
        </span>
      </div>
    </div>
  );
}
const BAR: Record<ReportStatus, string> = {
  atrasada: "bg-red-600",
  sin_avance: "bg-orange-500",
  sin_registros: "bg-violet-500",
  en_riesgo: "bg-amber-400",
  al_dia: "bg-emerald-600",
  terminada: "bg-blue-600",
  por_iniciar: "bg-zinc-300",
  sin_programa: "bg-zinc-200",
};

const TONE_ICON = {
  critical: ["■", "text-red-700"],
  warning: ["▲", "text-amber-600"],
  info: ["●", "text-[#1f3a5f]"],
  good: ["✓", "text-emerald-700"],
} as const;

export function Situations({ items, empty }: { items: Situation[]; empty: string }) {
  if (!items.length) return <p className="text-zinc-600">{empty}</p>;
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex break-inside-avoid gap-3 rounded-md border border-zinc-200 px-3 py-2">
          <span aria-hidden className={cx("mt-0.5 text-base leading-none", TONE_ICON[s.tone][1])}>
            {TONE_ICON[s.tone][0]}
          </span>
          <div className="min-w-0">
            <div className="font-bold">{s.title}</div>
            {s.evidence ? (
              <div className="mt-0.5 text-[12.5px] text-zinc-700">
                <SourceTag kind="calculado" />
                {s.evidence}
              </div>
            ) : null}
            {s.action ? (
              <div className="mt-0.5 text-[12.5px] text-zinc-800">
                <SourceTag kind="recomendacion" />
                {s.action}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Observations({ items, rules }: { items: Observation[]; rules: Record<ReportStatus, string> }) {
  return (
    <div className="grid gap-5 text-[12.5px] sm:grid-cols-2 print:grid-cols-2">
      <div>
        <h3 className="mb-1 font-bold">Criterios del semáforo</h3>
        <ul className="space-y-1">
          {REPORT_STATUS_ORDER.map((s) => (
            <li key={s} className="break-inside-avoid">
              <StatusChip status={s} /> {rules[s]}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 font-bold">Cálculos y observaciones de los datos</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Avance global = suma ponderada del avance de cada actividad con cantidad y fechas programadas (cada una limitada al 100 %).</li>
          <li>Programado = reparto lineal de la cantidad en días laborables entre el inicio y el fin planeados.</li>
          <li>Desviación = real − programado, en puntos porcentuales. SPI = real ÷ programado.</li>
          <li>Ritmo = cantidad de los últimos 14 días ÷ días laborables; necesario = pendiente ÷ días laborables hasta el fin planeado.</li>
          <li>Los datos faltantes no se cuentan como cero: se muestran como «No disponible» o «No calculable».</li>
          {items.map((o, i) => (
            <li key={i} className={o.kind === "dato" ? "font-semibold text-amber-900" : undefined}>
              {o.kind === "dato" ? "Dato a revisar: " : ""}
              {o.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const th = "border-b-2 border-zinc-300 bg-zinc-100 px-1.5 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-zinc-600 align-bottom";
export const td = "border-b border-zinc-200 px-1.5 py-1 align-top";
export const num = "text-right tabular-nums whitespace-nowrap";

/** Barra mini de avance real (azul) con la marca de lo programado (naranja). */
export function MiniBar({ actual, planned }: { actual: number; planned: number }) {
  return (
    <div className="relative mt-0.5 h-1 w-full min-w-[48px] rounded-full bg-zinc-200" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-[#1f3a5f]" style={{ width: `${Math.min(100, actual * 100)}%` }} />
      <div className="absolute -top-0.5 h-2 w-0.5 bg-[#eb6834]" style={{ left: `${Math.min(100, planned * 100)}%` }} />
    </div>
  );
}

/** Firmas al final del cuerpo del informe. */
export function Signatures({ signers }: { signers: string[] }) {
  return (
    <section className="mt-12 grid break-inside-avoid grid-cols-2 gap-x-12 gap-y-12">
      {signers.map((s) => (
        <div key={s} className="border-t border-zinc-900 pt-1 text-center text-[12.5px]">
          <b className="uppercase">{s}</b>
          <div className="text-xs text-zinc-500">Nombre, firma y fecha</div>
        </div>
      ))}
    </section>
  );
}
