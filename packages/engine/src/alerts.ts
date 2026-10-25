/**
 * Reglas de alerta evaluadas localmente en el dispositivo al guardar (y en el servidor
 * con pg_cron). Son funciones puras: reciben datos y devuelven alertas a encolar.
 */

export type AlertKind =
  | "critical_finding"
  | "due_soon"
  | "overdue"
  | "low_rate"
  | "no_report"
  | "stale_sync"
  | "late_projection";

export interface Alert {
  kind: AlertKind;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  body: string;
  refId?: string;
}

export function findingAlerts(
  f: { id: string; severity: string; status: string; description: string; dueDate: string | null },
  today: string,
  dueSoonDays = 2,
): Alert[] {
  const out: Alert[] = [];
  if (f.status === "closed") return out;
  if (f.severity === "critical")
    out.push({ kind: "critical_finding", severity: "critical", title: "Hallazgo crítico", body: f.description, refId: f.id });
  if (f.dueDate) {
    const days = Math.round((Date.parse(f.dueDate) - Date.parse(today)) / 86_400_000);
    if (days < 0)
      out.push({ kind: "overdue", severity: "high", title: "Pendiente vencido", body: `Venció hace ${-days} días: ${f.description}`, refId: f.id });
    else if (days <= dueSoonDays)
      out.push({ kind: "due_soon", severity: "medium", title: "Pendiente por vencer", body: `Vence en ${days} días: ${f.description}`, refId: f.id });
  }
  return out;
}

export function rateAlert(
  activityName: string,
  todayRate: number,
  historicalMean: number,
  requiredRate: number,
  tolerance = 0.8,
): Alert | null {
  const ref = Math.max(historicalMean, requiredRate);
  if (ref <= 0 || todayRate >= ref * tolerance) return null;
  const which = requiredRate >= historicalMean ? "requerido" : "promedio";
  return {
    kind: "low_rate",
    severity: todayRate < ref * 0.5 ? "high" : "medium",
    title: "Rendimiento bajo",
    body: `${activityName}: ${todayRate.toFixed(1)}/día, ${((todayRate / ref) * 100).toFixed(0)} % del ${which} (${ref.toFixed(1)}/día).`,
  };
}

export function noReportAlerts(fronts: { id: string; name: string; lastReportDate: string | null }[], today: string): Alert[] {
  return fronts
    .filter((f) => f.lastReportDate !== today)
    .map((f) => ({ kind: "no_report" as const, severity: "medium" as const, title: "Frente sin reporte", body: `${f.name} no tiene reporte hoy.`, refId: f.id }));
}

export function staleSyncAlert(oldestPendingAt: string | null, now: string, maxHours = 12): Alert | null {
  if (!oldestPendingAt) return null;
  const hours = (Date.parse(now) - Date.parse(oldestPendingAt)) / 3_600_000;
  if (hours <= maxHours) return null;
  return {
    kind: "stale_sync",
    severity: "high",
    title: "Registros sin sincronizar",
    body: `Hay registros pendientes de sincronizar desde hace ${Math.floor(hours)} horas.`,
  };
}

export function lateProjectionAlert(activityName: string, delayDays: number | null, finishDate: string | null): Alert | null {
  if (delayDays === null || delayDays <= 0) return null;
  return {
    kind: "late_projection",
    severity: delayDays > 15 ? "critical" : delayDays > 5 ? "high" : "medium",
    title: "Proyección supera la fecha contractual",
    body: `${activityName} termina el ${finishDate}, ${delayDays} días tarde.`,
  };
}
