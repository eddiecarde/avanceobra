"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Campo en la web (PWA): lo que se registra se guarda primero en el teléfono (IndexedDB, con sus
 * fotos) y se sube solo cuando hay señal, en orden y sin duplicar (cada cosa lleva su id desde el
 * teléfono; si el servidor ya la tiene, cuenta como subida). Mismo formato que la app nativa.
 */

export type QueueKind = "entry" | "log" | "finding";

export interface QueuedPhoto {
  id: string;
  blob: Blob;
  takenAt: string;
}

export interface QueueItem {
  id: string;
  kind: QueueKind;
  projectId: string;
  /** Fila tal como se inserta (sin las fotos). */
  row: Record<string, unknown>;
  photos: QueuedPhoto[];
  /** Fotos ya subidas (si se cortó a mitad). */
  done: string[];
  label: string;
  createdAt: string;
  attempts: number;
  error: string | null;
}

const DB = "avanceobra-campo";
const STORE = "cola";
const EVENT = "avanceobra-cola";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}

const notify = () => window.dispatchEvent(new Event(EVENT));

export async function enqueue(item: Omit<QueueItem, "done" | "attempts" | "error" | "createdAt">) {
  await tx("readwrite", (s) => s.put({ ...item, done: [], attempts: 0, error: null, createdAt: new Date().toISOString() }));
  notify();
  void processQueue();
}

export async function listQueue(): Promise<QueueItem[]> {
  const all = await tx<QueueItem[]>("readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Avisa cuando la cola cambia (para mostrar cuánto falta por subir). */
export function onQueueChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

const TABLE: Record<QueueKind, string> = { entry: "progress_entries", log: "daily_logs", finding: "findings" };
const isDuplicate = (e: { code?: string; message?: string } | null) => !!e && (e.code === "23505" || /duplicate key/i.test(e.message ?? ""));

let running: Promise<number> | null = null;

/** Sube lo pendiente, en orden. Devuelve cuántos quedaron subidos. */
export function processQueue(): Promise<number> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

/** lat/lon del teléfono → `location` (PostGIS); en el servidor lat y lon se calculan solos y no se pueden escribir. */
export function toServerRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!("lat" in row) && !("lon" in row)) return row;
  const { lat, lon, ...rest } = row;
  return typeof lat === "number" && typeof lon === "number" ? { ...rest, location: `SRID=4326;POINT(${lon} ${lat})` } : rest;
}

async function run(): Promise<number> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  let sent = 0;
  for (const item of await listQueue()) {
    try {
      // 1) La fila (si ya estaba, no se duplica)
      const { error } = await supabase.from(TABLE[item.kind]).insert(toServerRow(item.row));
      if (error && !isDuplicate(error)) throw new Error(error.message);
      // 2) Las fotos: el archivo y su registro
      for (const p of item.photos) {
        if (item.done.includes(p.id)) continue;
        const path = `${item.projectId}/${item.id}/${p.id}.jpg`;
        const up = await supabase.storage.from("photos").upload(path, p.blob, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw new Error(up.error.message);
        const ph = await supabase.from("photos").insert({
          id: p.id,
          project_id: item.projectId,
          entry_id: item.kind === "entry" ? item.id : null,
          finding_id: item.kind === "finding" ? item.id : null,
          storage_path: path,
          taken_at: p.takenAt,
          uploaded: true,
          purpose: item.kind === "finding" ? "hallazgo" : "avance",
        });
        if (ph.error && !isDuplicate(ph.error)) throw new Error(ph.error.message);
        item.done.push(p.id);
        await tx("readwrite", (s) => s.put(item));
      }
      await tx("readwrite", (s) => s.delete(item.id));
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await tx("readwrite", (s) => s.put({ ...item, attempts: item.attempts + 1, error: /fetch|network|Failed/i.test(msg) ? "Sin señal" : msg }));
      // Un error de red corta la ronda; uno de datos deja seguir con lo siguiente
      if (/fetch|network|Failed/i.test(msg)) break;
    }
    notify();
  }
  notify();
  return sent;
}

// ---------------------------------------------------------------- catálogo para trabajar sin señal

