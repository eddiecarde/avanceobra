import type { AbstractPowerSyncDatabase, CrudEntry, PowerSyncBackendConnector } from "@powersync/react-native";
import { isPermanentError, toServerCall, type OpKind } from "../core/mapping";
import { config, supabase } from "../services/supabase";

/**
 * Conector PowerSync ↔ Supabase.
 * - Descarga: PowerSync replica Postgres con las reglas de powersync/sync-rules.yaml.
 * - Subida: se procesa la cola CRUD en lotes. Un error transitorio (red, 5xx) lanza
 *   excepción y PowerSync reintenta todo el lote más tarde; un error permanente (RLS,
 *   validación, registro aprobado) se aparta a `upload_errors` para no bloquear la cola.
 */
export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    return {
      endpoint: config.powersyncUrl,
      token: data.session.access_token,
      expiresAt: data.session.expires_at ? new Date(data.session.expires_at * 1000) : undefined,
    };
  }

  async uploadData(db: AbstractPowerSyncDatabase): Promise<void> {
    const batch = await db.getCrudBatch(100);
    if (!batch) return;

    for (const op of batch.crud) {
      try {
        await this.applyOp(db, op);
      } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        if (!isPermanentError(e)) throw err; // transitorio: PowerSync reintentará
        await db.execute(
          `INSERT INTO upload_errors (id, table_name, row_id, op, payload, error, created_at)
           VALUES (uuid(), ?, ?, ?, ?, ?, ?)`,
          [op.table, op.id, op.op, JSON.stringify(op.opData ?? {}), e.message ?? String(e.code), new Date().toISOString()],
        );
      }
    }
    await batch.complete();
  }

  private async applyOp(db: AbstractPowerSyncDatabase, op: CrudEntry) {
    let baseVersion: number | null = null;
    if (op.table === "findings" && op.op === "PATCH") {
      baseVersion =
        (op.opData?.base_version as number | undefined) ??
        (await db.getOptional<{ base_version: number | null }>("SELECT base_version FROM findings WHERE id = ?", [op.id]))
          ?.base_version ??
        null;
    }
    const call = toServerCall(op.table, op.op as OpKind, op.id, op.opData, baseVersion);
    switch (call.kind) {
      case "skip":
        return;
      case "upsert": {
        // Las altas son únicas (UUID del dispositivo): si el lote se reintenta, la fila ya existe y se ignora.
        const { error } = await supabase.from(call.table).upsert(call.row, { ignoreDuplicates: true });
        if (error) throw error;
        return;
      }
      case "update": {
        const { error } = await supabase.from(call.table).update(call.patch).eq("id", call.id);
        if (error) throw error;
        return;
      }
      case "delete": {
        const { error } = await supabase.from(call.table).delete().eq("id", call.id);
        if (error) throw error;
        return;
      }
      case "rpc": {
        const { error } = await supabase.rpc(call.fn, call.args);
        if (error) throw error;
        return;
      }
    }
  }
}
