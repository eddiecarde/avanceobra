"use client";

import type { LonLat } from "@avanceobra/engine";
import { crsFromEpsg, type CrsCode } from "@/lib/crs";
import { MAX_SIDE, type PlanImage } from "@/lib/plans";

type XY = [number, number];
type Quad = [XY, XY, XY, XY];

/** Plano que ya trae su ubicación: esquinas [sup-izq, sup-der, inf-der, inf-izq] en el sistema del archivo. */
export interface GeoPlan {
  image: PlanImage;
  quad: Quad;
  /** Sistema de coordenadas leído del archivo; null si hay que elegirlo (archivo de mundo sin .prj). */
  crs: CrsCode | null;
  source: "geotiff" | "kml" | "worldfile" | "geopdf";
  detail: string;
}

const ext = (f: File) => f.name.toLowerCase().split(".").pop() ?? "";
const WORLD = ["jgw", "jpgw", "pgw", "pngw", "tfw", "tifw", "wld"];

/** Archivos que delatan un plano georreferenciado (si no hay ninguno, se ancla con puntos). */
export const isGeoreferenced = (files: File[]) => files.some((f) => ["tif", "tiff", "kml", "kmz"].includes(ext(f)) || WORLD.includes(ext(f)));

function fitSize(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

async function toPlanImage(canvas: HTMLCanvasElement, format: PlanImage["format"]): Promise<PlanImage> {
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo convertir la imagen"))), "image/jpeg", 0.88));
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, format, pages: 1 };
}

/** Imagen común (PNG/JPG o la de un KMZ) reducida a 4096 px, con fondo blanco. */
async function drawImage(src: Blob, format: PlanImage["format"]): Promise<{ image: PlanImage; srcWidth: number; srcHeight: number }> {
  const bmp = await createImageBitmap(src);
  const { width, height } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  const out = { image: await toPlanImage(canvas, format), srcWidth: bmp.width, srcHeight: bmp.height };
  bmp.close();
  return out;
}

/** Sistema de coordenadas a partir del texto de un .prj (WKT de ArcGIS/QGIS/AutoCAD). */
export function crsFromPrj(wkt: string): CrsCode | null {
  const auth = [...wkt.matchAll(/AUTHORITY\["EPSG",\s*"?(\d+)"?\]/gi)].at(-1)?.[1] ?? wkt.match(/ID\["EPSG",\s*(\d+)\]\s*\]\s*$/i)?.[1];
  if (auth && crsFromEpsg(Number(auth))) return crsFromEpsg(Number(auth));
  const w = wkt.replace(/[\s-]/g, "_").toLowerCase();
  if (/origen_nacional|ctm12/.test(w)) return "EPSG:9377";
  if (/colombia_bogota|bogota_zone/.test(w)) return "EPSG:3116";
  if (/colombia_west|colombia_oeste/.test(w)) return "EPSG:3115";
  if (/east_central|este_central/.test(w)) return "EPSG:3117";
  if (/colombia_east|este_este/.test(w)) return "EPSG:3118";
  if (/utm_zone_18n|utm_18n|zone_18n/.test(w)) return "EPSG:32618";
  if (/utm_zone_19n|utm_19n|zone_19n/.test(w)) return "EPSG:32619";
  if (/pseudo_mercator|mercator_auxiliary_sphere|web_mercator/.test(w)) return "EPSG:3857";
  if (!/projcs|projcrs/.test(w) && /wgs_1984|wgs_84|magna/.test(w)) return "EPSG:4326";
  return null;
}

/** Archivo de mundo: A, D, B, E, C, F (C y F son el centro del píxel de arriba a la izquierda). */
export function parseWorldFile(text: string): [number, number, number, number, number, number] {
  const v = text.split(/\s+/).filter(Boolean).map((x) => Number(x.replace(",", ".")));
  if (v.length < 6 || v.slice(0, 6).some((x) => !Number.isFinite(x))) throw new Error("El archivo de mundo no tiene los 6 números esperados");
  return v.slice(0, 6) as [number, number, number, number, number, number];
}

