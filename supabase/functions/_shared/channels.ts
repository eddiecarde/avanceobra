/**
 * Envío por cada canal. Reciben la configuración por parámetro (no leen Deno.env) para
 * poder probarlos con un fetch simulado. Cada uno devuelve { ok, error }.
 */
import type { Message } from "./alerts.ts";

export interface SendResult {
  ok: boolean;
  error?: string;
}

type Fetch = typeof fetch;

async function check(res: Response): Promise<SendResult> {
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
}

/** Expo Push: llega aunque la app esté cerrada (Android requiere FCM configurado en Expo). */
export async function sendExpoPush(tokens: string[], m: Message, data: Record<string, unknown>, f: Fetch = fetch): Promise<SendResult> {
  const res = await f("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(tokens.map((to) => ({ to, title: m.title, body: m.text, data, sound: "default", channelId: "alertas", priority: "high" }))),
  });
  if (!res.ok) return check(res);
  const json = (await res.json()) as { data?: { status: string; message?: string }[] };
  const errors = (json.data ?? []).filter((t) => t.status !== "ok").map((t) => t.message ?? t.status);
  return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true };
}

export async function sendTelegram(botToken: string, chatId: string, m: Message, f: Fetch = fetch): Promise<SendResult> {
  const res = await f(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: m.telegramHtml, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return check(res);
}

export async function sendEmail(apiKey: string, from: string, to: string, m: Message, f: Fetch = fetch): Promise<SendResult> {
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [to], subject: m.emailSubject, html: m.emailHtml }),
  });
  return check(res);
}

/**
 * WhatsApp Cloud API. Los mensajes iniciados por la empresa exigen una plantilla aprobada
 * por Meta; se usa una plantilla "alerta_obra" con dos variables: título y detalle.
 */
export async function sendWhatsApp(
  token: string,
  phoneNumberId: string,
  template: string,
  to: string,
  m: Message,
  f: Fetch = fetch,
): Promise<SendResult> {
  const res = await f(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/[^\d]/g, ""),
      type: "template",
      template: {
        name: template,
        language: { code: "es" },
        components: [{ type: "body", parameters: [{ type: "text", text: m.title.slice(0, 60) }, { type: "text", text: m.text.slice(0, 900) }] }],
      },
    }),
  });
  return check(res);
}

/** Telegram: texto HTML libre (sin el formato de alerta), p. ej. el resumen del informe diario. */
export async function sendTelegramHtml(botToken: string, chatId: string, html: string, f: Fetch = fetch): Promise<SendResult> {
  const res = await f(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return check(res);
}

/** Telegram: archivo adjunto (PDF del informe) con multipart/form-data. */
export async function sendTelegramDocument(botToken: string, chatId: string, file: Uint8Array, filename: string, caption: string, f: Fetch = fetch): Promise<SendResult> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1000));
  form.append("document", new Blob([file], { type: "application/pdf" }), filename);
  const res = await f(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: form });
  return check(res);
}

/** Correo con un PDF adjunto (Resend): el informe semanal para quien lo pida por correo. */
export async function sendEmailWithPdf(apiKey: string, from: string, to: string, subject: string, html: string, file: Uint8Array, filename: string, f: Fetch = fetch): Promise<SendResult> {
  let bin = "";
  for (let i = 0; i < file.length; i += 0x8000) bin += String.fromCharCode(...file.subarray(i, i + 0x8000));
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [to], subject, html, attachments: [{ filename, content: btoa(bin) }] }),
  });
  return check(res);
}
