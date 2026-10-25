/**
 * Reglas de despacho de alertas: a quién, por qué canal y con qué texto.
 * Módulo puro (sin Deno ni red) para probarlo con Vitest y usarlo en la Edge Function.
 */

export type Role = "field" | "resident" | "director" | "admin";
export type Severity = "low" | "medium" | "high" | "critical";
export type Channel = "push" | "telegram" | "email" | "whatsapp";

export interface AlertRow {
  id: string;
  project_id: string;
  kind: string;
  severity: Severity;
  title: string;
  body: string;
  ref_table: string | null;
  ref_id: string | null;
  created_at: string;
}

export interface Contact {
  user_id: string;
  role: Role;
  member_name: string;
  email: string | null;
  phone: string | null;
  telegram_chat_id: string | null;
  whatsapp_opt_in: boolean;
  push_tokens: string[];
}

/** Roles que reciben cada tipo de alerta. El responsable del hallazgo se agrega aparte. */
export const ROUTING: Record<string, Role[]> = {
  critical_finding: ["resident", "director", "admin"],
  late_projection: ["resident", "director", "admin"],
  low_rate: ["resident", "admin"],
  no_report: ["field", "resident"],
  overdue: ["resident"],
  due_soon: [],
  stale_sync: ["resident"],
};
const DEFAULT_ROLES: Role[] = ["resident", "admin"];

export function recipientsFor(alert: AlertRow, contacts: Contact[], responsibleId: string | null = null): Contact[] {
  const roles = new Set(ROUTING[alert.kind] ?? DEFAULT_ROLES);
  // Un vencido crítico también sube al director.
  if (alert.kind === "overdue" && alert.severity === "critical") roles.add("director");
  const out = contacts.filter((c) => roles.has(c.role) || (responsibleId !== null && c.user_id === responsibleId));
  // Si nadie quedó (p. ej. pendiente sin responsable), avisa al residente o al admin.
  if (out.length === 0) return contacts.filter((c) => c.role === "resident" || c.role === "admin");
  return out;
}

export interface ChannelConfig {
  push: boolean;
  telegram: boolean;
  email: boolean;
  whatsapp: boolean;
}

/**
 * Canales por destinatario: push y Telegram para todo; correo para alta/crítica;
 * WhatsApp solo para crítica y si la persona lo aceptó. Solo canales configurados.
 */
export function channelsFor(alert: AlertRow, c: Contact, cfg: ChannelConfig): Channel[] {
  const out: Channel[] = [];
  if (cfg.push && c.push_tokens.length > 0) out.push("push");
  if (cfg.telegram && c.telegram_chat_id) out.push("telegram");
  if (cfg.email && c.email && (alert.severity === "high" || alert.severity === "critical")) out.push("email");
  if (cfg.whatsapp && c.whatsapp_opt_in && c.phone && alert.severity === "critical") out.push("whatsapp");
  return out;
}

const ICON: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };
const SEVERITY_ES: Record<Severity, string> = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };

export function formatTime(iso: string, timeZone = "America/Bogota"): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Message {
  title: string;
  text: string;
  /** Texto con formato HTML de Telegram. */
  telegramHtml: string;
  emailSubject: string;
  emailHtml: string;
}

export function formatAlert(alert: AlertRow, projectName: string): Message {
  const icon = ICON[alert.severity];
  const when = formatTime(alert.created_at);
  const title = `${icon} ${alert.title}`;
  const text = `${alert.body}\n${projectName} · ${when}`;
  return {
    title,
    text,
    telegramHtml:
      `<b>${escapeHtml(title)}</b>\n${escapeHtml(alert.body)}\n` +
      `<i>${escapeHtml(projectName)} · ${escapeHtml(when)} · Severidad ${SEVERITY_ES[alert.severity]}</i>`,
    emailSubject: `[AvanceObra] ${SEVERITY_ES[alert.severity]}: ${alert.title} — ${projectName}`,
    emailHtml:
      `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">` +
      `<h2 style="margin:0 0 8px">${icon} ${escapeHtml(alert.title)}</h2>` +
      `<p style="margin:0 0 12px">${escapeHtml(alert.body)}</p>` +
      `<p style="color:#555;margin:0">${escapeHtml(projectName)} · ${escapeHtml(when)} · Severidad ${SEVERITY_ES[alert.severity]}</p>` +
      `<p style="color:#888;font-size:12px;margin-top:16px">Enviado automáticamente por AvanceObra.</p></div>`,
  };
}

/** Un mensaje de Telegram del tipo "/start CODIGO" para vincular la cuenta. */
export function parseStartCommand(text: string | undefined): string | null {
  const m = /^\/start\s+([0-9A-F]{10})\s*$/i.exec(text ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

/** Tras 5 intentos fallidos se deja de reintentar (queda registrado en alert_deliveries). */
export const MAX_DISPATCH_ATTEMPTS = 5;
