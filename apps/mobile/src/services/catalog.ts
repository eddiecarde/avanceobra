import { normalizeCode, parseQty, type ActivityInput, type FrontInput } from "../core/catalog";
import { db } from "../db/database";
import { newId } from "./ids";

/**
 * Altas y cambios de frentes y actividades hechos por el administrador en campo.
 * Se guardan en local y suben con la sincronización; el servidor solo los acepta
 * si el usuario es administrador del proyecto (RLS).
 */

export async function createFront(projectId: string, f: FrontInput): Promise<string> {
  const id = newId();
  await db.execute("INSERT INTO fronts (id, project_id, code, name) VALUES (?, ?, ?, ?)", [
    id,
    projectId,
    normalizeCode(f.code),
    f.name.trim(),
  ]);
  return id;
}

export async function updateFront(id: string, f: FrontInput) {
  await db.execute("UPDATE fronts SET code = ?, name = ? WHERE id = ?", [normalizeCode(f.code), f.name.trim(), id]);
}

export async function createActivity(projectId: string, frontId: string, a: ActivityInput): Promise<string> {
  const id = newId();
  await db.execute(
    `INSERT INTO activities (id, project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, frontId, normalizeCode(a.code), a.name.trim(), a.unit.trim(), parseQty(a.contractQty), a.plannedStart || null, a.plannedFinish || null],
  );
  return id;
}

export async function updateActivity(id: string, a: ActivityInput) {
  await db.execute(
    `UPDATE activities SET code = ?, name = ?, unit = ?, contract_qty = ?, planned_start = ?, planned_finish = ? WHERE id = ?`,
    [normalizeCode(a.code), a.name.trim(), a.unit.trim(), parseQty(a.contractQty), a.plannedStart || null, a.plannedFinish || null, id],
  );
}
