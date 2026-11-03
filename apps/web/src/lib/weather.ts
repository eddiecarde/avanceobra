/**
 * Clima actual con Open-Meteo (gratuito, sin clave). Solo se envían las coordenadas del proyecto;
 * si no hay red o falla, el clima simplemente no se muestra.
 */
export interface Weather {
  temperature: number;
  code: number;
  label: string;
}

/** Códigos WMO del servicio, en palabras. */
export function weatherLabel(code: number): string {
  if (code === 0) return "Despejado";
  if (code === 1) return "Mayormente despejado";
  if (code === 2) return "Parcialmente nublado";
  if (code === 3) return "Nublado";
  if (code === 45 || code === 48) return "Niebla";
  if (code >= 51 && code <= 57) return "Llovizna";
  if (code >= 61 && code <= 67) return "Lluvia";
  if (code >= 71 && code <= 77) return "Nieve";
  if (code >= 80 && code <= 82) return "Chubascos";
  if (code >= 95) return "Tormenta";
  return "Sin dato";
}

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=America%2FBogota`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
    if (j.current?.temperature_2m == null || j.current.weather_code == null) return null;
    return { temperature: j.current.temperature_2m, code: j.current.weather_code, label: weatherLabel(j.current.weather_code) };
  } catch {
    return null;
  }
}

/** Busca las coordenadas de un municipio (Colombia primero). */
export async function geocode(name: string): Promise<{ lat: number; lon: number; label: string } | null> {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.split(",")[0]!.trim())}&count=5&language=es`);
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: { latitude: number; longitude: number; name: string; admin1?: string; country_code?: string }[] };
    const hit = j.results?.find((x) => x.country_code === "CO") ?? j.results?.[0];
    return hit ? { lat: hit.latitude, lon: hit.longitude, label: [hit.name, hit.admin1].filter(Boolean).join(", ") } : null;
  } catch {
    return null;
  }
}
