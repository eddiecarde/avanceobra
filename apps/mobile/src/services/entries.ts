import type { LossCause, Weather } from "@avanceobra/shared";
import { db } from "../db/database";
import { enqueueSql } from "./fileQueue";
import { deviceId, newId, nowIso } from "./ids";
import { evaluateEntryAlerts } from "./localAlerts";

export interface PhotoDraft {
  id: string;
  uri: string;
  takenAt: string;
  annotation?: string;
}

export interface EntryDraft {
  projectId: string;
  frontId: string;
  activityId: string;
  activityName: string;
  unit: string;
  workDate: string;
  quantity: number;
  effectiveHours: number;
  lostHours: number;
  lossCause: LossCause;
  /** Detalle por causa; lostHours es su suma y lossCause la causa con más horas. */
  losses: { cause: string; hours: number }[];
  weather: Weather | null;
  crewSize: number;
  notes: string;
  fix: { lat: number; lon: number; accuracy: number | null } | null;
  photos: PhotoDraft[];
  elementIds: string[];
  area: { geojson: string; areaM2: number } | null;
  signatureUri: string | null;
  values?: Record<string, unknown>;
  /** Versión del formato con que se llenó (queda guardada en el registro). */
  templateVersionId?: string | null;
  /** Firmas de campos del formato: se suben a Storage y en values queda su ruta. */
  formFiles?: { fieldId: string; uri: string }[];
  userId: string;
}

export const MAX_PHOTOS = 5;

/**
 * Guarda el registro completo en UNA transacción local: el avance, sus elementos,
 * el área, las fotos y su cola de subida. Si algo falla, no queda nada a medias.
 * Funciona igual con o sin señal; PowerSync lo sube cuando haya conexión.
 */
export async function saveEntry(d: EntryDraft): Promise<string> {
  if (d.photos.length > MAX_PHOTOS) throw new Error(`Máximo ${MAX_PHOTOS} fotos por registro`);
  if (!(d.quantity >= 0)) throw new Error("La cantidad debe ser un número mayor o igual a cero");

  const entryId = newId();
  const signaturePath = d.signatureUri ? `${d.projectId}/${entryId}/firma.png` : null;
  const values = { ...(d.values ?? {}) };
  const formUploads = (d.formFiles ?? []).map((f) => {
    const storagePath = `${d.projectId}/${entryId}/firma-${f.fieldId}.png`;
    values[f.fieldId] = storagePath;
    return { ...f, storagePath };
  });

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO progress_entries (id, project_id, front_id, activity_id, template_version_id, work_date, quantity,
         effective_hours, lost_hours, loss_cause, losses, weather, crew_size, notes, lat, lon, gps_accuracy_m, "values",
         status, signature_path, created_by, device_id, client_created_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, 1)`,
      [
        entryId, d.projectId, d.frontId, d.activityId, d.templateVersionId ?? null, d.workDate, d.quantity,
        d.effectiveHours, d.lostHours, d.lossCause, JSON.stringify(d.losses), d.weather, d.crewSize, d.notes,
        d.fix?.lat ?? null, d.fix?.lon ?? null, d.fix?.accuracy ?? null, JSON.stringify(values),
        signaturePath, d.userId, deviceId, nowIso(),
      ],
    );
    for (const elementId of d.elementIds) {
      await tx.execute("INSERT INTO entry_elements (id, project_id, entry_id, element_id) VALUES (?, ?, ?, ?)", [
        newId(), d.projectId, entryId, elementId,
      ]);
    }
    if (d.area) {
      await tx.execute(
        "INSERT INTO progress_areas (id, project_id, entry_id, geojson, area_m2, is_approximate) VALUES (?, ?, ?, ?, ?, 1)",
        [newId(), d.projectId, entryId, d.area.geojson, d.area.areaM2],
      );
    }
    for (const p of d.photos) {
      const storagePath = `${d.projectId}/${entryId}/${p.id}.jpg`;
      await tx.execute(
        "INSERT INTO photos (id, project_id, entry_id, finding_id, storage_path, taken_at, annotation, uploaded) VALUES (?, ?, ?, NULL, ?, ?, ?, 0)",
        [p.id, d.projectId, entryId, storagePath, p.takenAt, p.annotation ?? null],
      );
      await tx.execute(...enqueueSql({ bucket: "photos", storagePath, localUri: p.uri, contentType: "image/jpeg", photoId: p.id }));
    }
    for (const f of formUploads) {
      await tx.execute(...enqueueSql({ bucket: "photos", storagePath: f.storagePath, localUri: f.uri, contentType: "image/png" }));
    }
    if (d.signatureUri && signaturePath) {
      await tx.execute(...enqueueSql({ bucket: "photos", storagePath: signaturePath, localUri: d.signatureUri, contentType: "image/png" }));
    }
  });

  // Alertas locales: se evalúan al guardar, sin depender de la señal.
  void evaluateEntryAlerts(d).catch(() => undefined);
  return entryId;
}

/** Aprobación o rechazo por el residente (el servidor valida el rol y bloquea aprobados). */
export async function reviewEntry(entryId: string, approve: boolean, userId: string, reason?: string) {
  await db.execute(
    `UPDATE progress_entries SET status = ?, approved_by = ?, approved_at = ?, rejection_reason = ? WHERE id = ? AND status = 'submitted'`,
    [approve ? "approved" : "rejected", userId, nowIso(), approve ? null : reason ?? "", entryId],
  );
}

/** Solo los borradores se pueden borrar; lo enviado o aprobado queda en la auditoría. */
export async function deleteDraft(entryId: string) {
  await db.execute("DELETE FROM progress_entries WHERE id = ? AND status = 'draft'", [entryId]);
}
