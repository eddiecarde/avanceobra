import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@powersync/react";
import { useEffect } from "react";
import { toNotify, type Notice } from "../core/notices";
import { notifyLocal } from "../services/notifications";
import { useSession } from "../state/session";

const KEY = (userId: string) => `avanceobra:avisos-notificados:${userId}`;

/**
 * Cuando la sincronización trae avisos nuevos (te asignaron una NC, te rechazaron un registro,
 * algo tuyo vence), los muestra como notificación del teléfono. No dibuja nada.
 */
export function NoticeWatcher() {
  const { userId } = useSession();
  const { data } = useQuery<Notice>(
    "SELECT id, kind, title, body, ref_table, ref_id, created_at, read_at FROM user_notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at",
    [userId ?? ""],
  );
  useEffect(() => {
    if (!userId || !data.length) return;
    void (async () => {
      const last = await AsyncStorage.getItem(KEY(userId)).catch(() => null);
      // La primera vez no se avisa lo acumulado: solo lo que llegue de aquí en adelante
      if (last == null) return AsyncStorage.setItem(KEY(userId), data.at(-1)!.created_at).catch(() => undefined);
      const fresh = toNotify(data, last);
      for (const n of fresh.slice(-3)) await notifyLocal(n.title, n.body, { noticeId: n.id });
      if (fresh.length) await AsyncStorage.setItem(KEY(userId), fresh.at(-1)!.created_at).catch(() => undefined);
    })();
  }, [data, userId]);
  return null;
}
