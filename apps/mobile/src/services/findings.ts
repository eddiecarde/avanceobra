import type { FindingStatus, FindingType, Severity } from "@avanceobra/shared";
import { db } from "../db/database";
import type { FindingCategory } from "../core/findings";
import type { PhotoDraft } from "./entries";
import { enqueueSql } from "./fileQueue";
import { newId, nowIso } from "./ids";
import { notifyLocal } from "./notifications";

export interface FindingDraft {
  projectId: string;
  frontId: string | null;
  type: FindingType;
  severity: Severity;
  description: string;
  responsibleUserId: string | null;
  dueDate: string | null;
  fix: { lat: number; lon: number } | null;
  photos: PhotoDraft[];
  userId: string;
  category: FindingCategory;
  /** Detiene la obra (restricción): sale en el panel como impeditivo. */
  impeditive: boolean;
  activityId: string | null;
}

export async function createFinding(d: FindingDraft): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO findings (id, project_id, front_id, type, severity, status, description, lat, lon,
         responsible_user_id, due_date, created_by, created_at, updated_at, version, category, impeditive, activity_id)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, d.projectId, d.frontId, d.type, d.severity, d.description.trim(), d.fix?.lat ?? null, d.fix?.lon ?? null,
       d.responsibleUserId, d.dueDate, d.userId, now, now, d.category, d.impeditive ? 1 : 0, d.activityId],
    );
    for (const p of d.photos) {
      const storagePath = `${d.projectId}/${id}/${p.id}.jpg`;
      await tx.execute(
        "INSERT INTO photos (id, project_id, entry_id, finding_id, storage_path, taken_at, annotation, uploaded, purpose) VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 'hallazgo')",
        [p.id, d.projectId, id, storagePath, p.takenAt, p.annotation ?? null],
      );
      await tx.execute(...enqueueSql({ bucket: "photos", storagePath, localUri: p.uri, contentType: "image/jpeg", photoId: p.id }));
    }
  });
  // El servidor crea la alerta crítica para residente y director al recibir el hallazgo;
  // en el dispositivo se avisa de inmediato a quien lo registró.
  if (d.severity === "critical")
    await notifyLocal("Hallazgo crítico registrado", "Se notificará al residente y al director apenas haya señal.");
  return id;
}

/**
 * Cambio de estado. `base_version` guarda la versión que el usuario vio: si al
 * sincronizar otro usuario lo cambió entretanto, el servidor registra el conflicto.
 */
export async function changeFindingStatus(id: string, to: FindingStatus, verificationNote?: string) {
  if (to === "closed" && verificationNote !== undefined)
    await db.execute("UPDATE findings SET status = ?, verification_note = ?, base_version = version, updated_at = ? WHERE id = ?", [
      to,
      verificationNote.trim(),
      nowIso(),
      id,
    ]);
  else await db.execute("UPDATE findings SET status = ?, base_version = version, updated_at = ? WHERE id = ?", [to, nowIso(), id]);
}

export async function resolveConflict(conflictId: string) {
  await db.execute("UPDATE sync_conflicts SET resolved = 1 WHERE id = ?", [conflictId]);
}

/**
 * Cierre verificado sin señal: primero las fotos del "después" (el servidor exige al menos una en
 * una NC o un punch) y luego el estado con su nota, en una sola transacción y en ese orden.
 */
export async function closeFinding(id: string, projectId: string, note: string, photos: PhotoDraft[]) {
  await db.writeTransaction(async (tx) => {
    for (const p of photos) {
      const storagePath = `${projectId}/${id}/${p.id}.jpg`;
      await tx.execute(
        "INSERT INTO photos (id, project_id, entry_id, finding_id, storage_path, taken_at, annotation, uploaded, purpose) VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 'cierre')",
        [p.id, projectId, id, storagePath, p.takenAt, p.annotation ?? "Cierre"],
      );
      await tx.execute(...enqueueSql({ bucket: "photos", storagePath, localUri: p.uri, contentType: "image/jpeg", photoId: p.id }));
    }
    await tx.execute("UPDATE findings SET status = 'closed', verification_note = ?, base_version = version, updated_at = ? WHERE id = ?", [note.trim(), nowIso(), id]);
  });
}

/** Inicia la corrección con la acción correctiva (si se escribió). */
export async function startCorrection(id: string, action: string) {
  await db.execute("UPDATE findings SET status = 'in_correction', corrective_action = COALESCE(?, corrective_action), base_version = version, updated_at = ? WHERE id = ?", [
    action.trim() || null,
    nowIso(),
    id,
  ]);
}

/** Inspección con lista de chequeo sin señal: queda en cola y se registra al sincronizar. */
export async function queueInspection(projectId: string, payload: Record<string, unknown>) {
  const id = newId();
  await db.execute("INSERT INTO inspection_submissions (id, project_id, payload, created_at) VALUES (?, ?, ?, ?)", [
    id,
    projectId,
    JSON.stringify({ ...payload, id }),
    nowIso(),
  ]);
  return id;
}
