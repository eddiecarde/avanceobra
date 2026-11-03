import { supabase } from "@/lib/supabase";

/** Llama al asistente (Edge Function ai-assist, modelos de Meta). Devuelve el resultado o un error en español. */
export async function callAi<T>(action: string, body: Record<string, unknown>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  const { data, error } = await supabase.functions.invoke("ai-assist", { body: { action, ...body } });
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { data: null, error: detail?.error ?? `El asistente no respondió: ${error.message}` };
  }
  return { data: data as T, error: null };
}

/** Archivo → base64 (sin el prefijo data:). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Foto reducida a JPEG de lado máximo `max` px (para no mandar fotos de 8 MB al modelo). */
export async function shrinkImage(file: Blob, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo leer la foto"))), "image/jpeg", 0.8));
  return fileToBase64(blob);
}

/** Audio grabado (webm/ogg) → WAV PCM 16 kHz mono, el formato que acepta Muse Voice Transcribe. */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Caja que marcó SAM 3.1 sobre una foto (en píxeles de la foto original). */
export interface AiBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c: number | null;
}
