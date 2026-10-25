import { availableDays, lateProjectionAlert, projectCompletion, rateAlert, type Alert } from "@avanceobra/engine";
import { db } from "../db/database";
import { newId, nowIso } from "./ids";
import { notifyLocal } from "./notifications";

interface EntryContext {
  projectId: string;
  activityId: string;
  activityName: string;
  workDate: string;
}

/**
 * Reglas evaluadas en el dispositivo al guardar:
 *  - rendimiento del día por debajo del promedio o del requerido;
 *  - proyección que supera la fecha contractual.
 * La alerta se muestra de inmediato (notificación local) y se inserta en `alerts`,
 * que viaja por la cola de sincronización: el servidor la reenvía por push, correo,
 * WhatsApp o Telegram apenas haya señal. Máximo una alerta por tipo, actividad y día.
 */
export async function evaluateEntryAlerts(ctx: EntryContext) {
  const activity = await db.getOptional<{ contract_qty: number; unit: string }>(
    "SELECT contract_qty, unit FROM activities WHERE id = ?",
    [ctx.activityId],
  );
  const project = await db.getOptional<{ contract_end_date: string | null }>(
    "SELECT contract_end_date FROM projects WHERE id = ?",
    [ctx.projectId],
  );
  if (!activity) return;

  const daily = await db.getAll<{ work_date: string; qty: number }>(
    `SELECT work_date, SUM(quantity) AS qty FROM progress_entries
     WHERE activity_id = ? AND status IN ('submitted','approved') AND work_date >= date(?, '-30 day')
     GROUP BY work_date ORDER BY work_date`,
    [ctx.activityId, ctx.workDate],
  );
  const executedRow = await db.get<{ executed: number }>(
    "SELECT COALESCE(SUM(quantity), 0) AS executed FROM progress_entries WHERE activity_id = ? AND status IN ('submitted','approved')",
    [ctx.activityId],
  );

  const today = daily.find((d) => d.work_date === ctx.workDate)?.qty ?? 0;
  const history = daily.filter((d) => d.work_date !== ctx.workDate).map((d) => d.qty);
  const mean = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  const pending = Math.max(0, activity.contract_qty - executedRow.executed);

  const alerts: Alert[] = [];
  let required = 0;
  if (project?.contract_end_date && pending > 0) {
    const days = availableDays(ctx.workDate, project.contract_end_date).available;
    required = days > 0 ? pending / days : pending;
    if (history.length >= 3) {
      const p = projectCompletion({
        activityName: ctx.activityName,
        pendingQty: pending,
        rates: { optimistic: mean * 1.15, expected: mean, pessimistic: mean * 0.85 },
        fromDate: ctx.workDate,
        deadline: project.contract_end_date,
      });
      const late = lateProjectionAlert(ctx.activityName, p.expected.delayDays, p.expected.finishDate);
      if (late) alerts.push(late);
    }
  }
  // Con menos de 3 días de historia el promedio no es representativo: solo se compara con el requerido.
  const rate = rateAlert(ctx.activityName, today, history.length >= 3 ? mean : 0, required);
  if (rate) alerts.push(rate);

  for (const a of alerts) {
    const dup = await db.getOptional(
      "SELECT id FROM alerts WHERE kind = ? AND ref_id = ? AND substr(created_at, 1, 10) = substr(?, 1, 10)",
      [a.kind, ctx.activityId, nowIso()],
    );
    if (dup) continue;
    await db.execute(
      "INSERT INTO alerts (id, project_id, kind, severity, title, body, ref_table, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'activities', ?, ?)",
      [newId(), ctx.projectId, a.kind, a.severity, a.title, a.body, ctx.activityId, nowIso()],
    );
    await notifyLocal(a.title, a.body, { activityId: ctx.activityId });
  }
}
