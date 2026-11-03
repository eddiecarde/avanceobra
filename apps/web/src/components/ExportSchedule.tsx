"use client";

import { workingDaysBetween } from "@avanceobra/engine";
import { progressSnapshot, toMsProjectXml, toP6Rows, type ExportActivity, type ProgressPoint } from "@avanceobra/importers";
import { useState } from "react";
import { Button, Card, downloadBlob, Field, Input } from "@/components/ui";
import { loadDashboard, localToday } from "@/lib/dashboard";
import { loadExisting } from "@/lib/importer";

/** Arma el avance de cada actividad a la fecha de corte con lo que ya carga la web. */
async function snapshot(projectId: string, cutoff: string) {
  const [data, ex] = await Promise.all([loadDashboard(projectId), loadExisting(projectId)]);
  const byId = new Map(ex.activities.map((a) => [a.id, a]));
  const codeById = new Map(ex.activities.map((a) => [a.id, a.code]));
  const activities: ExportActivity[] = data.activities.map((a) => {
    const e = byId.get(a.id);
    return {
      code: a.code,
      name: a.name,
      unit: a.unit,
      contractQty: a.contractQty,
      frontCode: a.frontCode,
      frontName: a.frontName,
      plannedStart: a.plannedStart,
      plannedFinish: a.plannedFinish,
      plannedDays: a.plannedStart && a.plannedFinish ? workingDaysBetween(a.plannedStart, a.plannedFinish, data.project.calendar) : null,
      predecessors: (e?.predecessorIds ?? []).map((id) => codeById.get(id)).filter(Boolean) as string[],
      externalRef: e?.externalRef ?? null,
    };
  });
  const progress = new Map<string, ProgressPoint[]>();
  for (const d of data.daily) {
    const code = data.activities.find((a) => a.id === d.activityId)?.code;
    if (code) progress.set(code, [...(progress.get(code) ?? []), { date: d.date, quantity: d.quantity }]);
  }
  return { name: data.project.name, rows: progressSnapshot(activities, progress, cutoff) };
}

/** Exportar el avance real al cronograma del programador (MS Project o Primavera P6). */
export function ExportSchedule({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [cutoff, setCutoff] = useState(localToday());
  const [busy, setBusy] = useState<"msp" | "p6" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(kind: "msp" | "p6") {
    setBusy(kind);
    setMsg(null);
    try {
      const s = await snapshot(projectId, cutoff);
      const done = s.rows.filter((r) => r.status === "completed").length;
      const active = s.rows.filter((r) => r.status === "in_progress").length;
      if (kind === "msp") {
        downloadBlob(`${projectCode}_avance_${cutoff}.xml`, toMsProjectXml({ projectName: s.name, cutoff, activities: s.rows }), "application/xml");
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("TASK");
        const t = toP6Rows(s.rows);
        ws.addRow(t.fields);
        ws.addRow(t.titles).font = { bold: true };
        for (const r of t.rows) ws.addRow(r.map((v, i) => ((i === 3 || i === 4) && typeof v === "string" ? new Date(`${v}T00:00:00Z`) : v)));
        ws.getColumn(4).numFmt = "dd/mm/yyyy";
        ws.getColumn(5).numFmt = "dd/mm/yyyy";
        ws.columns.forEach((c, i) => (c.width = [14, 40, 14, 14, 14, 18][i]));
        downloadBlob(`${projectCode}_avance_P6_${cutoff}.xlsx`, (await wb.xlsx.writeBuffer()) as ArrayBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      }
      setMsg(`Exportado al ${cutoff}: ${done} terminada(s), ${active} en curso, ${s.rows.length - done - active} sin iniciar.`);
    } catch (e) {
      setMsg(`No se pudo exportar: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Exportar el avance real al cronograma</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Para que el programador actualice su cronograma sin digitar: % completado, comienzo y fin reales de cada actividad a la fecha de corte.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Fecha de corte">
          <Input type="date" value={cutoff} max={localToday()} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
        </Field>
        <Button disabled={busy !== null} onClick={() => void run("msp")}>
          {busy === "msp" ? "Generando…" : "MS Project (.xml)"}
        </Button>
        <Button disabled={busy !== null} onClick={() => void run("p6")}>
          {busy === "p6" ? "Generando…" : "Primavera P6 (hoja para importar)"}
        </Button>
      </div>
      {msg ? <p className="mt-2 font-semibold text-green-700 dark:text-green-400">{msg}</p> : null}
      <details className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-semibold">Cómo cargarlo</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <b>MS Project:</b> Archivo → Abrir → elige el .xml → «Combinar los datos con el proyecto activo» si quieres actualizar tu cronograma. Las actividades que vinieron de MS
            Project conservan su identificador (UID).
          </li>
          <li>
            <b>Primavera P6:</b> Archivo → Importar → Hoja de cálculo (XLS) → elige el proyecto → «Actualizar existentes». Se empareja por el ID de actividad (el código de
            AvanceObra); actualiza estado, % físico y fechas reales.
          </li>
        </ul>
      </details>
    </Card>
  );
}
