"use client";

import {
  eiffageToPlan,
  fromExcelRows,
  fromMsProjectXml,
  fromPrimaveraXer,
  normHeader,
  parseEiffageMemoria,
  type MemoriaRow,
  type ExistingActivity,
  type ExistingFront,
  type ImportDiff,
  type ImportPlan,
  type Row,
} from "@avanceobra/importers";
import { scheduleProgressRows, type WorkCalendar } from "@avanceobra/engine";
import { fetchAll, projectCalendar } from "./dashboard";
import { supabase } from "./supabase";

/** Lee el archivo según su extensión: .xlsx (plantilla), .xml (MS Project) o .xer (Primavera P6). */
export async function readScheduleFile(file: File): Promise<ImportPlan> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const find = (n: string) => wb.worksheets.find((w) => normHeader(w.name) === n);
    // Informe diario de Eiffage: hoja "Memoria" con el árbol de actividades por subcampo
    const memoria = find("memoria");
    if (memoria) {
      const val = (v: unknown) =>
        v && typeof v === "object" && !(v instanceof Date)
          ? "result" in v
            ? (v as { result: unknown }).result
            : "richText" in v
              ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("")
              : ((v as { text?: unknown }).text ?? null)
          : v;
      const rowVals = (n: number) => {
        const a: unknown[] = [];
        memoria.getRow(n).eachCell({ includeEmpty: false }, (c, col) => (a[col - 1] = val(c.value)));
        return a;
      };
      const rows: MemoriaRow[] = [];
      for (let r = 9; r <= memoria.rowCount; r++) rows.push({ row: r, outline: memoria.getRow(r).outlineLevel ?? 0, values: rowVals(r) });
      const cut = rowVals(2)[2];
      return eiffageToPlan(parseEiffageMemoria(rows, rowVals(7), rowVals(8), { cutoff: cut instanceof Date ? cut.toISOString().slice(0, 10) : null }));
    }
    const acts = find("actividades") ?? wb.worksheets.find((w) => normHeader(w.name) !== "frentes" && normHeader(w.name) !== "instrucciones");
    const rows = (ws: typeof acts): Row[] => {
      const out: Row[] = [];
      ws?.eachRow({ includeEmpty: false }, (r) => out.push((r.values as unknown[]).slice(1)));
      return out;
    };
    return fromExcelRows({ actividades: rows(acts), frentes: rows(find("frentes")) });
  }
  const text = decodeText(buf);
  if (name.endsWith(".xml")) return fromMsProjectXml(text);
  if (name.endsWith(".xer")) return fromPrimaveraXer(text);
  throw new Error("Formato no soportado: usa .xlsx (plantilla), .xml (MS Project) o .xer (Primavera P6).");
}

