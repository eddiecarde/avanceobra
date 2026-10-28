/**
 * Modelos de Meta (Meta Model API) para el asistente de AvanceObra:
 * - Muse Spark: texto e imagen → JSON con esquema (parte por voz, defectos, verificación) y resúmenes.
 * - SAM 3.1: segmentar y contar elementos (pilotes, trackers, módulos) en una foto.
 * - Muse Voice Transcribe: audio WAV → texto.
 * Las funciones puras (sin red) se prueban con Vitest; las de red reciben la clave como argumento.
 */
export const META_BASE = "https://api.meta.ai/v1";
export const CHAT_MODEL = "muse-spark-1.3";
export const SAM_MODEL = "sam-3.1";
export const ASR_MODEL = "muse-voice-transcribe-1.0";

// ---------------------------------------------------------------- red

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Chat Completions; con `schema` la respuesta es un objeto JSON que cumple ese esquema. */
export async function metaChat<T = string>(
  key: string,
  opts: { system: string; user: string | Part[]; schema?: { name: string; schema: Record<string, unknown> }; model?: string },
): Promise<T> {
  const body: Record<string, unknown> = {
    model: opts.model ?? CHAT_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.schema) body.response_format = { type: "json_schema", json_schema: opts.schema };
  const res = await fetch(`${META_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Muse Spark respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  return (opts.schema ? JSON.parse(stripFences(content)) : content) as T;
}

/** SAM 3.1: cajas de cada objeto que coincide con el concepto (en inglés: "pile", "solar panel"…). */
export async function samSegment(key: string, imageUrl: string, concept: string): Promise<SamResult> {
  const res = await fetch(`${META_BASE}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: SAM_MODEL,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageUrl }] }],
      metadata: { mask_encoding: "one_bit", include_confidence: "true" },
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`SAM respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return parseSamOutput(collectSse(await res.text()));
}

/** Muse Voice Transcribe: grabación WAV (≤ 10 min) → texto. */
export async function transcribeWav(key: string, wav: Blob): Promise<string> {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: ASR_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
  form.append("audio", wav, "parte.wav");
  const res = await fetch(`${META_BASE}/asr/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, Accept: "text/plain" },
    body: form,
  });
  if (!res.ok) throw new Error(`La transcripción respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return transcriptText(await res.text());
}

// ---------------------------------------------------------------- puras

export function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}

/** Texto de un stream SSE de la Responses API: concatena los `response.output_text.delta`. */
export function collectSse(raw: string): string {
  let out = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const ev = JSON.parse(data);
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") out += ev.delta + "\n";
    } catch {
      // línea que no es JSON: se ignora
    }
  }
  return out;
}

/** Texto plano de la transcripción ("A:Hola" si hay hablantes) → un solo texto. */
export function transcriptText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[A-Z]:\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Confianza 0–1 (si se pidió). */
  c: number | null;
}
export interface SamResult {
  boxes: SamBox[];
  width: number | null;
  height: number | null;
}

/** Lee las cajas de la salida de SAM (`<|box;x1=…;y1=…;x2=…;y2=…;w=…;h=…;c=…|>`); las máscaras se ignoran. */
export function parseSamOutput(text: string): SamResult {
  const boxes: SamBox[] = [];
  let width: number | null = null;
  let height: number | null = null;
  for (const m of text.matchAll(/<\|box;([^|]*)\|>/g)) {
    const f: Record<string, number> = {};
    for (const kv of m[1].split(";")) {
      const [k, v] = kv.split("=");
      if (k && v !== undefined && Number.isFinite(Number(v))) f[k.trim()] = Number(v);
    }
    if (!["x1", "y1", "x2", "y2"].every((k) => k in f)) continue;
    boxes.push({ x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, c: "c" in f ? f.c : null });
    width ??= f.w ?? null;
    height ??= f.h ?? null;
  }
  return { boxes, width, height };
}

/** Solo las cajas con confianza suficiente (las que no traen confianza cuentan). */
export function confidentBoxes(r: SamResult, min = 0.5): SamBox[] {
  return r.boxes.filter((b) => b.c === null || b.c >= min);
}

/**
 * Concepto en inglés para SAM según la actividad (nombre y unidad). Si la actividad ya trae uno
 * configurado se usa ese. Sin concepto conocido no se cuenta (la foto igual la revisa Muse Spark).
 */
export function samConcept(activity: { name: string; unit?: string | null; ai_count_prompt?: string | null }): string | null {
  if (activity.ai_count_prompt?.trim()) return activity.ai_count_prompt.trim();
  const n = activity.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const rules: [RegExp, string][] = [
    // Probado con SAM 3.1: "metal post" cuenta pilotes hincados; "steel pile" o "pile" no encuentran nada
    [/hinca|pilote|pile|poste|perfil/, "metal post"],
    [/modulo|panel/, "solar panel"],
    [/tracker|seguidor|estructura|mesa/, "triangular steel bracket"],
    [/inversor/, "inverter"],
    [/caja|combiner|string box/, "electrical box"],
    [/tubo|tuberia|ducto/, "pipe"],
  ];
  for (const [re, concept] of rules) if (re.test(n)) return concept;
  return null;
}

export type VerifyStatus = "consistente" | "revisar" | "sin_evidencia";

/**
 * Dictamen de una foto frente a la cantidad reportada. Una foto no muestra todo lo de un día, así
 * que solo se marca "revisar" cuando lo reportado es poco (cabe en la foto) y la foto muestra menos de
 * la mitad, o cuando Muse Spark dice que la foto no corresponde a la actividad.
 */
export function verifyStatus(p: { count: number | null; reported: number; matchesActivity: boolean; photos: number }): VerifyStatus {
  if (p.photos === 0) return "sin_evidencia";
  if (!p.matchesActivity) return "revisar";
  if (p.count === null) return "consistente";
  if (p.count === 0) return "sin_evidencia";
  if (p.reported <= 30 && p.count < p.reported * 0.5) return "revisar";
  return "consistente";
}

// ---------------------------------------------------------------- parte por voz

export interface ReportContext {
  fronts: { code: string; name: string }[];
  activities: { code: string; name: string; unit: string; front_code: string | null }[];
  roles: string[];
  equipment: string[];
}

export interface ParsedReport {
  front_code: string | null;
  progress: { activity_code: string; quantity: number; note: string }[];
  personnel: { role: string; qty: number }[];
  equipment: { name: string; qty: number }[];
  rain: { start: string; end: string }[];
  findings: { description: string; type: "quality" | "safety" | "environment" | "operation"; severity: "low" | "medium" | "high" | "critical" }[];
  observations: string;
  /** Lo que el modelo no pudo ubicar (actividad desconocida, etc.), para que el supervisor lo revise. */
  unmatched: string[];
}

export const REPORT_SCHEMA = {
  name: "ParteDiario",
  schema: {
    type: "object",
    properties: {
      front_code: { type: ["string", "null"], description: "Código del frente mencionado, o null" },
      progress: {
        type: "array",
        items: {
          type: "object",
          properties: {
            activity_code: { type: "string" },
            quantity: { type: "number" },
            note: { type: "string" },
          },
          required: ["activity_code", "quantity", "note"],
        },
      },
      personnel: { type: "array", items: { type: "object", properties: { role: { type: "string" }, qty: { type: "integer" } }, required: ["role", "qty"] } },
      equipment: { type: "array", items: { type: "object", properties: { name: { type: "string" }, qty: { type: "integer" } }, required: ["name", "qty"] } },
      rain: {
        type: "array",
        items: { type: "object", properties: { start: { type: "string", description: "HH:MM 24 h" }, end: { type: "string", description: "HH:MM 24 h" } }, required: ["start", "end"] },
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            type: { type: "string", enum: ["quality", "safety", "environment", "operation"] },
            severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          },
          required: ["description", "type", "severity"],
        },
      },
      observations: { type: "string" },
      unmatched: { type: "array", items: { type: "string" } },
    },
    required: ["front_code", "progress", "personnel", "equipment", "rain", "findings", "observations", "unmatched"],
  },
};

export function reportPrompt(ctx: ReportContext): string {
  const acts = ctx.activities.map((a) => `${a.code} | ${a.name} | ${a.unit}${a.front_code ? ` | frente ${a.front_code}` : ""}`).join("\n");
  return [
    "Eres el asistente de un supervisor de obra en Colombia. Convierte lo que dicta (español coloquial, puede tener errores de transcripción) en el parte diario estructurado.",
    "Reglas:",
    "- Usa SOLO códigos de actividad y de frente de las listas. Si algo no se puede ubicar con seguridad, no lo inventes: ponlo en unmatched.",
    "- Las cantidades van en la unidad de la actividad. Números escritos en palabras se convierten a cifras.",
    "- Lluvia en hora de 24 h (\"de 10 a 11\" en jornada de día = 10:00 a 11:00; \"a las 2 de la tarde\" = 14:00).",
    "- Para personal y equipos, prefiere los nombres de las listas; si dice uno distinto, úsalo tal cual.",
    "- Hallazgos: solo problemas de calidad, seguridad, ambiente u operación que el supervisor mencione.",
    "- observations: lo demás que sea útil, corto. No repitas lo ya estructurado.",
    "",
    `Frentes (código | nombre):\n${ctx.fronts.map((f) => `${f.code} | ${f.name}`).join("\n") || "(ninguno)"}`,
    `Actividades (código | nombre | unidad):\n${acts || "(ninguna)"}`,
    `Cargos de personal: ${ctx.roles.join(", ") || "(libre)"}`,
    `Equipos: ${ctx.equipment.join(", ") || "(libre)"}`,
  ].join("\n");
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const FINDING_TYPES = ["quality", "safety", "environment", "operation"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

/** Limpia lo que devolvió el modelo: códigos que existen, cantidades positivas, horas válidas. */
export function normalizeReport(raw: unknown, ctx: ReportContext): ParsedReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const unmatched = arr(r.unmatched).map(String).filter(Boolean);
  const codes = new Map(ctx.activities.map((a) => [a.code.toUpperCase(), a.code]));
  const fronts = new Map(ctx.fronts.map((f) => [f.code.toUpperCase(), f.code]));

  const progress: ParsedReport["progress"] = [];
  for (const p of arr(r.progress)) {
    const code = codes.get(String(p.activity_code ?? "").trim().toUpperCase());
    const qty = Number(p.quantity);
    if (!code) {
      unmatched.push(`Actividad «${String(p.activity_code ?? "")}» (${p.quantity})`);
      continue;
    }
    if (!(qty > 0) || qty > 1e7) continue;
    progress.push({ activity_code: code, quantity: Math.round(qty * 1000) / 1000, note: String(p.note ?? "").trim().slice(0, 300) });
  }
  const pad = (t: string) => {
    const m = HHMM.exec(t.trim());
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  };
  const rain: ParsedReport["rain"] = [];
  for (const x of arr(r.rain)) {
    const start = pad(String(x.start ?? ""));
    const end = pad(String(x.end ?? ""));
    if (start && end && start < end) rain.push({ start, end });
  }
  const count = (v: unknown) => {
    const n = Math.round(Number(v));
    return n >= 1 && n <= 9999 ? n : null;
  };
  const personnel = arr(r.personnel).flatMap((x) => {
    const qty = count(x.qty);
    const role = String(x.role ?? "").trim();
    return qty && role ? [{ role: role.slice(0, 60), qty }] : [];
  });
  const equipment = arr(r.equipment).flatMap((x) => {
    const qty = count(x.qty);
    const name = String(x.name ?? "").trim();
    return qty && name ? [{ name: name.slice(0, 60), qty }] : [];
  });
  const findings = arr(r.findings).flatMap((x) => {
    const description = String(x.description ?? "").trim();
    if (description.length < 4) return [];
    const type = (FINDING_TYPES as readonly string[]).includes(String(x.type)) ? (x.type as ParsedReport["findings"][number]["type"]) : "quality";
    const severity = (SEVERITIES as readonly string[]).includes(String(x.severity)) ? (x.severity as ParsedReport["findings"][number]["severity"]) : "medium";
    return [{ description: description.slice(0, 500), type, severity }];
  });
  return {
    front_code: r.front_code ? fronts.get(String(r.front_code).trim().toUpperCase()) ?? null : null,
    progress,
    personnel,
    equipment,
    rain,
    findings,
    observations: String(r.observations ?? "").trim().slice(0, 1000),
    unmatched,
  };
}

// ---------------------------------------------------------------- defectos

export interface DefectAnalysis {
  is_defect: boolean;
  type: (typeof FINDING_TYPES)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  description: string;
  corrective_action: string;
  /** Concepto en inglés para que SAM marque el defecto en la foto ("rust", "cracked panel"…). */
  sam_concept: string;
}

export const DEFECT_SCHEMA = {
  name: "Defecto",
  schema: {
    type: "object",
    properties: {
      is_defect: { type: "boolean" },
      type: { type: "string", enum: [...FINDING_TYPES] },
      severity: { type: "string", enum: [...SEVERITIES] },
      title: { type: "string" },
      description: { type: "string" },
      corrective_action: { type: "string" },
      sam_concept: { type: "string" },
    },
    required: ["is_defect", "type", "severity", "title", "description", "corrective_action", "sam_concept"],
  },
};

export const DEFECT_PROMPT = [
  "Eres inspector de calidad, seguridad y ambiente en obras de construcción en Colombia (plantas solares, vías, redes, edificaciones).",
  "Mira la foto y la nota del inspector y responde en español:",
  "- is_defect: si la foto muestra un defecto, riesgo o incumplimiento.",
  "- type: quality (calidad), safety (seguridad), environment (ambiente) u operation (operación).",
  "- severity: low, medium, high o critical. critical = riesgo de vida o daño grave inmediato.",
  "- title: máximo 8 palabras.",
  "- description: qué se ve y dónde, 1 o 2 frases. No inventes medidas que no se ven.",
  "- corrective_action: qué hacer para corregirlo y cómo verificarlo, en pasos cortos.",
  "- sam_concept: 1 a 3 palabras EN INGLÉS que nombren el objeto o zona con el defecto para marcarlo en la imagen (ej. \"rust\", \"bent pile\", \"cracked panel\", \"loose cable\").",
].join("\n");

export function normalizeDefect(raw: unknown): DefectAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const type = (FINDING_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as DefectAnalysis["type"]) : "quality";
  const severity = (SEVERITIES as readonly string[]).includes(String(r.severity)) ? (r.severity as DefectAnalysis["severity"]) : "medium";
  return {
    is_defect: r.is_defect !== false,
    type,
    severity,
    title: String(r.title ?? "").trim().slice(0, 120),
    description: String(r.description ?? "").trim().slice(0, 800),
    corrective_action: String(r.corrective_action ?? "").trim().slice(0, 1200),
    sam_concept: String(r.sam_concept ?? "").trim().slice(0, 40),
  };
}

// ---------------------------------------------------------------- verificación con foto

export const PHOTO_CHECK_SCHEMA = {
  name: "VerificacionFoto",
  schema: {
    type: "object",
    properties: {
      matches_activity: { type: "boolean", description: "¿La foto muestra trabajo de esta actividad?" },
      visible_count: { type: ["integer", "null"], description: "Elementos terminados que se ven, o null si no aplica contar" },
      comment: { type: "string", description: "Una frase en español" },
    },
    required: ["matches_activity", "visible_count", "comment"],
  },
};

export function photoCheckPrompt(a: { name: string; unit: string; reported: number }): string {
  return [
    "Eres residente de obra y revisas la foto que soporta un registro de avance.",
    `Actividad: ${a.name}. Unidad: ${a.unit}. Cantidad reportada hoy: ${a.reported}.`,
    "Una foto no muestra todo lo del día: no castigues que se vea menos de lo reportado si lo reportado es mucho.",
    "Responde si la foto muestra trabajo de esa actividad, cuántos elementos terminados se ven (si aplica contar) y un comentario corto en español.",
  ].join("\n");
}

// ---------------------------------------------------------------- resumen con datos reales

export const SUMMARY_PROMPT = [
  "Eres el asistente del gerente de una obra en Colombia. Escribe un resumen ejecutivo en español claro, para alguien sin tiempo.",
  "Reglas estrictas:",
  "- Usa SOLO los datos del JSON. No calcules cifras nuevas, no redondees distinto, no inventes causas.",
  "- Copia las cifras tal como vienen en los campos de texto (ya están formateadas).",
  "- Máximo 170 palabras. Estructura: 1) cómo va (avance y atraso), 2) dinero (multa, acelerar o pagar), 3) qué hacer esta semana (2 o 3 acciones concretas que salgan de los datos).",
  "- Sin títulos ni markdown, solo párrafos cortos y viñetas con «•».",
].join("\n");

/** Números (con su formato) que aparecen en un texto: "1.234,5", "12 %", "$ 3.000.000"… → valores. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/g)) {
    const s = m[0];
    const n = /\.\d{3}/.test(s) || s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Cifras del resumen que no salen de los datos (para no mostrar un número inventado). Se permiten 1–10 (listas, "3 acciones"…). */
export function ungroundedNumbers(summary: string, facts: unknown): number[] {
  const allowed = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "number") allowed.add(Math.round(v * 100) / 100);
    else if (typeof v === "string") for (const n of numbersIn(v)) allowed.add(Math.round(n * 100) / 100);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  const bad: number[] = [];
  for (const n of numbersIn(summary)) {
    const r = Math.round(Math.abs(n) * 100) / 100;
    if (r <= 10 && Number.isInteger(r)) continue;
    if (allowed.has(r) || allowed.has(-r)) continue;
    // fechas como 2026 o días del mes ya vienen en los datos; si no, es inventado
    bad.push(n);
  }
  return bad;
}
