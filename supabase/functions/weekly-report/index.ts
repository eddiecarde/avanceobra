// Edge Function: informe semanal en PDF, cada lunes, de la semana anterior (lunes a domingo), por
// Telegram a residente, director y administrador; por correo también si está configurado Resend
// (RESEND_API_KEY y REPORT_EMAIL_FROM). La llama pg_cron (ver supabase/setup/08_informe_semanal.sql)
// con el encabezado x-dispatch-secret. Cuerpo opcional: { project_id, week_start, dry_run }.
// weekly_report_deliveries evita enviar dos veces la misma semana a la misma persona.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { fanOut } from "../_shared/fanout.ts";
import type { Contact } from "../_shared/alerts.ts";
import { loadBlockers } from "../_shared/blockers.ts";
import { sendEmailWithPdf, sendTelegramDocument, sendTelegramHtml } from "../_shared/channels.ts";
import { addDays, mondayOf } from "../_shared/engine.js";
import { bogotaDate, type RawDashboard } from "../_shared/report.ts";
import { buildWeekPdf, buildWeekReport, weekTelegramHtml, type WeekPlan } from "../_shared/weekly.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const ROLES = ["resident", "director", "admin"];

Deno.serve(async (req) => {
  const secret = env("DISPATCH_SECRET");
  if (!secret || req.headers.get("x-dispatch-secret") !== secret) return new Response("No autorizado", { status: 401 });
  const bot = env("TELEGRAM_BOT_TOKEN");
  const resend = env("RESEND_API_KEY");
  const from = env("REPORT_EMAIL_FROM");

  const body = (await req.json().catch(() => ({}))) as { project_id?: string; week_start?: string; dry_run?: boolean };
  // Por defecto, la semana que terminó ayer (domingo)
  const weekStart = body.week_start && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start) ? mondayOf(body.week_start) : addDays(mondayOf(bogotaDate(new Date())), -7);
  const webUrl = env("WEB_URL") || "https://avanceobra-six.vercel.app";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Sin proyecto: una llamada por proyecto (cada una con su propio cómputo)
  if (!body.project_id) return fanOut(db, req, "weekly-report", body);
  let q = db.from("projects").select("id, name");
  if (body.project_id) q = q.eq("id", body.project_id);
  const { data: projects, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const summary: Record<string, unknown>[] = [];
  for (const p of projects ?? []) {
    const { data: contacts } = await db.rpc("alert_member_contacts", { p_project: p.id });
    const people = ((contacts ?? []) as Contact[]).filter((c) => ROLES.includes(c.role) && (c.telegram_chat_id || (resend && from && c.email)));
    if (!people.length) {
      summary.push({ project: p.name, skipped: "nadie con Telegram o correo (residente, director o admin)" });
      continue;
    }
    const { data: done } = await db.from("weekly_report_deliveries").select("user_id, channel").eq("project_id", p.id).eq("week_start", weekStart).eq("status", "sent");
    const already = new Set((done ?? []).map((d) => `${d.user_id}:${d.channel}`));

    const { data: raw, error: e2 } = await db.rpc("dashboard_json", { p_project: p.id });
    if (e2) {
      summary.push({ project: p.name, error: e2.message });
      continue;
    }
    // Cumplimiento del plan semanal de esa semana (si se cerró)
    const { data: plan } = await db.from("weekly_plans").select("id, status").eq("project_id", p.id).eq("week_start", weekStart).maybeSingle();
    let weekPlan: WeekPlan | null = null;
    if (plan?.status === "cerrado") {
      const { data: items } = await db.from("weekly_plan_items").select("done, failure_cause").eq("plan_id", plan.id);
      const list = (items ?? []) as { done: boolean | null; failure_cause: string | null }[];
      const causes = new Map<string, number>();
      list.filter((i) => i.done === false).forEach((i) => causes.set(i.failure_cause ?? "other", (causes.get(i.failure_cause ?? "other") ?? 0) + 1));
      weekPlan = { committed: list.length, done: list.filter((i) => i.done).length, causes: [...causes.entries()].map(([cause, count]) => ({ cause, count })) };
    }
    const report = buildWeekReport(raw as RawDashboard, weekStart, { plan: weekPlan, blockers: await loadBlockers(db, p.id, raw as RawDashboard, weekStart) });
    const html = weekTelegramHtml(report, webUrl);
    const pdf = await buildWeekPdf(report);
    const filename = `informe-semanal-${weekStart}.pdf`;
    if (body.dry_run) {
      summary.push({ project: p.name, dry_run: true, week: weekStart, recipients: people.map((c) => c.member_name), pdf_bytes: pdf.length, message: html });
      continue;
    }

    let sent = 0;
    for (const c of people) {
      const channels: ("telegram" | "email")[] = [];
      if (c.telegram_chat_id && bot) channels.push("telegram");
      if (resend && from && c.email) channels.push("email");
      for (const ch of channels) {
        if (already.has(`${c.user_id}:${ch}`)) continue;
        let r;
        if (ch === "telegram") {
          r = await sendTelegramHtml(bot, c.telegram_chat_id!, html);
          if (r.ok) r = await sendTelegramDocument(bot, c.telegram_chat_id!, pdf, filename, `Informe semanal ${p.name} · ${weekStart}`);
        } else {
          r = await sendEmailWithPdf(resend, from, c.email!, `Informe semanal ${p.name} · semana del ${weekStart}`, html.replace(/\n/g, "<br>"), pdf, filename);
        }
        await db.from("weekly_report_deliveries").upsert(
          { project_id: p.id, week_start: weekStart, user_id: c.user_id, channel: ch, status: r.ok ? "sent" : "failed", error: r.error ?? null, sent_at: new Date().toISOString() },
          { onConflict: "project_id,week_start,user_id,channel" },
        );
        if (r.ok) sent++;
      }
    }
    summary.push({ project: p.name, week: weekStart, sent });
  }
  return Response.json({ week: weekStart, projects: summary });
});
