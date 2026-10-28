// Edge Function: asistente con modelos de Meta. Una sola función con varias acciones:
// - summary:       resumen ejecutivo escrito por Muse Spark SOLO con las cifras que calculó el motor.
// - transcribe:    audio WAV → texto (Muse Voice Transcribe).
// - parse_report:  lo que dictó el supervisor → parte diario estructurado (Muse Spark con esquema).
// - verify_entry:  cuenta con SAM 3.1 los elementos en las fotos de un registro y Muse Spark revisa
//                  que la foto corresponda a la actividad; queda el dictamen para el residente.
// - defect:        foto de un hallazgo → tipo, severidad, descripción y acción correctiva (Muse Spark)
//                  y la zona del defecto marcada con SAM 3.1.
// Las lecturas se hacen con la sesión de quien llama (aplican sus permisos); solo se escribe el resultado.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CORS } from "../_shared/team.ts";
import {
  DEFECT_PROMPT,
  DEFECT_SCHEMA,
  PHOTO_CHECK_SCHEMA,
  REPORT_SCHEMA,
  SUMMARY_PROMPT,
  confidentBoxes,
  metaChat,
  normalizeDefect,
  normalizeReport,
  photoCheckPrompt,
  reportPrompt,
  samConcept,
  samSegment,
  transcribeWav,
  ungroundedNumbers,
  verifyStatus,
  type ReportContext,
} from "../_shared/meta.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: CORS });
const UUID = /^[0-9a-f-]{36}$/i;
const DAILY_LIMIT = 200;
const MAX_IMAGE_B64 = 4_000_000;
const MAX_AUDIO_B64 = 8_000_000;

class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Usa POST" });
  const key = env("META_MODEL_API_KEY");
  if (!key) return reply(503, { error: "El asistente no está configurado todavía (falta la clave de Meta)." });

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const auth = req.headers.get("Authorization") ?? "";
  const { data: caller } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!caller?.user) return reply(401, { error: "Inicia sesión de nuevo." });
  const userId = caller.user.id;
  // Cliente con la sesión de quien llama: lo que no puede ver, la IA tampoco lo ve
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  const projectId = typeof body?.project_id === "string" && UUID.test(body.project_id) ? body.project_id : null;

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return reply(429, { error: `Llegaste al límite de ${DAILY_LIMIT} usos del asistente en 24 horas.` });

  const started = Date.now();
  let ok = true;
  try {
    let result: unknown;
    if (action === "summary") result = await summary(key, db, projectId, body?.facts);
    else if (action === "transcribe") result = await transcribe(key, body?.audio_base64);
    else if (action === "parse_report") result = await parseReport(key, db, projectId, body?.text, body?.front_id);
    else if (action === "verify_entry") result = await verifyEntry(key, db, admin, userId, body?.entry_id);
    else if (action === "defect") result = await defect(key, db, projectId, body?.image_base64, body?.note);
    else throw new Fail(400, "Acción desconocida.");
    return reply(200, result);
  } catch (e) {
    ok = false;
    if (e instanceof Fail) return reply(e.status, { error: e.message });
    console.error(action, e);
    return reply(502, { error: "El modelo de Meta no respondió bien. Intenta de nuevo en un momento." });
  } finally {
    await admin.from("ai_usage").insert({ user_id: userId, project_id: projectId, action, ok, ms: Date.now() - started });
  }
});

async function requireMember(db: SupabaseClient, projectId: string | null) {
  if (!projectId) throw new Fail(400, "Falta la obra.");
  const { data } = await db.from("projects").select("id, name").eq("id", projectId).maybeSingle();
  if (!data) throw new Fail(403, "No tienes acceso a esta obra.");
  return data as { id: string; name: string };
}

function imageDataUrl(b64: unknown): string {
  const s = String(b64 ?? "");
  if (s.length < 100 || s.length > MAX_IMAGE_B64) throw new Fail(400, "La foto no llegó o es muy pesada (máximo unos 3 MB).");
  return s.startsWith("data:image/") ? s : `data:image/jpeg;base64,${s}`;
}

// ------------------------------------------------------------------ resumen