/** Los XER suelen venir en Windows-1252: si UTF-8 deja caracteres inválidos, se relee así. */
function decodeText(buf: ArrayBuffer) {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

export interface Existing {
  fronts: (ExistingFront & { maxParallel: number | null })[];
  activities: ExistingActivity[];
  /** Último día con registro de cada actividad (para no duplicar el avance del cronograma). */
  lastRecorded: Map<string, string>;
  calendar: WorkCalendar;
  /** Grupo de trabajo y zona de cada actividad existente (para emparejar una línea base). */
  zones: { id: string; workGroup: string | null; subfield: string | null }[];
}

export async function loadExisting(projectId: string): Promise<Existing> {
  const [f, a, done, p] = await Promise.all([
    supabase.from("fronts").select("id, code, name, max_parallel_resources").eq("project_id", projectId).order("code"),
    fetchAll((x, y) =>
      supabase
        .from("activities")
        .select("id, front_id, code, name, unit, contract_qty, planned_start, planned_finish, predecessors, external_ref, work_group, subfield, budget_unit_cost")
        .eq("project_id", projectId)
        .order("code")
        .order("id")
        .range(x, y),
    ),
    // Lo ya registrado en campo protege la unidad y la cantidad de cada actividad
    fetchAll((x, y) =>
      supabase.from("activity_daily_output").select("activity_id, work_date, quantity").eq("project_id", projectId).order("activity_id").order("work_date").range(x, y),
    ),
    supabase.from("projects").select("workdays, holidays, colombian_holidays").eq("id", projectId).single(),
  ]);
  if (f.error) throw new Error(f.error.message);
  const executed = new Map<string, number>();
  const lastRecorded = new Map<string, string>();
  for (const d of (done.data ?? []) as { activity_id: string; work_date: string; quantity: number }[]) {
    executed.set(d.activity_id, (executed.get(d.activity_id) ?? 0) + Number(d.quantity));
    if (d.work_date > (lastRecorded.get(d.activity_id) ?? "")) lastRecorded.set(d.activity_id, d.work_date);
  }
  if (a.error) throw new Error(a.error.message);
  return {
    fronts: (f.data ?? []).map((x) => ({ id: x.id, code: x.code, name: x.name, maxParallel: x.max_parallel_resources })),
    activities: (a.data ?? []).map((x) => ({
      id: x.id,
      frontId: x.front_id,
      code: x.code,
      name: x.name,
      unit: x.unit,
      contractQty: Number(x.contract_qty),
      plannedStart: x.planned_start,
      plannedFinish: x.planned_finish,
      predecessorIds: (x.predecessors as string[] | null) ?? [],
      externalRef: x.external_ref,
      executedQty: executed.get(x.id) ?? 0,
      budgetUnitCost: x.budget_unit_cost == null ? null : Number(x.budget_unit_cost),
    })),
    lastRecorded,
    calendar: p.data ? projectCalendar(p.data) : {},
    zones: (a.data ?? []).map((x) => ({ id: x.id as string, workGroup: (x.work_group as string | null) ?? null, subfield: (x.subfield as string | null) ?? null })),
  };
}

export interface ApplyResult {
  frontsCreated: number;
  activitiesCreated: number;
  activitiesUpdated: number;
  skipped: number;
  /** Fechas de línea base guardadas y registros de avance traídos del cronograma. */
  baselinesSaved: number;
  progressEntries: number;
}

export interface ApplyOptions {
  updateExisting: boolean;
  /** Registrar el % completado del cronograma como avance aprobado hasta la fecha de estado. */
  importProgress?: boolean;
  /** Registrar el historial diario del informe (Eiffage) como avance aprobado. */
  importHistory?: boolean;
  statusDate?: string | null;
}

/**
 * Escribe la importación: crea frentes y actividades nuevas, actualiza las existentes y al final
 * resuelve las predecesoras (necesitan los ids de las recién creadas). Nunca borra.
 */
export async function applyImport(projectId: string, existing: Existing, diff: ImportDiff, opts: ApplyOptions): Promise<ApplyResult> {
  const res: ApplyResult = { frontsCreated: 0, activitiesCreated: 0, activitiesUpdated: 0, skipped: 0, baselinesSaved: 0, progressEntries: 0 };
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`${what}: ${e.message}`);
  };

  const toWrite = diff.activities.filter((op) => op.status === "new" || (op.status === "update" && opts.updateExisting));
  const neededFronts = new Set(toWrite.map((op) => op.frontCode));

  // 1. Frentes (los nuevos solo si alguna actividad que se escribe los usa)
  const frontId = new Map(existing.fronts.map((f) => [f.code, f.id]));
  for (const f of diff.fronts) {
    if (!f.existingId && !neededFronts.has(f.code)) continue;
    if (f.existingId) {
      const ex = existing.fronts.find((x) => x.id === f.existingId);
      if (opts.updateExisting && f.maxParallel != null && ex && ex.maxParallel !== f.maxParallel) {
        const { error } = await supabase.from("fronts").update({ max_parallel_resources: f.maxParallel }).eq("id", f.existingId);
        fail(`Frente ${f.code}`, error);
      }
      continue;
    }
    const { data, error } = await supabase
      .from("fronts")
      .insert({ project_id: projectId, code: f.code, name: f.name, max_parallel_resources: f.maxParallel })
      .select("id")
      .single();
    fail(`Frente ${f.code}`, error);
    frontId.set(f.code, data!.id);
    res.frontsCreated++;
  }

  // 2. Actividades (sin predecesoras todavía)
  const idByFileCode = new Map<string, string>();
  for (const op of diff.activities) if (op.existingId) idByFileCode.set(op.activity.code, op.existingId);
  for (const op of toWrite) {
    const a = op.activity;
    const fid = frontId.get(op.frontCode);
    if (!fid) throw new Error(`No se encontró el frente ${op.frontCode} de ${a.code}.`);
    if (op.status === "new") {
      const { data, error } = await supabase
        .from("activities")
        .insert({
          project_id: projectId,
          front_id: fid,
          code: a.code,
          name: a.name,
          unit: a.unit!,
          contract_qty: a.quantity!,
          planned_start: a.start,
          planned_finish: a.finish,
          external_ref: a.externalRef,
          ...extras(a),
        })
        .select("id")
        .single();
      fail(`Actividad ${a.code}`, error);
      idByFileCode.set(a.code, data!.id);
      res.activitiesCreated++;
    } else {
      const patch: Record<string, unknown> = {};
      for (const c of op.changes) {
        if (c.field === "frente") patch.front_id = fid;
        if (c.field === "nombre") patch.name = a.name;
        if (c.field === "unidad") patch.unit = a.unit;
        if (c.field === "cantidad") patch.contract_qty = a.quantity;
        if (c.field === "inicio") patch.planned_start = a.start;
        if (c.field === "fin") patch.planned_finish = a.finish;
        if (c.field === "costo unitario") patch.budget_unit_cost = a.budgetUnitCost;
      }
      const ex = existing.activities.find((x) => x.id === op.existingId);
      if (a.externalRef && !ex?.externalRef) patch.external_ref = a.externalRef;
      Object.assign(patch, extras(a));
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("activities").update(patch).eq("id", op.existingId!);
        fail(`Actividad ${a.code}`, error);
      }
      res.activitiesUpdated++;
    }
  }
  res.skipped = diff.activities.length - toWrite.length - diff.activities.filter((op) => op.status === "same").length;

  // 3. Predecesoras (por id), solo de lo que se escribió y cambió
  for (const op of toWrite) {
    if (op.status === "update" && !op.changes.some((c) => c.field === "predecesoras")) continue;
    if (op.status === "new" && !op.activity.predecessors.length) continue;
    const ids = op.activity.predecessors.map((c) => idByFileCode.get(c)).filter(Boolean) as string[];
    const { error } = await supabase.from("activities").update({ predecessors: ids }).eq("id", idByFileCode.get(op.activity.code)!);
    fail(`Predecesoras de ${op.activity.code}`, error);
  }

  // 4. Líneas base del cronograma (de todas las actividades del archivo que ya están en la obra)
  const baselineRows = diff.activities.flatMap((op) => {
    const id = idByFileCode.get(op.activity.code);
    return id ? (op.activity.baselines ?? []).map((b) => ({ activity_id: id, project_id: projectId, baseline: b.name, start: b.start, finish: b.finish })) : [];
  });
  for (let i = 0; i < baselineRows.length; i += 500) {
    const { error } = await supabase.from("activity_baselines").upsert(baselineRows.slice(i, i + 500), { onConflict: "activity_id,baseline" });
    fail("Líneas base", error);
  }
  res.baselinesSaved = baselineRows.length;

  // 5a. Historial diario del informe: solo los días posteriores al último registro de cada actividad
  if (opts.importHistory) {
    const rows = diff.activities.flatMap((op) => {
      const id = idByFileCode.get(op.activity.code);
      const last = id ? (existing.lastRecorded.get(id) ?? "") : "";
      return id ? (op.activity.history ?? []).filter((h) => h.date > last && h.quantity > 0).map((h) => ({ activity_id: id, work_date: h.date, quantity: h.quantity })) : [];
    });
    for (let i = 0; i < rows.length; i += 1000) {
      const { data, error } = await supabase.rpc("import_progress_history", { p_project: projectId, p_rows: rows.slice(i, i + 1000), p_note: "Del informe diario del contratista" });
      fail("Historial del informe", error);
      res.progressEntries += Number(data ?? 0);
    }
  }

  // 5. Avance del cronograma: solo la diferencia con lo registrado, repartida hasta la fecha de estado
  if (opts.importProgress) {
    const statusDate = opts.statusDate ?? new Date().toISOString().slice(0, 10);
    const items = diff.activities.flatMap((op) => {
      const id = idByFileCode.get(op.activity.code);
      const pr = op.activity.progress;
      const ex = existing.activities.find((x) => x.id === id);
      const qty = op.activity.quantity ?? ex?.contractQty ?? null;
      return id && pr && qty
        ? [{ activityId: id, contractQty: qty, pct: pr.pct, actualStart: pr.actualStart, actualFinish: pr.actualFinish, executed: ex?.executedQty ?? 0, lastRecorded: existing.lastRecorded.get(id) ?? null }]
        : [];
    });
    const rows = scheduleProgressRows(items, statusDate, existing.calendar).map((r) => ({ activity_id: r.activityId, work_date: r.date, quantity: r.quantity }));
    for (let i = 0; i < rows.length; i += 1000) {
      const { data, error } = await supabase.rpc("import_progress_history", { p_project: projectId, p_rows: rows.slice(i, i + 1000), p_note: `Del cronograma (estado al ${statusDate})` });
      fail("Avance del cronograma", error);
      res.progressEntries += Number(data ?? 0);
    }
  }
  return res;
}

