/**
 * Estado de subida de un registro, para que nadie confunda «guardado en el teléfono» con «recibido
 * por el servidor». Las fotos cuentan aparte: el registro puede haber llegado y sus fotos no.
 */
export type EntrySync = "telefono" | "fotos" | "error" | "recibido";

export interface EntrySyncInfo {
  state: EntrySync;
  label: string;
}

export function entrySync(
  entryId: string,
  pendingRows: Set<string>,
  photos: { total: number; pending: number; error: string | null } | undefined,
): EntrySyncInfo {
  if (pendingRows.has(entryId)) return { state: "telefono", label: "📱 Guardado en el teléfono · falta subirlo (necesita señal)" };
  const p = photos ?? { total: 0, pending: 0, error: null };
  if (p.pending > 0 && p.error) return { state: "error", label: `⚠ Registro recibido, pero ${p.pending} foto(s) no han podido subir: ${p.error}` };
  if (p.pending > 0) return { state: "fotos", label: `☁ Registro recibido · faltan ${p.pending} de ${p.total} foto(s) por subir` };
  return { state: "recibido", label: p.total ? `✓ Recibido por el servidor, con sus ${p.total} foto(s)` : "✓ Recibido por el servidor" };
}
