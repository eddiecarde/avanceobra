// Edge Function: resumen de la noche por Telegram (lo hecho hoy, lo atrasado y lo que bloquea) con el
// informe diario completo en PDF, a residente, director y administrador.
// La llama pg_cron a las 6:00 p. m. de Colombia, lunes a sábado (ver supabase/setup/05_informe_diario.sql),
// con el encabezado x-dispatch-secret. Cuerpo opcional: { project_id, date, dry_run }.
// daily_report_deliveries evita enviar dos veces el mismo informe a la misma persona.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { fanOut } from "../_shared/fanout.ts";
import type { Contact } from "../_shared/alerts.ts";
import { sendTelegramDocument, sendTelegramHtml } from "../_shared/channels.ts";
import { loadBlockers } from "../_shared/blockers.ts";
import { addDays, summarizeDailyLogs } from "../_shared/engine.js";
import { bogotaDate, buildDailyReport, nightSummaryHtml, type RawDashboard } from "../_shared/report.ts";
import { buildReportPdf } from "../_shared/report_pdf.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
export const REPORT_ROLES = ["resident", "director", "admin"];

Deno.serve(async (req) => {
  const secret = env("DISPATCH_SECRET");
  if (!secret || req.headers.get("x-dispatch-secret") !== secret) return new Response("No autorizado", { status: 401 });
  const bot = env("TELEGRAM_BOT_TOKEN");
  if (!bot) return Response.json({ error: "Falta TELEGRAM_BOT_TOKEN" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { project_id?: string; date?: string; dry_run?: boolean };
  const day = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : bogotaDate(new Date());
  const webUrl = env("WEB_URL") || "https://avanceobra-six.vercel.app";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Sin proyecto: una llamada por proyecto (cada una con su propio cómputo)
  if (!body.project_id) return fanOut(db, req, "daily-report", body);
  let q = db.from("projects").select("id, name").eq("suspended", false);
  if (body.project_id) q = q.eq("id", body.project_id);
  const { data: projects, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const summary: Record<string, unknown>[] = [];
  for (const p of projects ?? []) {
    const { data: contacts } = await db.rpc("alert_member_contacts", { p_project: p.id });
    const recipients = ((contacts ?? []) as Contact[]).filter((c) => REPORT_ROLES.includes(c.role) && c.telegram_chat_id);
    if (!recipients.length) {
      summary.push({ project: p.name, skipped: "nadie con Telegram vinculado (residente, director o admin)" });
      continue;
    }
    const { data: done } = await db.from("daily_report_deliveries").select("user_id").eq("project_id", p.id).eq("report_date", day).eq("status", "sent");
    const already = new Set((done ?? []).map((d) => d.user_id));
    const pending = recipients.filter((c) => !already.has(c.user_id));
    if (!pending.length) {
      summary.push({ project: p.name, skipped: "ya enviado hoy" });
      continue;
    }

    const { data: raw, error: e2 } = await db.rpc("dashboard_json", { p_project: p.id });
    if (e2) {
      summary.push({ project: p.name, error: e2.message });
      continue;
    }
    const report = buildDailyReport(raw as RawDashboard, day);
    // Personal y equipos del parte diario (si se envió), para el resumen del PDF
    const { data: logs } = await db.from("daily_log_latest").select("log_date, personnel, equipment, rain, observations").eq("project_id", p.id).eq("log_date", day);
    const log = summarizeDailyLogs(
      ((logs ?? []) as { log_date: string; personnel: { role: string; qty: number }[]; equipment: { name: string; qty: number }[]; rain: { start: string; end: string }[]; observations: string }[]).map((x) => ({
        date: x.log_date,
        personnel: x.personnel ?? [],
        equipment: x.equipment ?? [],
        rain: x.rain ?? [],
        observations: x.observations,
      })),
    ).get(day);
    report.dayLog = log ? { personnel: log.totalPersonnel, equipment: Object.values(log.equipment).reduce((s, n) => s + n, 0) } : null;
    const html = nightSummaryHtml(report, await loadBlockers(db, p.id, raw as RawDashboard, addDays(day, -1)), webUrl);
    const pdf = await buildReportPdf(report);
    if (body.dry_run) {
      summary.push({ project: p.name, dry_run: true, recipients: pending.map((c) => c.member_name), pdf_bytes: pdf.length, message: html });
      continue;
    }

    let sent = 0;
    for (const c of pending) {
      let r = await sendTelegramHtml(bot, c.telegram_chat_id!, html);
      if (r.ok) r = await sendTelegramDocument(bot, c.telegram_chat_id!, pdf, `informe-${day}.pdf`, `Informe diario ${p.name} · ${day}`);
      await db.from("daily_report_deliveries").upsert(
        { project_id: p.id, report_date: day, user_id: c.user_id, channel: "telegram", status: r.ok ? "sent" : "failed", error: r.error ?? null, sent_at: new Date().toISOString() },
        { onConflict: "project_id,report_date,user_id,channel" },
      );
      if (r.ok) sent++;
    }
    summary.push({ project: p.name, day, sent, failed: pending.length - sent });
  }
  return Response.json({ day, projects: summary });
});
