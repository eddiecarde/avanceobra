/** Avisos personales: cuáles mostrar como notificación y a qué pantalla lleva cada uno. */

export interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  ref_table: string | null;
  ref_id: string | null;
  created_at: string;
  read_at: string | null;
}

/** Los no leídos que llegaron después del último ya notificado (para no repetir notificaciones). */
export function toNotify(rows: Notice[], lastNotified: string | null): Notice[] {
  return rows.filter((r) => !r.read_at && (!lastNotified || r.created_at > lastNotified)).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Pantalla del aviso: el hallazgo, o los registros para correcciones y rechazos. */
export function noticeRoute(n: Pick<Notice, "ref_table" | "ref_id">): string | null {
  if (n.ref_table === "findings" && n.ref_id) return `/hallazgo/${n.ref_id}`;
  if (n.ref_table === "entry_corrections" || n.ref_table === "progress_entries") return "/registros";
  return null;
}
