"use client";

import type { ReportActivityRow } from "@avanceobra/engine";
import { useState } from "react";
import { cx } from "@/components/ui";
import { pct } from "@/lib/dashboard";
import { dmy, n1, pts } from "@/lib/report";
import { MiniBar, num, SourceTag, StatusChip, td, th } from "./ReportKit";

function rate(r: ReportActivityRow) {
  if (r.requiredRate == null) return `${n1(r.dailyRate)} / —`;
  return `${n1(r.dailyRate)} / ${Number.isFinite(r.requiredRate) ? n1(r.requiredRate) : "vencida"}`;
}

/** Prioridades: cada actividad con su dato y, debajo, la acción recomendada. */
export function PriorityTable({ rows }: { rows: ReportActivityRow[] }) {
  const responsible = rows.some((r) => r.responsible);
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={th}>Actividad</th>
          <th className={`${th} w-28 text-right`}>Real / prog.</th>
          <th className={`${th} text-right`}>Desv.</th>
          <th className={`${th} text-right`}>Pendiente</th>
          <th className={`${th} text-right`}>Ritmo / necesario (u/día)</th>
          <th className={`${th} text-right`}>Último registro</th>
          <th className={th}>Estado</th>
        </tr>
      </thead>
      {rows.map((r) => (
        <tbody key={r.id} className="break-inside-avoid">
          <tr>
            <td className={cx(td, "border-b-0")}>
              <b>{r.code}</b> · {r.name}
              <div className="text-[11px] text-zinc-500">
                {[r.front ? (r.frontName ? `${r.front} · ${r.frontName}` : r.front) : null, r.group, responsible ? `Responsable: ${r.responsible ?? "no registrado"}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </td>
            <td className={cx(td, num, "border-b-0")}>
              {pct(r.actualPct, 0)} / {pct(r.plannedPct, 0)}
              <MiniBar actual={r.actualPct} planned={r.plannedPct} />
            </td>
            <td className={cx(td, num, "border-b-0 font-bold", r.gapPts <= -15 ? "text-red-700" : r.gapPts <= -5 ? "text-amber-700" : "")}>{pts(r.gapPts, 0)}</td>
            <td className={cx(td, num, "border-b-0")}>
              {n1(r.pendingQty)} {r.unit}
            </td>
            <td className={cx(td, num, "border-b-0")}>{rate(r)}</td>
            <td className={cx(td, num, "border-b-0")}>{r.lastUpdate ? dmy(r.lastUpdate) : "Nunca"}</td>
            <td className={cx(td, "border-b-0")}>
              <StatusChip status={r.status} />
            </td>
          </tr>
          {r.action ? (
            <tr>
              <td colSpan={7} className={cx(td, "pb-1.5 pt-0 text-[12px] text-zinc-700")}>
                <SourceTag kind="recomendacion" />
                {r.action}
              </td>
            </tr>
          ) : null}
        </tbody>
      ))}
    </table>
  );
}

/** Más de esto, el anexo muestra por defecto solo lo pendiente. */
const BIG = 300;

/** Anexo: todas las actividades, agrupadas por grupo de trabajo o frente, primero las que requieren atención. */
export function FullTable({ rows: all, grouped }: { rows: ReportActivityRow[]; grouped: boolean }) {
  // Obras muy grandes: por defecto solo lo pendiente (terminadas y por iniciar se cuentan); un clic muestra todo
  const [showAll, setShowAll] = useState(false);
  const big = all.length > BIG;
  const rows = big && !showAll ? all.filter((r) => r.status !== "terminada" && r.status !== "por_iniciar") : all;
  const groups = new Map<string, ReportActivityRow[]>();
  for (const r of rows) {
    const k = (grouped ? r.group : r.front ? (r.frontName ? `${r.front} · ${r.frontName}` : r.front) : null) ?? "Sin frente";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const ORDER = ["atrasada", "sin_avance", "sin_registros", "en_riesgo", "al_dia", "por_iniciar", "sin_programa", "terminada"];
  const responsible = rows.some((r) => r.responsible);
  const cols = responsible ? 10 : 9;
  return (
    <>
      {big ? (
        <p className="mb-1.5 text-xs text-zinc-600">
          {showAll
            ? `Se muestran las ${all.length} actividades.`
            : `Obra con ${all.length} actividades: se listan las ${rows.length} que no están terminadas ni por iniciar (${all.length - rows.length} omitidas).`}{" "}
          <button type="button" className="no-print font-semibold text-blue-700 underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Ver solo las pendientes" : "Ver todas"}
          </button>
        </p>
      ) : null}
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            <th className={th}>Código</th>
            <th className={th}>Descripción</th>
            <th className={`${th} text-right`}>Real</th>
            <th className={`${th} text-right`}>Prog.</th>
            <th className={`${th} text-right`}>Desv.</th>
            <th className={`${th} text-right`}>Ejecutado</th>
            <th className={`${th} text-right`}>Pendiente</th>
            <th className={th}>Estado</th>
            <th className={`${th} text-right`}>Últ. registro</th>
            {responsible ? <th className={th}>Responsable</th> : null}
          </tr>
        </thead>
        {[...groups.entries()]
          .sort((x, y) => x[0].localeCompare(y[0]))
          .map(([g, list]) => (
            <tbody key={g}>
              <tr className="break-after-avoid">
                <td colSpan={cols} className="border-b border-zinc-300 bg-[#eef2f7] px-1.5 py-1 text-[11.5px] font-bold text-[#1f3a5f]">
                  {g}{" "}
                  <span className="font-normal text-zinc-600">
                    · {list.length} actividad(es) · {list.filter((r) => r.status === "atrasada").length} atrasada(s)
                  </span>
                </td>
              </tr>
              {[...list]
                .sort((x, y) => ORDER.indexOf(x.status) - ORDER.indexOf(y.status) || x.code.localeCompare(y.code))
                .map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap font-semibold`}>{r.code}</td>
                    <td className={td}>{r.name}</td>
                    <td className={`${td} ${num}`}>{pct(r.actualPct, 0)}</td>
                    <td className={`${td} ${num}`}>{r.plannedStart ? pct(r.plannedPct, 0) : "—"}</td>
                    <td className={cx(td, num, r.gapPts <= -15 && r.plannedStart ? "font-bold text-red-700" : "")}>{r.plannedStart ? pts(r.gapPts, 0) : "—"}</td>
                    <td className={`${td} ${num}`}>
                      {n1(r.executedQty)} {r.unit}
                    </td>
                    <td className={`${td} ${num}`}>{n1(r.pendingQty)}</td>
                    <td className={td}>
                      <StatusChip status={r.status} />
                    </td>
                    <td className={`${td} ${num}`}>{r.lastUpdate ? dmy(r.lastUpdate) : "—"}</td>
                    {responsible ? <td className={td}>{r.responsible ?? "—"}</td> : null}
                  </tr>
                ))}
            </tbody>
          ))}
      </table>
    </>
  );
}
