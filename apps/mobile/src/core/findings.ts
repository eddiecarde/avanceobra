import { FINDING_TRANSITIONS, type FindingStatus, type Role, type Severity } from "@avanceobra/shared";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_LABEL: Record<Severity, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Abierto",
  in_correction: "En corrección",
  to_review: "Por revisar",
  closed: "Cerrado",
};
export type FindingCategory = "observacion" | "no_conformidad" | "punch";
export const CATEGORY_LABEL: Record<FindingCategory, string> = { observacion: "Observación", no_conformidad: "No conformidad", punch: "Punch list" };

export const TYPE_LABEL: Record<string, string> = {
  quality: "Calidad",
  safety: "Seguridad",
  environment: "Ambiente",
  operation: "Operación",
};

export interface FindingLike {
  id: string;
  severity: Severity;
  status: FindingStatus;
  type: string;
  front_id: string | null;
  responsible_user_id: string | null;
  due_date: string | null;
  created_at: string;
}

export interface FindingFilter {
  severities?: Severity[];
  statuses?: FindingStatus[];
  frontId?: string | null;
  responsibleId?: string | null;
  /** Solo los abiertos con más de N días. */
  minAgeDays?: number;
  overdueOnly?: boolean;
}

export function ageDays(createdAt: string, today: string): number {
  return Math.max(0, Math.floor((Date.parse(today) - Date.parse(createdAt.slice(0, 10))) / 86_400_000));
}

export function isOverdue(f: Pick<FindingLike, "due_date" | "status">, today: string): boolean {
  return f.status !== "closed" && !!f.due_date && f.due_date < today;
}

/** Lista de "Puntos pendientes de revisión": filtra y ordena por severidad, vencimiento y antigüedad. */
export function filterFindings<T extends FindingLike>(list: T[], filter: FindingFilter, today: string): T[] {
  return list
    .filter((f) => !filter.severities?.length || filter.severities.includes(f.severity))
    .filter((f) => (filter.statuses?.length ? filter.statuses.includes(f.status) : f.status !== "closed"))
    .filter((f) => !filter.frontId || f.front_id === filter.frontId)
    .filter((f) => !filter.responsibleId || f.responsible_user_id === filter.responsibleId)
    .filter((f) => filter.minAgeDays === undefined || ageDays(f.created_at, today) >= filter.minAgeDays)
    .filter((f) => !filter.overdueOnly || isOverdue(f, today))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        a.created_at.localeCompare(b.created_at),
    );
}

/** Transiciones que el usuario puede ejecutar según su rol (cerrar = residente, director o administrador, como el servidor). */
export function allowedTransitions(status: FindingStatus, role: Role): FindingStatus[] {
  return FINDING_TRANSITIONS[status].filter((to) => to !== "closed" || role === "resident" || role === "director" || role === "admin");
}

/**
 * Al cerrar se pide siempre la nota de verificación: el servidor la exige para no conformidades y
 * punch, y el teléfono puede no saber la categoría sin señal. Devuelve el error o null.
 */
export function closeNoteError(note: string): string | null {
  return note.trim().length < 5 ? "Describe qué se revisó y cómo quedó (al menos 5 letras)." : null;
}
