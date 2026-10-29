import type { ReportInput, ReportStatus } from "@avanceobra/engine";
import type { DashData } from "./dashboard";

/** Datos del tablero → entrada del análisis de informes (mismos registros, sin transformar cantidades). */
export function reportInput(data: DashData): ReportInput {
  const company = new Map(data.companies.map((c) => [c.id, c.name]));
  return {
    project: {
      id: data.project.id,
      name: data.project.name,
      startDate: data.project.startDate,
      contractEnd: data.project.contractEnd,
    },
    calendar: data.project.calendar,
    activities: data.activities.map((a) => ({
      ...a,
      front: a.frontCode || null,
      frontName: a.frontName || null,
      group: a.workGroup,
      responsible: a.companyId ? (company.get(a.companyId) ?? null) : null,
    })),
    entries: data.entries.map((e) => ({
      activityId: e.activityId,
      date: e.workDate,
      quantity: e.quantity,
      crew: e.crewSize,
      effectiveHours: e.effectiveHours,
      lostHours: e.lostHours,
      lossCause: e.lossCause,
      losses: e.losses,
      weather: e.weather,
      notes: e.notes,
    })),
    findings: data.findings.map((f) => ({
      id: f.id,
      type: f.type,
      severity: f.severity,
      status: f.status,
      description: f.description,
      createdAt: f.createdAt,
      closedAt: f.closedAt,
      dueDate: f.dueDate,
      impeditive: f.impeditive,
    })),
  };
}

/** Semáforo del informe: color + forma, para leerlo en blanco y negro y con daltonismo. */
export const STATUS_STYLE: Record<ReportStatus, { icon: string; cls: string }> = {
  atrasada: { icon: "■", cls: "bg-red-50 text-red-800 ring-red-300" },
  sin_avance: {
    icon: "◆",
    cls: "bg-orange-50 text-orange-800 ring-orange-300",
  },
  sin_registros: {
    icon: "?",
    cls: "bg-violet-50 text-violet-800 ring-violet-300",
  },
  en_riesgo: { icon: "▲", cls: "bg-amber-50 text-amber-900 ring-amber-300" },
  al_dia: {
    icon: "●",
    cls: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  },
  terminada: { icon: "✓", cls: "bg-blue-50 text-blue-800 ring-blue-300" },
  por_iniciar: { icon: "○", cls: "bg-zinc-50 text-zinc-700 ring-zinc-300" },
  sin_programa: { icon: "–", cls: "bg-zinc-50 text-zinc-600 ring-zinc-300" },
};

export const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
export const n2 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
/** Puntos porcentuales con signo; "No calculable" si no hay dato. */
export const pts = (x: number | null | undefined, digits = 1) =>
  x == null || !Number.isFinite(x) ? "No calculable" : `${x > 0 ? "+" : ""}${x.toLocaleString("es-CO", { maximumFractionDigits: digits })} pts`;
/** 2026-10-15 → 15/10/2026 */
export const dmy = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
export const longDate = (d: string) => {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString("es-CO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
