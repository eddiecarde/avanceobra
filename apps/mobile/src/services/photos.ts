import { Skia, ImageFormat, matchFont } from "@shopify/react-native-skia";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { watermarkLines, type WatermarkInfo } from "../core/watermark";

/** Lado mayor de la foto guardada: suficiente para evidenciar obra, liviano para subir con poca señal. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.7;

export const photosDir = () => new Directory(Paths.document, "photos");
export const signaturesDir = () => new Directory(Paths.document, "signatures");

/** El archivo local de una foto se deriva de su id: no depende de columnas que el servidor sobrescriba. */
export const localPhotoFile = (photoId: string) => new File(photosDir(), `${photoId}.jpg`);
export const localSignatureFile = (entryId: string) => new File(signaturesDir(), `${entryId}.png`);

function ensureDir(d: Directory) {
  if (!d.exists) d.create({ intermediates: true });
}

export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ quality: 0.9, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  return res.assets[0].uri;
}

/** Comprime, aplica la marca de agua y guarda la foto en almacenamiento permanente. */
export async function processPhoto(sourceUri: string, photoId: string, info: WatermarkInfo): Promise<File> {
  ensureDir(photosDir());
  const ctx = ImageManipulator.manipulate(sourceUri);
  ctx.resize({ width: MAX_SIDE });
  const rendered = await ctx.renderAsync();
  const resized = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });

  const target = localPhotoFile(photoId);
  try {
    const bytes = await new File(resized.uri).bytes();
    const base64 = drawWatermark(bytes, watermarkLines(info));
    target.write(base64, { encoding: "base64" });
  } catch {
    // Si la marca de agua falla (memoria), se conserva la foto comprimida: la evidencia no se pierde.
    new File(resized.uri).copySync(target, { overwrite: true });
  }
  return target;
}

/** Dibuja una franja inferior semitransparente con fecha, hora y coordenadas (Skia, sin red). */
function drawWatermark(bytes: Uint8Array, lines: string[]): string {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error("No se pudo decodificar la foto");
  const w = image.width();
  const h = image.height();
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error("Sin superficie de dibujo");
  const canvas = surface.getCanvas();
  canvas.drawImage(image, 0, 0);

  const fontSize = Math.round(w / 40);
  const font = matchFont({ fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }), fontSize, fontWeight: "bold" });
  const lineH = fontSize * 1.35;
  const boxH = lineH * lines.length + fontSize * 0.8;

  const bg = Skia.Paint();
  bg.setColor(Skia.Color("rgba(0,0,0,0.55)"));
  canvas.drawRect(Skia.XYWHRect(0, h - boxH, w, boxH), bg);

  const fg = Skia.Paint();
  fg.setColor(Skia.Color("#FFFFFF"));
  lines.forEach((line, i) => canvas.drawText(line, fontSize * 0.6, h - boxH + fontSize * 0.4 + lineH * (i + 1) - fontSize * 0.3, fg, font));

  surface.flush();
  return surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, Math.round(JPEG_QUALITY * 100));
}

/** Guarda la firma (PNG en base64 desde el lienzo) en almacenamiento permanente. */
export function saveSignature(entryId: string, base64Png: string): File {
  ensureDir(signaturesDir());
  const f = localSignatureFile(entryId);
  f.write(base64Png, { encoding: "base64" });
  return f;
}
