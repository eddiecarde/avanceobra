/**
 * Geometría para el plano georreferenciado: área de polígonos (m²) y
 * georreferenciación de un plano (imagen/PDF) con puntos de control.
 * Sin dependencias para que funcione igual offline en el móvil.
 */

export type LonLat = [number, number];

/** Radio WGS84 usado también por Turf.js, para que los resultados coincidan. */
const EARTH_RADIUS = 6_378_137;
const rad = (d: number) => (d * Math.PI) / 180;

/** Área de un anillo en m² (fórmula esférica, misma que @turf/area). */
function ringArea(coords: LonLat[]): number {
  const n = coords.length;
  if (n <= 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = coords[i]!;
    const p2 = coords[(i + 1) % n]!;
    const p3 = coords[(i + 2) % n]!;
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

/** Área de un polígono GeoJSON (anillo exterior menos huecos) en m². */
export function polygonAreaM2(rings: LonLat[][]): number {
  if (rings.length === 0) return 0;
  const [outer, ...holes] = rings;
  return holes.reduce((a, h) => a - ringArea(h), ringArea(outer!));
}

/** Rectángulo (en lon/lat) a partir de dos esquinas opuestas: útil para "dibujar rectángulo". */
export function rectangle(a: LonLat, b: LonLat): LonLat[][] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  return [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]];
}

export interface ControlPoint {
  /** Píxel en la imagen del plano [x, y] (origen arriba-izquierda). */
  px: [number, number];
  geo: LonLat;
}

export interface Affine {
  /** lon = a*x + b*y + c ; lat = d*x + e*y + f */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  /** Error medio cuadrático en metros sobre los puntos de control. */
  rmseMeters: number;
}

function solve3(m: number[][], v: number[]): number[] {
  // Eliminación gaussiana con pivoteo parcial para un sistema 3x3
  const A = m.map((row, i) => [...row, v[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    if (Math.abs(A[col]![col]!) < 1e-12) throw new Error("Puntos de control colineales: elija puntos bien distribuidos");
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const k = A[r]![col]! / A[col]![col]!;
      for (let c = col; c < 4; c++) A[r]![c]! -= k * A[col]![c]!;
    }
  }
  return [0, 1, 2].map((i) => A[i]![3]! / A[i]![i]!);
}

/** Ajuste afín por mínimos cuadrados (3 o más puntos de control). */
export function fitAffine(points: ControlPoint[]): Affine {
  if (points.length < 3) throw new Error("Se necesitan al menos 3 puntos de control");
  const N = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const p of points) {
    const row = [p.px[0], p.px[1], 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) N[i]![j]! += row[i]! * row[j]!;
      bx[i]! += row[i]! * p.geo[0];
      by[i]! += row[i]! * p.geo[1];
    }
  }
  const [a, b, c] = solve3(N, bx) as [number, number, number];
  const [d, e, f] = solve3(N, by) as [number, number, number];
  const tr = { a, b, c, d, e, f, rmseMeters: 0 };
  const sq = pointResiduals(tr, points).map((m) => m * m);
  tr.rmseMeters = Math.sqrt(sq.reduce((s, v) => s + v, 0) / sq.length);
  return tr;
}

/** Distancia en metros entre donde el ajuste ubica cada punto y donde se marcó en el mapa (delata el punto mal marcado). */
export function pointResiduals(t: Omit<Affine, "rmseMeters">, points: ControlPoint[]): number[] {
  return points.map((p) => {
    const [lon, lat] = pixelToGeo(t, p.px);
    const dx = rad(lon - p.geo[0]) * EARTH_RADIUS * Math.cos(rad(p.geo[1]));
    const dy = rad(lat - p.geo[1]) * EARTH_RADIUS;
    return Math.hypot(dx, dy);
  });
}

export function pixelToGeo(t: Omit<Affine, "rmseMeters">, [x, y]: [number, number]): LonLat {
  return [t.a * x + t.b * y + t.c, t.d * x + t.e * y + t.f];
}

/** Esquinas para ImageSource de MapLibre: [sup-izq, sup-der, inf-der, inf-izq]. */
export function imageCorners(t: Affine, width: number, height: number): [LonLat, LonLat, LonLat, LonLat] {
  return [pixelToGeo(t, [0, 0]), pixelToGeo(t, [width, 0]), pixelToGeo(t, [width, height]), pixelToGeo(t, [0, height])];
}

export type ZoneStatus = "not_started" | "in_progress" | "done";

/** Estado de una zona/elemento del plano para colorearlo. */
export function zoneStatus(executed: number, planned: number): ZoneStatus {
  if (executed <= 0) return "not_started";
  return executed >= planned - 1e-9 ? "done" : "in_progress";
}

export const ZONE_COLORS: Record<ZoneStatus, string> = {
  not_started: "#9CA3AF",
  in_progress: "#F59E0B",
  done: "#16A34A",
};