/** Esquinas de una imagen de w×h píxeles según su archivo de mundo (bordes, no centros de píxel). */
export function worldQuad([A, D, B, E, C, F]: number[], w: number, h: number): Quad {
  const at = (col: number, row: number): XY => [A! * col + B! * row + C!, D! * col + E! * row + F!];
  return [at(-0.5, -0.5), at(w - 0.5, -0.5), at(w - 0.5, h - 0.5), at(-0.5, h - 0.5)];
}

/** Esquinas de un LatLonBox de KML, girado `rotation` grados (antihorario) sobre su centro. */
export function latLonBoxQuad(n: number, s: number, e: number, w: number, rotation: number): Quad {
  const cx = (e + w) / 2;
  const cy = (n + s) / 2;
  const k = Math.cos((cy * Math.PI) / 180);
  const r = (rotation * Math.PI) / 180;
  const rot = ([x, y]: XY): XY => {
    const dx = (x - cx) * k;
    const dy = y - cy;
    return [cx + (dx * Math.cos(r) - dy * Math.sin(r)) / k, cy + dx * Math.sin(r) + dy * Math.cos(r)];
  };
  return [rot([w, n]), rot([e, n]), rot([e, s]), rot([w, s])];
}

/** Primera superposición de imagen (GroundOverlay) de un KML: imagen y esquinas en lon/lat. */
export function parseGroundOverlay(kml: string): { href: string; quad: Quad; name: string } {
  const doc = new DOMParser().parseFromString(kml, "application/xml");
  const ov = doc.getElementsByTagName("GroundOverlay")[0];
  if (!ov) throw new Error("El KML no trae una imagen superpuesta (GroundOverlay). En Google Earth: Agregar → Superposición de imagen.");
  const txt = (el: Element | Document, tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  const href = txt(ov, "href");
  const name = txt(ov, "name");
  const quadText = ov.getElementsByTagName("gx:LatLonQuad")[0] ?? ov.getElementsByTagNameNS("*", "LatLonQuad")[0];
  if (quadText) {
    // Orden de KML: inf-izq, inf-der, sup-der, sup-izq
    const p = txt(quadText, "coordinates")
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => c.split(",").map(Number) as XY);
    if (p.length < 4) throw new Error("La superposición del KML no tiene sus 4 esquinas");
    return { href, name, quad: [p[3]!, p[2]!, p[1]!, p[0]!] };
  }
  const box = ov.getElementsByTagName("LatLonBox")[0];
  if (!box) throw new Error("La superposición del KML no dice dónde va (sin LatLonBox)");
  const num = (t: string) => Number(txt(box, t) || 0);
  return { href, name, quad: latLonBoxQuad(num("north"), num("south"), num("east"), num("west"), num("rotation")) };
}

