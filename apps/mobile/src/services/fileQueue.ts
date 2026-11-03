import NetInfo from "@react-native-community/netinfo";
import { File } from "expo-file-system";
import { isDue, nextAttemptAt } from "../core/backoff";
import { db } from "../db/database";
import type { FileQueueRow } from "../db/schema";
import { newId, nowIso } from "./ids";
import { supabase } from "./supabase";

/**
 * Cola de archivos (fotos y firmas) con subida diferida.
 * La fila de la foto viaja por la cola CRUD de PowerSync; el binario va por aquí,
 * directo a Supabase Storage, con backoff exponencial entre intentos.
 */

export interface EnqueueInput {
  bucket: "photos";
  storagePath: string;
  localUri: string;
  contentType: string;
  photoId?: string | null;
}

/** Se llama dentro de la misma transacción que crea el registro. */
export function enqueueSql(input: EnqueueInput): [string, unknown[]] {
  return [
    `INSERT INTO file_queue (id, bucket, storage_path, local_uri, content_type, photo_id, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    [newId(), input.bucket, input.storagePath, input.localUri, input.contentType, input.photoId ?? null, nowIso()],
  ];
}

let running = false;

/** Procesa los archivos vencidos. Devuelve cuántos subió. */
export async function processFileQueue(): Promise<number> {
  if (running) return 0;
  const net = await NetInfo.fetch();
  if (!net.isConnected) return 0;
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return 0;

  running = true;
  let uploaded = 0;
  try {
    const now = new Date();
    const rows = await db.getAll<FileQueueRow & { id: string }>(
      "SELECT * FROM file_queue ORDER BY created_at LIMIT 20",
    );
    for (const row of rows) {
      if (!isDue(row.next_attempt_at, now)) continue;
      try {
        const file = new File(row.local_uri!);
        if (!file.exists) {
          // El archivo se perdió (limpieza del sistema): se registra y se descarta.
          await db.execute("DELETE FROM file_queue WHERE id = ?", [row.id]);
          continue;
        }
        const bytes = await file.bytes();
        const { error } = await supabase.storage
          .from(row.bucket!)
          .upload(row.storage_path!, bytes, { contentType: row.content_type ?? "image/jpeg", upsert: true });
        if (error) throw error;
        await db.writeTransaction(async (tx) => {
          await tx.execute("DELETE FROM file_queue WHERE id = ?", [row.id]);
          if (row.photo_id) await tx.execute("UPDATE photos SET uploaded = 1 WHERE id = ?", [row.photo_id]);
        });
        uploaded++;
      } catch (err) {
        const attempts = (row.attempts ?? 0) + 1;
        await db.execute("UPDATE file_queue SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?", [
          attempts,
          nextAttemptAt(new Date(), attempts),
          String((err as Error).message ?? err).slice(0, 300),
          row.id,
        ]);
      }
    }
  } finally {
    running = false;
  }
  return uploaded;
}

let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribeNet: (() => void) | null = null;

/** Arranca el procesamiento periódico y al recuperar señal. */
export function startFileQueue(intervalMs = 15_000) {
  if (timer) return;
  timer = setInterval(() => void processFileQueue(), intervalMs);
  unsubscribeNet = NetInfo.addEventListener((s) => {
    if (s.isConnected) {
      // Al volver la señal se reintenta de inmediato todo lo pendiente.
      void db.execute("UPDATE file_queue SET next_attempt_at = NULL").then(processFileQueue);
    }
  });
  void processFileQueue();
}

export function stopFileQueue() {
  if (timer) clearInterval(timer);
  timer = null;
  unsubscribeNet?.();
  unsubscribeNet = null;
}