export interface FieldActivity {
  id: string;
  code: string;
  name: string;
  unit: string;
  contract_qty: number;
  front_id: string;
  executed: number;
}
export interface FieldCatalog {
  projectId: string;
  fronts: { id: string; code: string; name: string }[];
  activities: FieldActivity[];
  roles: string[];
  equipment: string[];
  savedAt: string;
}

const catKey = (p: string) => `avanceobra:campo:${p}`;

export function cachedCatalog(projectId: string): FieldCatalog | null {
  try {
    const s = localStorage.getItem(catKey(projectId));
    return s ? (JSON.parse(s) as FieldCatalog) : null;
  } catch {
    return null;
  }
}

/** Frentes, actividades y catálogos de la obra; sin señal, la última copia guardada en el teléfono. */
export async function loadCatalog(projectId: string): Promise<FieldCatalog | null> {
  try {
    const [f, a, p, prj] = await Promise.all([
      supabase.from("fronts").select("id, code, name").eq("project_id", projectId).order("code"),
      supabase.from("activities").select("id, code, name, unit, contract_qty, front_id").eq("project_id", projectId).order("code").limit(5000),
      supabase.from("activity_progress").select("activity_id, executed_qty").eq("project_id", projectId).limit(5000),
      supabase.from("projects").select("personnel_roles, equipment_types").eq("id", projectId).single(),
    ]);
    if (f.error || a.error) throw new Error((f.error ?? a.error)!.message);
    const done = new Map(((p.data ?? []) as { activity_id: string; executed_qty: number }[]).map((x) => [x.activity_id, Number(x.executed_qty)]));
    const cat: FieldCatalog = {
      projectId,
      fronts: (f.data ?? []) as FieldCatalog["fronts"],
      activities: ((a.data ?? []) as Omit<FieldActivity, "executed">[]).map((x) => ({ ...x, contract_qty: Number(x.contract_qty), executed: done.get(x.id) ?? 0 })),
      roles: (prj.data?.personnel_roles as string[] | null) ?? [],
      equipment: (prj.data?.equipment_types as string[] | null) ?? [],
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(catKey(projectId), JSON.stringify(cat));
    } catch {
      // sin espacio: se trabaja con lo que haya
    }
    return cat;
  } catch {
    return cachedCatalog(projectId);
  }
}

/** Catálogo de la obra: la copia del teléfono al instante y la del servidor cuando responde. */
export function useCatalog(projectId: string): FieldCatalog | null {
  const [cat, setCat] = useState<{ projectId: string; value: FieldCatalog | null } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.resolve(cachedCatalog(projectId)).then((value) => !off && value && setCat({ projectId, value }));
    void loadCatalog(projectId).then((value) => !off && value && setCat({ projectId, value }));
    return () => {
      off = true;
    };
  }, [projectId]);
  return cat?.projectId === projectId ? cat.value : null;
}

// ---------------------------------------------------------------- fotos y ubicación

/** Foto reducida (lado máximo 1600 px) con marca de agua: fecha, hora y GPS. */
export async function photoToJpeg(file: Blob, stamp: string): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const g = canvas.getContext("2d")!;
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const size = Math.max(14, Math.round(canvas.width / 45));
  g.font = `bold ${size}px sans-serif`;
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.fillRect(0, canvas.height - size * 1.8, canvas.width, size * 1.8);
  g.fillStyle = "#fff";
  g.fillText(stamp, size * 0.6, canvas.height - size * 0.55);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo leer la foto"))), "image/jpeg", 0.75));
}

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number | null;
}

/** Ubicación del teléfono (si la persona da permiso); no detiene el registro si no hay. */
export function getFix(timeoutMs = 8000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export const newId = () => crypto.randomUUID();

/** Identificador del navegador (queda en cada registro, como el del teléfono). */
export function deviceId() {
  try {
    let id = localStorage.getItem("avanceobra:dispositivo");
    if (!id) localStorage.setItem("avanceobra:dispositivo", (id = `web-${crypto.randomUUID()}`));
    return id;
  } catch {
    return "web";
  }
}

/** Hoy en Colombia (YYYY-MM-DD) y fecha/hora para la marca de agua. */
export const bogota = (d = new Date()) => new Date(d.getTime() - 5 * 3_600_000).toISOString();
