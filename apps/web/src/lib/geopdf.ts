/**
 * PDF georreferenciado (ISO 32000, como lo exportan ArcGIS, QGIS, Global Mapper o AutoCAD Map):
 * cada página puede traer visores (/VP) con una medida /GEO que relaciona puntos del recuadro del
 * mapa (/LPTS, en fracción del /BBox) con latitud y longitud (/GPTS). Aquí se leen esos puntos en
 * coordenadas de la página; quien dibuja la página los pasa a píxeles.
 */

import type { LonLat } from "@avanceobra/engine";
import type { PDFArray as PdfArray } from "pdf-lib";

export interface GeoPdfPoint {
  /** Punto en el espacio de la página PDF (puntos, origen abajo-izquierda). */
  page: [number, number];
  geo: LonLat;
}

export interface GeoPdfPage {
  points: GeoPdfPoint[];
  /** EPSG del sistema del mapa, si el PDF lo declara (informativo: los puntos ya vienen en lat/lon). */
  epsg: number | null;
}

/** Puntos de georreferencia de una página (1 = primera), o null si la página no los trae. */
export async function readGeoPdf(data: ArrayBuffer, pageNumber: number): Promise<GeoPdfPage | null> {
  const { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } = await import("pdf-lib");
  let doc;
  try {
    doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return null;
  }
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return null;
  const nums = (arr: PdfArray | undefined) => (arr ? arr.asArray().map((_, i) => arr.lookupMaybe(i, PDFNumber)?.asNumber() ?? NaN) : []);

  const vps = page.node.lookupMaybe(PDFName.of("VP"), PDFArray);
  if (!vps) return null;
  let best: { area: number; result: GeoPdfPage } | null = null;
  for (let i = 0; i < vps.size(); i++) {
    const vp = vps.lookupMaybe(i, PDFDict);
    const measure = vp?.lookupMaybe(PDFName.of("Measure"), PDFDict);
    if (!vp || !measure || measure.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() !== "/GEO") continue;
    const [x1, y1, x2, y2] = nums(vp.lookupMaybe(PDFName.of("BBox"), PDFArray));
    const gpts = nums(measure.lookupMaybe(PDFName.of("GPTS"), PDFArray));
    // Sin /LPTS los puntos corresponden a /Bounds (por defecto, las esquinas del recuadro)
    const lpts = nums(measure.lookupMaybe(PDFName.of("LPTS"), PDFArray) ?? measure.lookupMaybe(PDFName.of("Bounds"), PDFArray));
    const l = lpts.length ? lpts : [0, 0, 0, 1, 1, 1, 1, 0];
    if (![x1, y1, x2, y2].every(Number.isFinite) || gpts.length < 6 || gpts.length !== l.length) continue;
    const points: GeoPdfPoint[] = [];
    for (let k = 0; k + 1 < gpts.length; k += 2) {
      // GPTS va en pares latitud, longitud
      const lat = gpts[k]!;
      const lon = gpts[k + 1]!;
      const u = l[k]!;
      const v = l[k + 1]!;
      if ([lat, lon, u, v].every(Number.isFinite)) points.push({ page: [x1! + u * (x2! - x1!), y1! + v * (y2! - y1!)], geo: [lon, lat] });
    }
    if (points.length < 3) continue;
    const gcs = measure.lookupMaybe(PDFName.of("GCS"), PDFDict);
    const epsg = gcs?.lookupMaybe(PDFName.of("EPSG"), PDFNumber)?.asNumber() ?? null;
    const area = Math.abs((x2! - x1!) * (y2! - y1!));
    // Si hay varios visores (mapa principal y mapa de ubicación), vale el más grande
    if (!best || area > best.area) best = { area, result: { points, epsg } };
  }
  return best?.result ?? null;
}
