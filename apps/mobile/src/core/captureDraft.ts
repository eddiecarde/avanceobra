/**
 * Borrador de la captura de avance: se guarda solo mientras se escribe, así salir de la
 * pantalla, recibir una llamada o quedarse sin batería no hace perder lo registrado.
 */

export const DRAFT_VERSION = 1;
/** Un borrador más viejo que esto se ofrece igual, pero se marca como antiguo. */
export const DRAFT_STALE_HOURS = 72;

export interface CaptureDraft {
  v: number;
  activityId: string;
  frontId: string;
  workDate: string;
  quantity: string;
  hours: string | null;
  lostHours: string;
  cause: string;
  weather: string | null;
  crew: string | null;
  notes: string;
  photos: { id: string; uri: string; takenAt: string; annotation?: string }[];
  signatureUri: string | null;
  elementIds: string[];
  area: { geojson: string; areaM2: number } | null;
  /** Respuestas del formato de la actividad (si tiene). */
  values?: Record<string, unknown>;
  savedAt: string;
}

export const draftKey = (userId: string, activityId: string) => `${userId}:${activityId}`;

/** Un borrador vale la pena guardarlo solo si el usuario ya escribió o marcó algo. */
export function hasContent(d: Omit<CaptureDraft, "v" | "savedAt">): boolean {
  return (
    d.quantity.trim() !== "" ||
    d.notes.trim() !== "" ||
    d.photos.length > 0 ||
    d.elementIds.length > 0 ||
    d.area !== null ||
    d.signatureUri !== null ||
    Object.keys(d.values ?? {}).length > 0 ||
    (d.lostHours !== "0" && d.lostHours.trim() !== "")
  );
}

export function serializeDraft(d: Omit<CaptureDraft, "v" | "savedAt">, now = new Date()): string {
  return JSON.stringify({ ...d, v: DRAFT_VERSION, savedAt: now.toISOString() } satisfies CaptureDraft);
}

export function parseDraft(json: string | null | undefined): CaptureDraft | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Partial<CaptureDraft>;
    if (d.v !== DRAFT_VERSION || typeof d.activityId !== "string" || typeof d.quantity !== "string") return null;
    return {
      v: DRAFT_VERSION,
      activityId: d.activityId,
      frontId: d.frontId ?? "",
      workDate: d.workDate ?? "",
      quantity: d.quantity,
      hours: d.hours ?? null,
      lostHours: d.lostHours ?? "0",
      cause: d.cause ?? "none",
      weather: d.weather ?? null,
      crew: d.crew ?? null,
      notes: d.notes ?? "",
      photos: Array.isArray(d.photos) ? d.photos : [],
      signatureUri: d.signatureUri ?? null,
      elementIds: Array.isArray(d.elementIds) ? d.elementIds : [],
      area: d.area ?? null,
      values: d.values && typeof d.values === "object" ? d.values : {},
      savedAt: d.savedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function draftAgeHours(d: CaptureDraft, now = new Date()): number {
  return (now.getTime() - Date.parse(d.savedAt)) / 3_600_000;
}

/** Hora local de Colombia para el aviso "Borrador recuperado de las 10:32". */
export function draftTimeLabel(d: CaptureDraft, timeZone = "America/Bogota"): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(
    new Date(d.savedAt),
  );
}
