/**
 * Parte por voz: el supervisor dicta con el micrófono del teclado y Muse Spark (Meta) lo convierte en
 * el parte estructurado (Edge Function ai-assist, acción parse_report). Aquí, la parte pura: cómo se
 * mezcla lo dictado con el borrador y qué avances y hallazgos quedan para registrar.
 */
import { normalizeTime, type DailyLogDraft } from "./dailyLog";

export interface ParsedReport {
  front_code: string | null;
  progress: { activity_code: string; quantity: number; note: string }[];
  personnel: { role: string; qty: number }[];
  equipment: { name: string; qty: number }[];
  rain: { start: string; end: string }[];
  findings: { description: string; type: "quality" | "safety" | "environment" | "operation"; severity: "low" | "medium" | "high" | "critical" }[];
  observations: string;
  unmatched: string[];
}

/** El nombre tal como está en el catálogo, sin importar mayúsculas ni tildes; si no está, el dictado. */
function sameName(catalog: string[], name: string): string {
  const k = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return catalog.find((c) => k(c) === k(name)) ?? name.trim();
}

/**
 * Pone en el borrador lo dictado: las cantidades dictadas reemplazan las del mismo cargo o equipo,
 * la lluvia se agrega sin repetir y las observaciones se suman al final.
 */
export function applyReport(draft: DailyLogDraft, r: ParsedReport, catalogs: { roles: string[]; equipment: string[] }): DailyLogDraft {
  const personnel = { ...draft.personnel };
  for (const p of r.personnel) personnel[sameName(catalogs.roles, p.role)] = p.qty;
  const equipment = { ...draft.equipment };
  for (const e of r.equipment) equipment[sameName(catalogs.equipment, e.name)] = e.qty;
  const rain = [...draft.rain];
  for (const x of r.rain) {
    const start = normalizeTime(x.start);
    const end = normalizeTime(x.end);
    if (start && end && start < end && !rain.some((y) => y.start === start && y.end === end)) rain.push({ start, end });
  }
  rain.sort((a, b) => a.start.localeCompare(b.start));
  const obs = r.observations.trim();
  const observations = !obs || draft.observations.includes(obs) ? draft.observations : [draft.observations.trim(), obs].filter(Boolean).join("\n");
  return { personnel, equipment, rain, observations };
}

export interface DictatedProgress {
  activityId: string;
  frontId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  note: string;
}

/** Avances dictados con la actividad del teléfono (los códigos que no están en el teléfono se descartan). */
export function dictatedProgress(r: ParsedReport, activities: { id: string; code: string; name: string; unit: string; front_id: string }[]): DictatedProgress[] {
  const byCode = new Map(activities.map((a) => [a.code.toUpperCase(), a]));
  return r.progress.flatMap((p) => {
    const a = byCode.get(p.activity_code.toUpperCase());
    return a ? [{ activityId: a.id, frontId: a.front_id, code: a.code, name: a.name, unit: a.unit, quantity: p.quantity, note: p.note }] : [];
  });
}
