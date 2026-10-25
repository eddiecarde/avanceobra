import { db } from "../db/database";
import { newId, nowIso } from "./ids";

/** Entrega de material recibida en obra: se guarda en el teléfono y sube cuando haya señal. */
export async function recordDelivery(d: {
  projectId: string;
  userId: string;
  materialId: string;
  deliveredOn: string;
  quantity: number;
  document: string;
  supplier: string;
}): Promise<string> {
  const id = newId();
  await db.execute(
    `INSERT INTO material_deliveries (id, project_id, material_id, delivered_on, quantity, document, supplier, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [id, d.projectId, d.materialId, d.deliveredOn, d.quantity, d.document.trim() || null, d.supplier.trim() || null, d.userId, nowIso()],
  );
  return id;
}