async function readGeoTiff(tif: File, world: File | null, prj: File | null): Promise<GeoPlan> {
  const { fromBlob } = await import("geotiff");
  const tiff = await fromBlob(tif);
  const img = await tiff.getImage();
  const w = img.getWidth();
  const h = img.getHeight();
  const size = fitSize(w, h);
  const rgb = (await img.readRGB({ interleave: true, width: size.width, height: size.height, enableAlpha: false })) as unknown as Uint8Array & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(size.width, size.height);
  for (let i = 0, j = 0; i < size.width * size.height; i++, j += 3) {
    data.data[i * 4] = rgb[j]!;
    data.data[i * 4 + 1] = rgb[j + 1]!;
    data.data[i * 4 + 2] = rgb[j + 2]!;
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const image = await toPlanImage(canvas, "jpg");

  const keys = img.getGeoKeys() ?? {};
  const epsg = (keys.ProjectedCSTypeGeoKey as number | undefined) ?? (keys.GeographicTypeGeoKey as number | undefined);
  let quad: Quad | null = null;
  try {
    const [x0, y0] = img.getOrigin() as XY;
    const [rx, ry] = img.getResolution() as XY;
    quad = [[x0, y0], [x0 + w * rx, y0], [x0 + w * rx, y0 + h * ry], [x0, y0 + h * ry]];
  } catch {
    // Sin coordenadas internas: puede venir con archivo de mundo (.tfw)
  }
  if (!quad && world) quad = worldQuad(parseWorldFile(await world.text()), w, h);
  if (!quad) throw new Error("El TIFF no trae coordenadas (ni archivo .tfw): ánclalo con puntos o expórtalo como GeoTIFF.");
  const crs = crsFromEpsg(epsg) ?? (prj ? crsFromPrj(await prj.text()) : null);
  return { image, quad, crs, source: "geotiff", detail: `${w} × ${h} px${epsg ? ` · EPSG:${epsg}` : ""}` };
}

async function readKml(files: File[]): Promise<GeoPlan> {
  const kmz = files.find((f) => ext(f) === "kmz");
  if (kmz) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(kmz);
    const kmlFile = zip.file("doc.kml") ?? zip.file(/\.kml$/i)[0];
    if (!kmlFile) throw new Error("El KMZ no contiene un archivo KML");
    const ov = parseGroundOverlay(await kmlFile.async("text"));
    if (/^https?:/i.test(ov.href)) throw new Error("La imagen del KMZ está en internet: guárdalo de nuevo en Google Earth incluyendo la imagen.");
    const path = decodeURIComponent(ov.href);
    const entry = zip.file(path) ?? zip.file(new RegExp(`${path.split("/").pop()!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"))[0];
    if (!entry) throw new Error(`El KMZ no trae la imagen ${ov.href}`);
    const { image } = await drawImage(await entry.async("blob"), "jpg");
    return { image, quad: ov.quad, crs: "EPSG:4326", source: "kml", detail: ov.name || kmz.name };
  }
  const kml = files.find((f) => ext(f) === "kml")!;
  const ov = parseGroundOverlay(await kml.text());
  const base = decodeURIComponent(ov.href).split(/[\\/]/).pop()!.toLowerCase();
  const pic = files.find((f) => f.name.toLowerCase() === base);
  if (!pic) throw new Error(`El KML usa la imagen "${base}": selecciónala junto con el KML (o usa el KMZ, que la incluye).`);
  const { image } = await drawImage(pic, "jpg");
  return { image, quad: ov.quad, crs: "EPSG:4326", source: "kml", detail: ov.name || kml.name };
}

/**
 * Lee un plano georreferenciado: GeoTIFF (con .tfw/.prj opcionales), KMZ/KML de Google Earth, o
 * imagen PNG/JPG con su archivo de mundo (.pgw/.jgw/.wld) y .prj opcional.
 */
export async function readGeoreferenced(files: File[]): Promise<GeoPlan> {
  const world = files.find((f) => WORLD.includes(ext(f))) ?? null;
  const prj = files.find((f) => ext(f) === "prj") ?? null;
  const tif = files.find((f) => ["tif", "tiff"].includes(ext(f)));
  if (tif) return readGeoTiff(tif, world, prj);
  if (files.some((f) => ["kml", "kmz"].includes(ext(f)))) return readKml(files);
  const pic = files.find((f) => ["png", "jpg", "jpeg"].includes(ext(f)));
  if (!pic || !world) throw new Error("Para el archivo de mundo, selecciona juntos la imagen (PNG o JPG) y su .pgw/.jgw (y el .prj si lo tienes).");
  const { image, srcWidth, srcHeight } = await drawImage(pic, ext(pic) === "png" ? "png" : "jpg");
  const crs = prj ? crsFromPrj(await prj.text()) : null;
  return { image, quad: worldQuad(parseWorldFile(await world.text()), srcWidth, srcHeight), crs, source: "worldfile", detail: `${pic.name} + ${world.name}` };
}

/** Esquinas en lon/lat para MapLibre. */
export const quadToLonLat = (q: Quad, f: (p: XY) => LonLat) => q.map(f) as [LonLat, LonLat, LonLat, LonLat];