async function summary(key: string, db: SupabaseClient, projectId: string | null, facts: unknown) {
  await requireMember(db, projectId);
  if (!facts || typeof facts !== "object") throw new Fail(400, "Faltan los datos del tablero.");
  const factsJson = JSON.stringify(facts);
  if (factsJson.length > 20_000) throw new Fail(400, "Demasiados datos para el resumen.");
  let text = await metaChat<string>(key, { system: SUMMARY_PROMPT, user: factsJson });
  let bad = ungroundedNumbers(text, facts);
  if (bad.length) {
    // Un segundo intento diciéndole qué cifras no están en los datos
    text = await metaChat<string>(key, {
      system: SUMMARY_PROMPT,
      user: `${factsJson}\n\nTu resumen anterior usó cifras que NO están en los datos (${bad.join(", ")}). Reescríbelo usando solo cifras del JSON:\n${text}`,
    });
    bad = ungroundedNumbers(text, facts);
  }
  return { text: text.trim(), ungrounded: bad, model: "muse-spark" };
}

// ------------------------------------------------------------------ voz

async function transcribe(key: string, audio: unknown) {
  const s = String(audio ?? "").replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
  if (s.length < 1000) throw new Fail(400, "No llegó el audio.");
  if (s.length > MAX_AUDIO_B64) throw new Fail(400, "La grabación es muy larga: máximo unos 3 minutos.");
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const text = await transcribeWav(key, new Blob([bytes], { type: "audio/wav" }));
  return { text };
}

async function parseReport(key: string, db: SupabaseClient, projectId: string | null, text: unknown, frontId: unknown) {
  await requireMember(db, projectId);
  const said = String(text ?? "").trim();
  if (said.length < 8) throw new Fail(400, "Dicta o escribe un poco más: qué hicieron, cuánto, con quién y si llovió.");
  if (said.length > 6000) throw new Fail(400, "El texto es muy largo: divídelo por frente.");

  let fq = db.from("fronts").select("id, code, name").eq("project_id", projectId!);
  if (typeof frontId === "string" && UUID.test(frontId)) fq = fq.eq("id", frontId);
  const [{ data: fronts }, { data: acts }, { data: rates }, { data: logs }, { data: project }] = await Promise.all([
    fq,
    db.from("activities").select("code, name, unit, front_id").eq("project_id", projectId!).limit(600),
    db.from("cost_rates").select("personnel, equipment").eq("project_id", projectId!).maybeSingle(),
    db.from("daily_logs").select("personnel, equipment").eq("project_id", projectId!).order("log_date", { ascending: false }).limit(20),
    db.from("projects").select("personnel_roles, equipment_types").eq("id", projectId!).maybeSingle(),
  ]);
  const frontCode = new Map((fronts ?? []).map((f) => [f.id as string, f.code as string]));
  // Nombres que ya usa la obra: catálogo del proyecto, tarifas y partes recientes
  const roles = new Set<string>([...((project?.personnel_roles as string[]) ?? []), ...Object.keys((rates?.personnel as Record<string, unknown>) ?? {})]);
  const equipment = new Set<string>([...((project?.equipment_types as string[]) ?? []), ...Object.keys((rates?.equipment as Record<string, unknown>) ?? {})]);
  for (const l of logs ?? []) {
    for (const p of (l.personnel as { role?: string }[]) ?? []) if (p.role) roles.add(p.role);
    for (const e of (l.equipment as { name?: string }[]) ?? []) if (e.name) equipment.add(e.name);
  }
  const ctx: ReportContext = {
    fronts: (fronts ?? []).map((f) => ({ code: f.code as string, name: f.name as string })),
    activities: (acts ?? [])
      .filter((a) => frontCode.size === 0 || !a.front_id || frontCode.has(a.front_id as string))
      .map((a) => ({ code: a.code as string, name: a.name as string, unit: a.unit as string, front_code: frontCode.get(a.front_id as string) ?? null })),
    roles: [...roles].slice(0, 80),
    equipment: [...equipment].slice(0, 80),
  };
  if (!ctx.activities.length) throw new Fail(400, "La obra no tiene actividades para ubicar lo dictado.");
  const raw = await metaChat(key, { system: reportPrompt(ctx), user: said, schema: REPORT_SCHEMA });
  return { report: normalizeReport(raw, ctx), transcript: said };
}

// ------------------------------------------------------------------ verificar avance con fotos

