/**
 * Parte diario en el teléfono: borrador editable, validación y fila a enviar.
 * Lógica pura (sin React ni base local) para probarla sin dispositivo.
 */

export interface RainEvent {
  start: string;
  end: string;
}

export interface DailyLogDraft {
  personnel: Record<string, number>;
  equipment: Record<string, number>;
  /** Actividad en la que trabajó cada equipo (nombre → id), para el rendimiento real por máquina. */
  equipmentActivity?: Record<string, string>;
  rain: RainEvent[];
  observations: string;
  /** Lo que dictó el supervisor (se guarda aunque no haya señal). */
  dictation?: string;
  /** Lo que devolvió el asistente (avances y hallazgos pendientes de registrar). */
  ai?: import("./dictation").ParsedReport | null;
}

/** Si el administrador no ha definido catálogos (o no hay señal la primera vez). */
export const DEFAULT_ROLES = ["Director de obra", "Residente", "Supervisor SST", "Maestro de obra", "Oficial de obra", "Auxiliar de obra", "Operador de equipo", "Soldador", "Conductor"];
export const DEFAULT_EQUIPMENT = ["Retroexcavadora", "Vibrocompactador", "Motoniveladora", "Volqueta", "Mezcladora de concreto", "Vibrador de concreto", "Hincadora", "Canguro"];

export const emptyDraft = (): DailyLogDraft => ({ personnel: {}, equipment: {}, rain: [], observations: "" });

/** Acepta "7", "7:5", "07:05", "1015" o "10.30" y devuelve "HH:MM", o null si no es una hora válida. */
export function normalizeTime(s: string): string | null {
  const t = s.trim().replace(/[.,h]/gi, ":");
  let h: number;
  let min: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{1,2})$/.exec(t))) [h, min] = [Number(m[1]), Number(m[2])];
  else if ((m = /^(\d{1,2})(\d{2})$/.exec(t))) [h, min] = [Number(m[1]), Number(m[2])];
  else if (/^\d{1,2}$/.test(t)) [h, min] = [Number(t), 0];
  else return null;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Hora actual en Colombia, "HH:MM". */
export function nowColombia(d = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export const rainMinutes = (e: RainEvent) => {
  const [a, b] = [e.start, e.end].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5)));
  return b! - a!;
};

/** Errores que impiden enviar (el servidor valida lo mismo). */
export function validateDraft(d: DailyLogDraft): string[] {
  const errors: string[] = [];
  d.rain.forEach((r, i) => {
    const a = normalizeTime(r.start);
    const b = normalizeTime(r.end);
    if (!a || !b) errors.push(`Lluvia ${i + 1}: escribe la hora de inicio y fin (HH:MM).`);
    else if (a >= b) errors.push(`Lluvia ${i + 1}: la hora de fin debe ser después del inicio.`);
  });
  for (const [k, v] of [...Object.entries(d.personnel), ...Object.entries(d.equipment)])
    if (!Number.isInteger(v) || v < 0 || v > 9999) errors.push(`${k}: la cantidad debe ser un número entero.`);
  const total = Object.values(d.personnel).reduce((s, n) => s + n, 0);
  if (total === 0 && Object.values(d.equipment).every((n) => n === 0) && d.rain.length === 0 && !d.observations.trim())
    errors.push("El parte está vacío: registra al menos el personal.");
  return errors;
}

/** Fila para la tabla daily_logs (las listas van como JSON de texto en SQLite). */
export function toDailyLogRow(d: DailyLogDraft, ctx: { id: string; projectId: string; frontId: string | null; date: string; now: string }) {
  return {
    id: ctx.id,
    project_id: ctx.projectId,
    front_id: ctx.frontId,
    log_date: ctx.date,
    personnel: JSON.stringify(Object.entries(d.personnel).filter(([, q]) => q > 0).map(([role, qty]) => ({ role, qty }))),
    equipment: JSON.stringify(
      Object.entries(d.equipment)
        .filter(([, q]) => q > 0)
        .map(([name, qty]) => (d.equipmentActivity?.[name] ? { name, qty, activity_id: d.equipmentActivity[name] } : { name, qty })),
    ),
    rain: JSON.stringify(d.rain.map((r) => ({ start: normalizeTime(r.start)!, end: normalizeTime(r.end)! }))),
    observations: d.observations.trim(),
    client_created_at: ctx.now,
  };
}
