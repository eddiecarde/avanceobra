import { useQuery } from "@powersync/react";
import { router, Stack } from "expo-router";
import { noticeRoute, type Notice } from "../core/notices";
import { db } from "../db/database";
import { nowIso } from "../services/ids";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Screen, Title } from "../ui/components";
import { useTheme } from "../ui/theme";

const markRead = (id: string) => db.execute("UPDATE user_notifications SET read_at = ? WHERE id = ? AND read_at IS NULL", [nowIso(), id]);

/** Bandeja de avisos personales: asignaciones, correcciones decididas, rechazos y vencimientos. */
export default function Avisos() {
  const t = useTheme();
  const { userId } = useSession();
  const { data } = useQuery<Notice>(
    "SELECT id, kind, title, body, ref_table, ref_id, created_at, read_at FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [userId ?? ""],
  );
  const unread = data.filter((n) => !n.read_at);
  return (
    <Screen>
      <Stack.Screen options={{ title: "Avisos" }} />
      <Title>{unread.length ? `${unread.length} sin leer` : "Todo leído"}</Title>
      {unread.length ? <BigButton title="Marcar todo como leído" onPress={() => void Promise.all(unread.map((n) => markRead(n.id)))} /> : null}
      {data.length === 0 ? <Body muted>Aquí llegan las NC y punch que te asignen, las correcciones que te decidan, los registros rechazados y lo que vence.</Body> : null}
      {data.map((n) => (
        <Card key={n.id} accent={n.read_at ? undefined : n.kind === "finding_due" || n.kind === "entry_rejected" ? t.danger : t.primary}>
          <Body>{`${n.read_at ? "" : "● "}${n.title}`}</Body>
          <Body muted>{n.body}</Body>
          <Body muted>{new Date(n.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</Body>
          {noticeRoute(n) ? (
            <BigButton
              title="Abrir"
              onPress={() => {
                void markRead(n.id);
                router.push(noticeRoute(n) as never);
              }}
            />
          ) : !n.read_at ? (
            <BigButton title="Marcar como leído" onPress={() => void markRead(n.id)} />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
