import proj4 from "proj4";
import type { LonLat } from "@avanceobra/engine";

/** Sistemas de coordenadas habituales en planos de Colombia (MAGNA-SIRGAS y UTM). */
export const CRS = [
  {
    code: "EPSG:9377",
    label: "MAGNA-SIRGAS 2018 · Origen Nacional (CTM12)",
    def: "+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  },
  {
    code: "EPSG:3116",
    label: "MAGNA-SIRGAS · Colombia Bogotá",
    def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-74.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  },
  {
    code: "EPSG:3115",
    label: "MAGNA-SIRGAS · Colombia Oeste",
    def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-77.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  },
  {
    code: "EPSG:3117",
    label: "MAGNA-SIRGAS · Colombia Este Central",
    def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-71.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  },
  {
    code: "EPSG:3118",
    label: "MAGNA-SIRGAS · Colombia Este Este",
    def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-68.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  },
  { code: "EPSG:32618", label: "WGS 84 · UTM zona 18N", def: "+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs" },
  { code: "EPSG:32619", label: "WGS 84 · UTM zona 19N", def: "+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs" },
  { code: "EPSG:4326", label: "WGS 84 · latitud y longitud (grados)", def: "+proj=longlat +datum=WGS84 +no_defs" },
  { code: "EPSG:3857", label: "Web Mercator (Google, OpenStreetMap)", def: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs" },
] as const;

export type CrsCode = (typeof CRS)[number]["code"];

/** Función que pasa coordenadas planas del sistema elegido a lon/lat WGS84. */
export function toLonLat(code: CrsCode): (p: [number, number]) => LonLat {
  const def = CRS.find((c) => c.code === code)!.def;
  const conv = proj4(def, "WGS84");
  return (p) => conv.forward(p) as LonLat;
}

const inColombia = ([lon, lat]: LonLat) => lon > -82 && lon < -66 && lat > -4.5 && lat < 13.6;

/**
 * Adivina el sistema del dibujo: el que deja el centro dentro de Colombia y, si se conoce dónde
 * queda la obra (planos o elementos ya cargados), el que lo deja más cerca de ella.
 */
export function guessCrs(center: [number, number], near: LonLat | null): CrsCode | null {
  const cands = CRS.map((c) => ({ code: c.code, at: toLonLat(c.code)(center) })).filter((c) => Number.isFinite(c.at[0]) && inColombia(c.at));
  if (!cands.length) return null;
  if (!near) return cands[0]!.code;
  const d = (a: LonLat) => Math.hypot(a[0] - near[0], a[1] - near[1]);
  return cands.sort((a, b) => d(a.at) - d(b.at))[0]!.code;
}

/** Código EPSG de un archivo (p. ej. 9377 de un GeoTIFF) si es uno de los sistemas conocidos. */
export function crsFromEpsg(epsg: number | null | undefined): CrsCode | null {
  // 900913 es el código antiguo de Web Mercator; 4686 es MAGNA-SIRGAS geográfico (equivale a WGS 84 a esta escala)
  const alias: Record<number, number> = { 900913: 3857, 3785: 3857, 102100: 3857, 4686: 4326 };
  const n = epsg == null ? null : (alias[epsg] ?? epsg);
  return (CRS.find((c) => c.code === `EPSG:${n}`)?.code as CrsCode | undefined) ?? null;
}
