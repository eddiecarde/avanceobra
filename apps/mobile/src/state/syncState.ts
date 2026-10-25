import NetInfo from "@react-native-community/netinfo";
import { usePowerSync, useQuery, useStatus } from "@powersync/react";
import { useEffect, useState } from "react";
import { syncLabel, type SyncState } from "@avanceobra/shared";

export interface SyncSummary {
  state: SyncState;
  label: string;
  pendingRecords: number;
  pendingFiles: number;
  lastSyncedAt: Date | null;
  oldestPendingFileAt: string | null;
  error: string | null;
}

/**
 * Estado visible de sincronización: "Sin conexión / Sincronizando / Sincronizado"
 * con el contador de registros y archivos pendientes.
 */
export function useSyncSummary(): SyncSummary {
  const db = usePowerSync();
  const status = useStatus();
  const [online, setOnline] = useState<boolean>(true);
  const [pendingRecords, setPendingRecords] = useState(0);

  const { data: files } = useQuery<{ n: number; oldest: string | null }>(
    "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM file_queue",
  );

  useEffect(() => NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected))), []);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      db
        .getUploadQueueStats()
        .then((s) => alive && setPendingRecords(s.count))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [db]);

  const pendingFiles = files[0]?.n ?? 0;
  const pending = pendingRecords + pendingFiles;
  const busy = status.dataFlowStatus.uploading || status.dataFlowStatus.downloading;
  const state: SyncState = !online || !status.connected ? "offline" : busy || pending > 0 ? "syncing" : "synced";
  const err = status.dataFlowStatus.uploadError ?? status.dataFlowStatus.downloadError;

  return {
    state,
    label: syncLabel(state, pending),
    pendingRecords,
    pendingFiles,
    lastSyncedAt: status.lastSyncedAt ?? null,
    oldestPendingFileAt: files[0]?.oldest ?? null,
    error: err ? String(err.message ?? err) : null,
  };
}
