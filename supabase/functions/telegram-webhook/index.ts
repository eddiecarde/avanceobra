// Edge Function: webhook del bot de Telegram. Vincula la cuenta cuando el usuario abre
// t.me/<bot>?start=<código> desde la app (el código lo genera create_telegram_link_code()).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseStartCommand } from "../_shared/alerts.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

async function reply(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

Deno.serve(async (req) => {
  // Telegram envía el secreto configurado en setWebhook; así nadie más puede llamar al webhook.
  if (req.headers.get("x-telegram-bot-api-secret-token") !== env("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("No autorizado", { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const message = update?.message;
  const chatId: number | undefined = message?.chat?.id;
  if (!chatId) return new Response("ok");

  const code = parseStartCommand(message.text);
  if (!code) {
    await reply(chatId, "Hola 👷. Para recibir alertas de obra, abre AvanceObra → Sincronía → «Vincular Telegram».");
    return new Response("ok");
  }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data, error } = await db
    .from("profiles")
    .update({ telegram_chat_id: String(chatId), telegram_link_code: null })
    .eq("telegram_link_code", code)
    .select("full_name");

  if (error || !data?.length) {
    await reply(chatId, "Ese código ya se usó o no es válido. Genera uno nuevo desde la app.");
  } else {
    await reply(chatId, `✅ Listo${data[0]!.full_name ? `, ${data[0]!.full_name}` : ""}. Desde ahora recibirás aquí las alertas de obra.`);
  }
  return new Response("ok");
});