/** Peso, subcampo y grupo de trabajo, solo si el archivo los trae (informe Eiffage). */
function extras(a: ImportDiff["activities"][number]["activity"]) {
  const out: Record<string, unknown> = {};
  if (a.weight != null) out.weight = Math.min(1, Math.max(0, a.weight));
  if (a.subfield !== undefined) out.subfield = a.subfield;
  if (a.workGroup !== undefined) out.work_group = a.workGroup;
  if (a.budgetUnitCost != null) out.budget_unit_cost = a.budgetUnitCost;
  return out;
}

/** Plantilla de Excel con la obra actual: sirve para exportar, editar en Excel y volver a importar. */
export async function buildTemplate(projectName: string, existing: Existing): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const head = (ws: import("exceljs").Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const inst = wb.addWorksheet("Instrucciones");
  inst.columns = [{ width: 110 }];
  [
    `Plantilla de programación · ${projectName}`,
    "",
    "1. Hoja Frentes: un frente por fila (código único, nombre y, si aplica, máximo de recursos en paralelo).",
    "2. Hoja Actividades: frente (código), código único de la actividad, nombre, unidad, cantidad contractual,",
    "   inicio y fin programados (dd/mm/aaaa) y predecesoras (códigos separados por coma).",
    "   Opcionales: Grupo (agrupa actividades para el KPI semanal), Subcampo (o Tramo, Sector, Piso: la zona de la obra)",
    "   y Costo unitario (costo directo presupuestado por unidad: con él se calcula el valor ganado).",
    "   Obligatorias: Frente, Código, Nombre, Unidad y Cantidad (un número, sin la unidad dentro de la celda).",
    "3. Las actividades se reconocen por su código: si ya existe se actualiza, si no, se crea.",
    "4. Nada se borra: las actividades que quites del archivo se conservan con su avance.",
  ].forEach((t, i) => {
    inst.getCell(`A${i + 1}`).value = t;
    if (i === 0) inst.getCell("A1").font = { bold: true, size: 14 };
  });

  const fs = wb.addWorksheet("Frentes");
  fs.columns = [
    { header: "Código", key: "code", width: 14 },
    { header: "Nombre", key: "name", width: 40 },
    { header: "Máx recursos", key: "max", width: 14 },
  ];
  existing.fronts.forEach((f) => fs.addRow({ code: f.code, name: f.name, max: f.maxParallel }));
  head(fs);

  const as = wb.addWorksheet("Actividades");
  as.columns = [
    { header: "Frente", key: "front", width: 10 },
    { header: "Código", key: "code", width: 14 },
    { header: "Nombre", key: "name", width: 40 },
    { header: "Unidad", key: "unit", width: 10 },
    { header: "Cantidad", key: "qty", width: 12 },
    { header: "Inicio", key: "start", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Fin", key: "finish", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Predecesoras", key: "preds", width: 24 },
    { header: "Grupo", key: "group", width: 18 },
    { header: "Subcampo", key: "zone", width: 12 },
    { header: "Costo unitario", key: "cost", width: 16, style: { numFmt: '"$"#,##0' } },
  ];
  const zone = new Map(existing.zones.map((z) => [z.id, z]));
  const frontCode = new Map(existing.fronts.map((f) => [f.id, f.code]));
  const code = new Map(existing.activities.map((a) => [a.id, a.code]));
  const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
  existing.activities.forEach((a) =>
    as.addRow({
      front: frontCode.get(a.frontId),
      code: a.code,
      name: a.name,
      unit: a.unit,
      qty: a.contractQty,
      start: date(a.plannedStart),
      finish: date(a.plannedFinish),
      preds: a.predecessorIds.map((id) => code.get(id)).filter(Boolean).join(", "),
      group: zone.get(a.id)?.workGroup ?? null,
      zone: zone.get(a.id)?.subfield ?? null,
      cost: a.budgetUnitCost ?? null,
    }),
  );
  if (!existing.activities.length) {
    fs.addRow({ code: "BA", name: "Bloque A", max: 4 });
    as.addRow({ front: "BA", code: "BA-TOP", name: "Topografía y replanteo", unit: "ha", qty: 25, start: date("2026-11-02"), finish: date("2026-11-14"), group: "Topografía", zone: "SC01" });
    as.addRow({ front: "BA", code: "BA-HIN", name: "Hincado de pilotes", unit: "pilotes", qty: 4200, start: date("2026-11-09"), finish: date("2026-12-19"), preds: "BA-TOP", group: "Hincas", zone: "SC01" });
  }
  head(as);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Deja constancia de una importación: archivo, totales y, si se autorizó, qué cambió en lo existente. */
export async function logImport(projectId: string, fileName: string, source: string, diff: ImportDiff, r: ApplyResult, updatedExisting: boolean) {
  const changes = updatedExisting
    ? diff.activities
        .filter((op) => op.status === "update")
        .map((op) => ({ codigo: op.activity.code, cambios: op.changes.map((c) => ({ campo: c.field, antes: c.from, despues: c.to })) }))
    : [];
  const { error } = await supabase.from("import_runs").insert({
    project_id: projectId,
    kind: "programacion",
    file_name: fileName,
    source,
    summary: {
      frentes_creados: r.frontsCreated,
      creadas: r.activitiesCreated,
      actualizadas: r.activitiesUpdated,
      sin_cambio: diff.summary.same,
      bloqueadas: diff.summary.blocked,
      omitidas: r.skipped,
    },
    changes,
    updated_existing: updatedExisting,
    created_by: (await supabase.auth.getUser()).data.user?.id,
  });
  if (error) throw new Error(`La importación se aplicó, pero no quedó en el registro: ${error.message}`);
}
