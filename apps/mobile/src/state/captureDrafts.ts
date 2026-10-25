import { useEffect, useRef } from "react";
import { draftKey, hasContent, parseDraft, serializeDraft, type CaptureDraft } from "../core/captureDraft";
import { db } from "../db/database";

type DraftBody = Omit<CaptureDraft, "v" | "savedAt">;

export async function loadDraft(userId: string, activityId: string): Promise<CaptureDraft | null> {
  const row = await db.getOptional<{ data: string }>("SELECT data FROM capture_drafts WHERE id = ?", [draftKey(userId, activityId)]);
  return parseDraft(row?.data);
}

export async function saveDraft(userId: string, d: DraftBody) {
  const id = draftKey(userId, d.activityId);
  if (!hasContent(d)) {
    await db.execute("DELETE FROM capture_drafts WHERE id = ?", [id]);
    return;
  }
  await db.execute(
    `INSERT OR REPLACE INTO capture_drafts (id, user_id, activity_id, front_id, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, d.activityId, d.frontId, serializeDraft(d), new Date().toISOString()],
  );
}

export async function deleteDraft(userId: string, activityId: string) {
  await db.execute("DELETE FROM capture_drafts WHERE id = ?", [draftKey(userId, activityId)]);
}

/**
 * Guarda el borrador medio segundo después de cada cambio (y al salir de la pantalla).
 * `enabled` evita sobrescribir el borrador antes de haberlo cargado.
 */
export function useAutosaveDraft(userId: string | null, draft: DraftBody, enabled: boolean) {
  const latest = useRef(draft);
  latest.current = draft;
  /** Se apaga al guardar el registro o descartar el borrador, para no recrearlo al salir. */
  const active = useRef(true);
  const json = JSON.stringify(draft);

  useEffect(() => {
    if (!enabled || !userId || !active.current) return;
    const t = setTimeout(() => void saveDraft(userId, latest.current).catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, [json, enabled, userId]);

  // Al desmontar (salir de la pantalla) se guarda de inmediato lo último.
  useEffect(() => {
    return () => {
      if (enabled && userId && active.current) void saveDraft(userId, latest.current).catch(() => undefined);
    };
  }, [enabled, userId]);

  return {
    /** Deja de guardar y borra el borrador (después de guardar el registro o al descartar). */
    finish: async () => {
      active.current = false;
      if (userId) await deleteDraft(userId, latest.current.activityId);
    },
    /** Vuelve a guardar (al descartar un borrador recuperado y empezar de nuevo). */
    resume: () => {
      active.current = true;
    },
  };
}
