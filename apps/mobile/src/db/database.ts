import { PowerSyncDatabase } from "@powersync/react-native";
import { AppSchema } from "./schema";
import { SupabaseConnector } from "./connector";

/** Una sola instancia por archivo de base de datos. */
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: "avanceobra.db" },
});

export const connector = new SupabaseConnector();

let connected = false;

/** Conecta la sincronización. Sin señal no falla: PowerSync reintenta solo y la app sigue en local. */
export async function startSync() {
  await db.init();
  if (!connected) {
    connected = true;
    await db.connect(connector);
  }
}

export async function stopSync(clearLocal = false) {
  connected = false;
  await db.disconnect();
  if (clearLocal) await db.disconnectAndClear();
}
