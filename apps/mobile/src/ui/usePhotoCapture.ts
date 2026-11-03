import { useState } from "react";
import { Alert } from "react-native";
import type { WatermarkInfo } from "../core/watermark";
import { MAX_PHOTOS, type PhotoDraft } from "../services/entries";
import { newId } from "../services/ids";
import { processPhoto, takePhoto } from "../services/photos";

/**
 * Toma, comprime y marca fotos; las guarda en el teléfono hasta que se suban.
 * `annotation` asocia la foto a un campo del formato (p. ej. "foto_rotos").
 */
export function usePhotoCapture(context: () => Omit<WatermarkInfo, "takenAt">) {
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [busy, setBusy] = useState(false);

  async function capture(annotation?: string): Promise<string | null> {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert(`Máximo ${MAX_PHOTOS} fotos por registro`);
      return null;
    }
    const uri = await takePhoto();
    if (!uri) return null;
    setBusy(true);
    try {
      const id = newId();
      const takenAt = new Date();
      const file = await processPhoto(uri, id, { ...context(), takenAt });
      setPhotos((ps) => [...ps, { id, uri: file.uri, takenAt: takenAt.toISOString(), annotation }]);
      return id;
    } catch (e) {
      Alert.alert("No se pudo guardar la foto", String((e as Error).message ?? e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const remove = (id: string) => setPhotos((ps) => ps.filter((p) => p.id !== id));
  return { photos, capture, remove, busy, reset: () => setPhotos([]), restore: (ps: PhotoDraft[]) => setPhotos(ps) };
}
