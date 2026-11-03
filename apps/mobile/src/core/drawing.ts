import { polygonAreaM2, rectangle, type LonLat } from "@avanceobra/engine";

/**
 * Dibujo del área trabajada sobre el plano: el supervisor toca vértices (o dos esquinas
 * para un rectángulo) y se arma un polígono GeoJSON cerrado con su área aproximada.
 */

export interface DrawnArea {
  geojson: { type: "Polygon"; coordinates: LonLat[][] };
  areaM2: number;
}

export function closeRing(points: LonLat[]): LonLat[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export function polygonFromTaps(points: LonLat[]): DrawnArea | null {
  if (points.length < 3) return null;
  const ring = closeRing(points);
  const coordinates = [ring];
  return { geojson: { type: "Polygon", coordinates }, areaM2: polygonAreaM2(coordinates) };
}

export function rectangleFromTaps(a: LonLat, b: LonLat): DrawnArea {
  const coordinates = rectangle(a, b);
  return { geojson: { type: "Polygon", coordinates }, areaM2: polygonAreaM2(coordinates) };
}

/** Unidades de área para proponer la cantidad del día a partir del área dibujada. */
const AREA_UNITS: Record<string, number> = { m2: 1, "m²": 1, ha: 10_000 };

export function quantityFromArea(unit: string, areaM2: number): number | null {
  const factor = AREA_UNITS[unit.trim().toLowerCase()];
  if (!factor) return null;
  return Math.round((areaM2 / factor) * 100) / 100;
}
