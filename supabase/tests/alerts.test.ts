import { describe, expect, it } from "vitest";
import { channelsFor, formatAlert, parseStartCommand, recipientsFor, type AlertRow, type Contact } from "../functions/_shared/alerts.ts";
import { sendEmail, sendExpoPush, sendTelegram, sendWhatsApp } from "../functions/_shared/channels.ts";

const contact = (user_id: string, role: Contact["role"], extra: Partial<Contact> = {}): Contact => ({
  user_id,
  role,
  member_name: user_id,
  email: `${user_id}@demo.co`,
  phone: null,
  telegram_chat_id: null,
  whatsapp_opt_in: false,
  push_tokens: [],
  ...extra,
});

const team = [
  contact("campo", "field"),
  contact("campo2", "field"),
  contact("residente", "resident", { telegram_chat_id: "111" }),
  contact("director", "director", { push_tokens: ["ExponentPushToken[abc]"], phone: "+57 300 000 0000", whatsapp_opt_in: true }),
  contact("admin", "admin"),
];

const alert = (kind: string, severity: AlertRow["severity"] = "medium"): AlertRow => ({
  id: "a1",
  project_id: "p1",
  kind,
  severity,
  title: "Hallazgo crítico",
  body: "Zanja sin señalización <tramo sur>",
  ref_table: "findings",
  ref_id: "f1",
  created_at: "2026-10-16T15:30:00Z",
});

describe("a quién se envía cada alerta", () => {
  const ids = (cs: Contact[]) => cs.map((c) => c.user_id).sort();

  it("hallazgo crítico: residente, director y admin + el responsable", () => {
    expect(ids(recipientsFor(alert("critical_finding", "critical"), team, "campo"))).toEqual(["admin", "campo", "director", "residente"]);
  });
  it("frente sin reporte: supervisores y residente", () => {
    expect(ids(recipientsFor(alert("no_report"), team))).toEqual(["campo", "campo2", "residente"]);
  });
  it("por vencer: solo el responsable; sin responsable, residente y admin", () => {
    expect(ids(recipientsFor(alert("due_soon"), team, "campo2"))).toEqual(["campo2"]);
    expect(ids(recipientsFor(alert("due_soon"), team, null))).toEqual(["admin", "residente"]);
  });
  it("vencido crítico sube al director", () => {
    expect(ids(recipientsFor(alert("overdue", "critical"), team, "campo"))).toEqual(["campo", "director", "residente"]);
    expect(ids(recipientsFor(alert("overdue", "high"), team, "campo"))).toEqual(["campo", "residente"]);
  });
});

describe("por qué canal", () => {
  const all = { push: true, telegram: true, email: true, whatsapp: true };
  it("según severidad, datos de contacto y canales configurados", () => {
    const director = team[3]!;
    expect(channelsFor(alert("critical_finding", "critical"), director, all)).toEqual(["push", "email", "whatsapp"]);
    expect(channelsFor(alert("low_rate", "medium"), director, all)).toEqual(["push"]);
    expect(channelsFor(alert("critical_finding", "critical"), team[2]!, all)).toEqual(["telegram", "email"]);
    expect(channelsFor(alert("critical_finding", "critical"), team[2]!, { ...all, email: false, telegram: false })).toEqual([]);
  });
});

describe("mensajes", () => {
  it("formato con hora de Colombia y HTML escapado", () => {
    const m = formatAlert(alert("critical_finding", "critical"), "Parque Solar Demo");
    expect(m.title).toBe("🔴 Hallazgo crítico");
    expect(m.text).toContain("10:30");
    expect(m.telegramHtml).toContain("&lt;tramo sur&gt;");
    expect(m.emailSubject).toBe("[AvanceObra] Crítica: Hallazgo crítico — Parque Solar Demo");
  });
  it("vinculación de Telegram con /start CODIGO", () => {
    expect(parseStartCommand("/start 0A1B2C3D4E")).toBe("0A1B2C3D4E");
    expect(parseStartCommand("/start 0a1b2c3d4e")).toBe("0A1B2C3D4E");
    expect(parseStartCommand("hola")).toBeNull();
    expect(parseStartCommand(undefined)).toBeNull();
  });
});

describe("envío por canal (fetch simulado)", () => {
  const m = formatAlert(alert("critical_finding", "critical"), "Demo");
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fakeFetch = (status: number, json: unknown = {}) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;

  it("Telegram", async () => {
    expect(await sendTelegram("TOKEN", "111", m, fakeFetch(200))).toEqual({ ok: true });
    expect(calls.at(-1)!.url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(calls.at(-1)!.body).toMatchObject({ chat_id: "111", parse_mode: "HTML" });
  });
  it("Expo push detecta tokens inválidos aunque la respuesta sea 200", async () => {
    const r = await sendExpoPush(["t1"], m, {}, fakeFetch(200, { data: [{ status: "error", message: "DeviceNotRegistered" }] }));
    expect(r).toEqual({ ok: false, error: "DeviceNotRegistered" });
  });
  it("correo (Resend) con error de la API", async () => {
    const r = await sendEmail("KEY", "Alertas <alertas@x.co>", "a@b.co", m, fakeFetch(422, { message: "invalid" }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("422");
    expect(calls.at(-1)!.headers.Authorization).toBe("Bearer KEY");
  });
  it("WhatsApp con plantilla y número normalizado", async () => {
    await sendWhatsApp("T", "PNID", "alerta_obra", "+57 300 000 0000", m, fakeFetch(200));
    expect(calls.at(-1)!.url).toBe("https://graph.facebook.com/v21.0/PNID/messages");
    expect(calls.at(-1)!.body).toMatchObject({ to: "573000000000", type: "template", template: { name: "alerta_obra" } });
  });
});
