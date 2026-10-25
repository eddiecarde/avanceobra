// Edge Function: despacha las alertas pendientes por push, Telegram, correo y WhatsApp.
// La llama pg_cron cada minuto (ver supabase/setup/04_alertas.sql) con el encabezado
// x-dispatch-secret. Los canales sin credenciales se omiten sin error.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { channelsFor, formatAlert, MAX_DISPATCH_ATTEMPTS, recipientsFor, type AlertRow, type Channel, type Contact } from "../_shared/alerts.ts";
import { sendEmail, sendExpoPush, sendTelegram, sendWhatsApp, type SendResult } from "../_shared/channels.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

Deno.serve(async (req) => {
  const secret = env("DISPATCH_SECRET");
  if (!secret || req.headers.get("x-dispatch-secret") !== secret) return new Response("No autorizado", { status: 401 });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const cfg = {
    push: true,
    telegram: Boolean(env("TELEGRAM_BOT_TOKEN")),
    email: Boolean(env("RESEND_API_KEY") && env("EMAIL_FROM")),
    whatsapp: Boolean(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")),
  };

  const { data: alerts, error } = await db
    .from("alerts")
    .select("id, project_id, kind, severity, title, body, ref_table, ref_id, created_at, dispatch_attempts")
    .is("dispatched_at", null)
    .lt("dispatch_attempts", MAX_DISPATCH_ATTEMPTS)
    .order("created_at")
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const contactsByProject = new Map<string, Contact[]>();
  const projectNames = new Map<string, string>();
  const summary = { alerts: alerts?.length ?? 0, sent: 0, failed: 0 };

  for (const a of (alerts ?? []) as (AlertRow & { dispatch_attempts: number })[]) {
    if (!contactsByProject.has(a.project_id)) {
      const [{ data: contacts }, { data: project }] = await Promise.all([
        db.rpc("alert_member_contacts", { p_project: a.project_id }),
        db.from("projects").select("name").eq("id", a.project_id).single(),
      ]);
      contactsByProject.set(a.project_id, (contacts ?? []) as Contact[]);
      projectNames.set(a.project_id, project?.name ?? "Proyecto");
    }
    let responsible: string | null = null;
    if (a.ref_table === "findings" && a.ref_id) {
      const { data: f } = await db.from("findings").select("responsible_user_id").eq("id", a.ref_id).maybeSingle();
      responsible = f?.responsible_user_id ?? null;
    }

    const { data: done } = await db.from("alert_deliveries").select("user_id, channel").eq("alert_id", a.id).eq("status", "sent");
    const already = new Set((done ?? []).map((d) => `${d.user_id}:${d.channel}`));
    const msg = formatAlert(a, projectNames.get(a.project_id)!);
    let failures = 0;

    for (const c of recipientsFor(a, contactsByProject.get(a.project_id)!, responsible)) {
      for (const ch of channelsFor(a, c, cfg)) {
        if (already.has(`${c.user_id}:${ch}`)) continue;
        const r = await send(ch, c, msg, { alertId: a.id, kind: a.kind, refId: a.ref_id });
        await db.from("alert_deliveries").upsert(
          { alert_id: a.id, user_id: c.user_id, channel: ch, status: r.ok ? "sent" : "failed", error: r.error ?? null },
          { onConflict: "alert_id,user_id,channel" },
        );
        if (r.ok) summary.sent++;
        else {
          summary.failed++;
          failures++;
        }
      }
    }

    const attempts = a.dispatch_attempts + 1;
    await db
      .from("alerts")
      .update({
        dispatch_attempts: attempts,
        // Sin fallas, o agotados los reintentos: se da por despachada.
        dispatched_at: failures === 0 || attempts >= MAX_DISPATCH_ATTEMPTS ? new Date().toISOString() : null,
      })
      .eq("id", a.id);
  }

  return Response.json(summary);
});

function send(ch: Channel, c: Contact, msg: ReturnType<typeof formatAlert>, data: Record<string, unknown>): Promise<SendResult> {
  switch (ch) {
    case "push":
      return sendExpoPush(c.push_tokens, msg, data);
    case "telegram":
      return sendTelegram(env("TELEGRAM_BOT_TOKEN"), c.telegram_chat_id!, msg);
    case "email":
      return sendEmail(env("RESEND_API_KEY"), env("EMAIL_FROM"), c.email!, msg);
    case "whatsapp":
      return sendWhatsApp(env("WHATSAPP_TOKEN"), env("WHATSAPP_PHONE_NUMBER_ID"), env("WHATSAPP_TEMPLATE") || "alerta_obra", c.phone!, msg);
  }
}
