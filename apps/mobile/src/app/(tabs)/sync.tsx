import { useQuery } from "@powersync/react";
import { useState } from "react";
import { Alert, Linking } from "react-native";
import { db } from "../../db/database";
import { resolveConflict } from "../../services/findings";
import { processFileQueue } from "../../services/fileQueue";
import { config, supabase } from "../../services/supabase";
import { versionLabel } from "../../services/updates";
import { useSession } from "../../state/session";
import { useSyncSummary } from "../../state/syncState";
import { BigButton, Body, Card, Label, Screen, Title } from "../../ui/components";
import { useTheme } from "../../ui/theme";

/** Detalle de sincronización: pendientes, errores definitivos y conflictos por revisar. */
export default function SyncScreen() {
  const s = useSyncSummary();
  const t = useTheme();
  const { userId, userName, signOut } = useSession();

  const { data: files } = useQuery<{ id: string; storage_path: string; attempts: number; last_error: string | null; next_attempt_at: string | null }>(
    "SELECT id, storage_path, attempts, last_error, next_attempt_at FROM file_queue ORDER BY created_at LIMIT 20",
  );
  const { data: errors } = useQuery<{ id: string; table_name: string; op: string; error: string; created_at: string }>(
    "SELECT id, table_name, op, error, created_at FROM upload_errors ORDER BY created_at DESC LIMIT 20",
  );
  const { data: conflicts } = useQuery<{ id: string; table_name: string; row_id: string; server_values: string; client_values: string; created_at: string }>(
    "SELECT id, table_name, row_id, server_values, client_values, created_at FROM sync_conflicts WHERE resolved = 0 AND (client_user = ? OR server_user = ?)",
    [userId ?? "", userId ?? ""],
  );

  const [linking, setLinking] = useState(false);

  /** Abre el bot con un código de un solo uso; el bot vincula la cuenta y responde en Telegram. */
  async function linkTelegram() {
    setLinking(true);
    const { data, error } = await supabase.rpc("create_telegram_link_code");
    setLinking(false);
    if (error || !data) return Alert.alert("Se necesita señal", "Conéctate a internet para vincular Telegram.");
    await Linking.openURL(`https://t.me/${config.telegramBot}?start=${data as string}`);
  }

  const hoursPending = s.oldestPendingFileAt ? (Date.now() - Date.parse(s.oldestPendingFileAt)) / 3_600_000 : 0;

  return (
    <Screen>
      <Title>{s.label}</Title>
      <Body>{`Registros en cola: ${s.pendingRecords} · Archivos (fotos/firmas): ${s.pendingFiles}`}</Body>
      <Body muted>{`Última sincronización: ${s.lastSyncedAt ? s.lastSyncedAt.toLocaleString("es-CO") : "nunca"}`}</Body>
      {hoursPending > 12 ? (
        <Card accent={t.danger}>
          <Body>{`⚠ Hay archivos sin subir desde hace ${Math.floor(hoursPending)} horas. Busca un punto con señal o Wi-Fi.`}</Body>
        </Card>
      ) : null}
      {s.error ? <Body muted>{`Último error de red: ${s.error}`}</Body> : null}
      <BigButton title="⟳ Reintentar ahora" onPress={() => void db.execute("UPDATE file_queue SET next_attempt_at = NULL").then(processFileQueue)} />

      {files.length ? <Label>Archivos pendientes</Label> : null}
      {files.map((f) => (
        <Card key={f.id}>
          <Body>{f.storage_path.split("/").pop()}</Body>
          <Body muted>{`Intentos: ${f.attempts}${f.last_error ? ` · ${f.last_error}` : ""}`}</Body>
        </Card>
      ))}

      {conflicts.length ? <Label>Conflictos por revisar</Label> : null}
      {conflicts.map((c) => {
        const server = JSON.parse(c.server_values) as Record<string, unknown>;
        const client = JSON.parse(c.client_values) as Record<string, unknown>;
        return (
          <Card key={c.id} accent={t.warning}>
            <Body>{`Otro usuario cambió este hallazgo mientras estabas sin señal.`}</Body>
            <Body muted>{`Servidor: ${String(server.status ?? "")} · Tu cambio: ${String(client.status ?? "")} (se aplicó el tuyo)`}</Body>
            <BigButton title="Entendido" onPress={() => void resolveConflict(c.id)} />
          </Card>
        );
      })}

      {errors.length ? <Label>Rechazados por el servidor</Label> : null}
      {errors.map((e) => (
        <Card key={e.id} accent={t.danger}>
          <Body>{`${e.table_name} (${e.op})`}</Body>
          <Body muted>{e.error}</Body>
        </Card>
      ))}

      {config.telegramBot ? (
        <>
          <Label>Alertas por Telegram</Label>
          <BigButton title="✈ Vincular Telegram" loading={linking} onPress={() => void linkTelegram()} />
          <Body muted>Abre el bot, pulsa «Iniciar» y desde ahí recibirás las alertas de obra.</Body>
        </>
      ) : null}

      <Label>{`Sesión: ${userName}`}</Label>
      <Body muted>{`Versión ${versionLabel()}`}</Body>
      <BigButton
        title="Cerrar sesión"
        variant="danger"
        disabled={s.pendingRecords + s.pendingFiles > 0}
        onPress={() => void signOut()}
      />
      {s.pendingRecords + s.pendingFiles > 0 ? <Body muted>Sincroniza antes de cerrar sesión para no perder datos.</Body> : null}
    </Screen>
  );
}
