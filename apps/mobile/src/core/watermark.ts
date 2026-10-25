/** Texto de la marca de agua de las fotos: fecha, hora, coordenadas y contexto. */
export interface WatermarkInfo {
  takenAt: Date;
  lat: number | null;
  lon: number | null;
  accuracyM?: number | null;
  project?: string;
  front?: string;
  activity?: string;
  user?: string;
  /** Zona horaria de la obra (Colombia por defecto). */
  timeZone?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha y hora local de la obra, independiente de la configuración del teléfono. */
export function formatLocalDateTime(d: Date, timeZone = "America/Bogota"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:${get("second")}`;
}

export function formatCoord(lat: number | null, lon: number | null, accuracyM?: number | null): string {
  if (lat === null || lon === null) return "Sin GPS";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const acc = accuracyM ? ` ±${Math.round(accuracyM)} m` : "";
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}${acc}`;
}

export function watermarkLines(info: WatermarkInfo): string[] {
  const lines = [formatLocalDateTime(info.takenAt, info.timeZone), formatCoord(info.lat, info.lon, info.accuracyM)];
  const ctx = [info.project, info.front, info.activity].filter(Boolean).join(" · ");
  if (ctx) lines.push(ctx);
  if (info.user) lines.push(info.user);
  return lines;
}

export { pad };
