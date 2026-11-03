"use client";

import type { ControlPoint } from "@avanceobra/engine";
import { readGeoPdf } from "@/lib/geopdf";

/**
 * Planos: el PDF (o la imagen) se convierte en el navegador a un JPG de máximo 4096 px por lado,
 * que es lo que los teléfonos pueden mostrar como textura del mapa sin señal.
 */

/** Lado máximo de la imagen: límite de textura de muchos teléfonos Android. */
export const MAX_SIDE = 4096;

export interface PlanImage {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  format: "pdf" | "png" | "jpg";
  pages: number;
  /** PDF georreferenciado: puntos de control ya en píxeles de esta imagen. */
  geoPoints?: ControlPoint[];
  geoEpsg?: number | null;
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo convertir el plano a imagen"))), "image/jpeg", 0.88));
}

function fit(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

async function finish(canvas: HTMLCanvasElement, format: PlanImage["format"], pages: number): Promise<PlanImage> {
  const blob = await canvasToJpeg(canvas);
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, format, pages };
}

/** Página de un PDF a JPG, con fondo blanco (los planos suelen venir con fondo transparente). */
async function renderPdf(file: File, page: number): Promise<PlanImage> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const bytes = await file.arrayBuffer();
  // pdf.js se queda con el buffer que recibe: se le pasa una copia
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const doc = await task.promise;
  try {
    const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
    const base = p.getViewport({ scale: 1 });
    const { width } = fit(base.width * 8, base.height * 8);
    const viewport = p.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.render({ canvas, viewport, background: "#fff" }).promise;
    const out = await finish(canvas, "pdf", doc.numPages);
    // Georreferencia del PDF: los puntos de la página pasan a píxeles con la misma vista (recorte y giro incluidos)
    const geo = await readGeoPdf(bytes, page);
    if (geo) {
      out.geoPoints = geo.points.map((g) => ({ px: viewport.convertToViewportPoint(g.page[0], g.page[1]) as [number, number], geo: g.geo }));
      out.geoEpsg = geo.epsg;
    }
    return out;
  } finally {
    void task.destroy();
  }
}

async function renderImage(file: File): Promise<PlanImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fit(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return finish(canvas, /png$/i.test(file.type) || /\.png$/i.test(file.name) ? "png" : "jpg", 1);
}

/** Convierte el archivo elegido (PDF, PNG o JPG) en la imagen que se sube y se ancla. */
export async function planImageFrom(file: File, page = 1): Promise<PlanImage> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return renderPdf(file, page);
  if (/^image\/(png|jpe?g)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name)) return renderImage(file);
  throw new Error("Formato no soportado: usa PDF, PNG o JPG. Si tienes DWG, guárdalo como PDF desde AutoCAD.");
}

/** Mapa satelital para reconocer puntos del terreno (estilo en línea: no depende de descargar un estilo). */
export const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    sat: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imágenes © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "fondo", type: "background" as const, paint: { "background-color": "#dfe3e8" } },
    { id: "sat", type: "raster" as const, source: "sat" },
  ],
};