async function verifyEntry(key: string, db: SupabaseClient, admin: SupabaseClient, userId: string, entryId: unknown) {
  if (typeof entryId !== "string" || !UUID.test(entryId)) throw new Fail(400, "Falta el registro.");
  const { data: entry } = await db
    .from("progress_entries")
    .select("id, project_id, quantity, notes, activities(name, unit, ai_count_prompt)")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) throw new Fail(404, "No encontré el registro o no tienes acceso.");
  const act = (Array.isArray(entry.activities) ? entry.activities[0] : entry.activities) as { name: string; unit: string; ai_count_prompt: string | null };
  const { data: photos } = await db.from("photos").select("id, storage_path, uploaded").eq("entry_id", entryId).eq("uploaded", true).limit(3);
  const reported = Number(entry.quantity);

  const urls: { id: string; url: string }[] = [];
  for (const p of photos ?? []) {
    const { data: file } = await admin.storage.from("photos").download(p.storage_path as string);
    if (!file) continue;
    const b64 = base64(new Uint8Array(await file.arrayBuffer()));
    if (b64.length <= MAX_IMAGE_B64) urls.push({ id: p.id as string, url: `data:${file.type || "image/jpeg"};base64,${b64}` });
  }

  const concept = samConcept(act);
  const perPhoto: { photo_id: string; width: number | null; height: number | null; boxes: unknown[] }[] = [];
  let samCount: number | null = null;
  let vision: { matches_activity: boolean; visible_count: number | null; comment: string } = { matches_activity: true, visible_count: null, comment: "" };
  if (urls.length) {
    const [sams, v] = await Promise.all([
      concept ? Promise.all(urls.map((u) => samSegment(key, u.url, concept))) : Promise.resolve([]),
      metaChat<typeof vision>(key, {
        system: photoCheckPrompt({ name: act.name, unit: act.unit, reported }),
        user: [
          { type: "text", text: `Notas del supervisor: ${entry.notes || "(sin notas)"}` },
          ...urls.map((u) => ({ type: "image_url" as const, image_url: { url: u.url } })),
        ],
        schema: PHOTO_CHECK_SCHEMA,
      }),
    ]);
    vision = v;
    sams.forEach((s, i) => {
      const boxes = confidentBoxes(s);
      perPhoto.push({ photo_id: urls[i].id, width: s.width, height: s.height, boxes });
    });
    // Varias fotos pueden mostrar lo mismo: se toma la que más cuenta, no la suma
    if (concept) samCount = Math.max(0, ...perPhoto.map((p) => p.boxes.length));
  }
  const status = verifyStatus({ count: samCount ?? (vision.visible_count ?? null), reported, matchesActivity: vision.matches_activity !== false, photos: urls.length });
  const row = {
    entry_id: entryId,
    project_id: entry.project_id,
    status,
    reported,
    sam_count: samCount,
    sam_concept: concept,
    vision_count: vision.visible_count ?? null,
    matches_activity: urls.length ? vision.matches_activity !== false : null,
    comment: urls.length ? String(vision.comment ?? "").slice(0, 500) : "El registro no tiene fotos subidas.",
    photos: perPhoto,
    checked_at: new Date().toISOString(),
    checked_by: userId,
  };
  const { error } = await admin.from("entry_ai_checks").upsert(row);
  if (error) throw new Error(error.message);
  return row;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ defectos

async function defect(key: string, db: SupabaseClient, projectId: string | null, image: unknown, note: unknown) {
  await requireMember(db, projectId);
  const url = imageDataUrl(image);
  const analysis = normalizeDefect(
    await metaChat(key, {
      system: DEFECT_PROMPT,
      user: [
        { type: "text", text: `Nota del inspector: ${String(note ?? "").slice(0, 500) || "(sin nota)"}` },
        { type: "image_url", image_url: { url } },
      ],
      schema: DEFECT_SCHEMA,
    }),
  );
  let marks: { width: number | null; height: number | null; boxes: unknown[] } = { width: null, height: null, boxes: [] };
  if (analysis.is_defect && analysis.sam_concept) {
    try {
      const s = await samSegment(key, url, analysis.sam_concept);
      marks = { width: s.width, height: s.height, boxes: confidentBoxes(s, 0.4).slice(0, 10) };
    } catch (e) {
      console.error("sam defect", e); // sin marcas, el análisis sigue sirviendo
    }
  }
  return { analysis, marks };
}
