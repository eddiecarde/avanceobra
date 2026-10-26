"use client";

import { diffImport, toNumber, type ActivityOp, type ImportPlan } from "@avanceobra/importers";
import { useEffect, useMemo, useState } from "react";
import { ExportSchedule } from "@/components/ExportSchedule";
import { Badge, Button, Card, cx, downloadBlob, Field, Input, Select } from "@/components/ui";
import { BaselineMatcher } from "@/components/BaselineMatcher";
import { applyImport, buildTemplate, loadExisting, logImport, readScheduleFile, type ApplyResult, type Existing } from "@/lib/importer";
import { supabase } from "@/lib/supabase";
import { useCurrentProject, useSession } from "@/lib/session";

const SOURCE_LABEL = { excel: "Excel", msproject: "MS Project", primavera: "Primavera P6" } as const;
const STATUS: Record<ActivityOp["status"], { label: string; tone: "green" | "blue" | "neutral" | "red" }> = {
  new: { label: "Nueva", tone: "green" },
  update: { label: "Cambia", tone: "blue" },
  same: { label: "Igual", tone: "neutral" },
  blocked: { label: "Falta dato", tone: "red" },
};

type Overrides = Record<string, { unit?: string; quantity?: string }>;

/** Importar programación: Excel (plantilla), MS Project XML o Primavera XER, con vista previa antes de escribir. */
export default function Importar() {
  const { memberships, isAdmin } = useSession();
  const projects = useMemo(
    () => [...new Map(memberships.filter((m) => m.project && m.role === "admin").map((m) => [m.project_id, m.project!])).values()],
    [memberships],
  );
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const project = projects.find((p) => p.id === projectId);
  const [existing, setExisting] = useState<{ projectId: string; data: Existing } | null>(null);
  const [version, setVersion] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [bulkUnit, setBulkUnit] = useState("");
  // Actualizar lo que ya existe se autoriza a propósito: por defecto solo se crea lo nuevo
  const [updateExisting, setUpdateExisting] = useState(false);
  // Cargar el avance del cronograma como registros aprobados: también se autoriza a propósito
  const [importProgress, setImportProgress] = useState(false);
  const [importHistory, setImportHistory] = useState(false);
  const [runs, setRuns] = useState<{ id: string; kind: string; file_name: string; source: string; summary: Record<string, number>; updated_existing: boolean; created_at: string; changes: { codigo: string }[] }[]>([]);
  const [filter, setFilter] = useState<"all" | ActivityOp["status"]>("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadExisting(projectId).then(
      (data) => setExisting({ projectId, data }),
      (e: Error) => setMsg({ tone: "error", text: e.message }),
    );
    void supabase
      .from("import_runs")
      .select("id, kind, file_name, source, summary, updated_existing, created_at, changes")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setRuns((data ?? []) as typeof runs));
  }, [projectId, version]);
  const ex = existing?.projectId === projectId ? existing.data : null;

  // Datos completados a mano (unidad y cantidad que MS Project y Primavera no traen)
  const effectivePlan = useMemo(() => {
    if (!plan) return null;
    return {
      ...plan,
      activities: plan.activities.map((a) => {
        const o = overrides[a.code];
        return { ...a, unit: a.unit ?? (o?.unit?.trim() || null), quantity: a.quantity ?? (o?.quantity ? toNumber(o.quantity) : null) };
      }),
    };
  }, [plan, overrides]);
  const diff = useMemo(() => (effectivePlan && ex ? diffImport(ex, effectivePlan) : null), [effectivePlan, ex]);
  const missingValues = plan?.activities.some((a) => a.unit == null || a.quantity == null) ?? false;
  const scheduleExtras = useMemo(
    () => ({
      baselines: plan?.activities.filter((a) => a.baselines?.length).length ?? 0,
      names: [...new Set(plan?.activities.flatMap((a) => (a.baselines ?? []).map((b) => b.name)) ?? [])],
      progress: plan?.activities.filter((a) => a.progress && a.progress.pct > 0).length ?? 0,
      historyDays: plan?.activities.reduce((t, a) => t + (a.history?.length ?? 0), 0) ?? 0,
    }),
    [plan],
  );
  const blockingErrors = plan?.errors.length ?? 0;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setOverrides({});
    setFileName(file.name);
    try {
      setPlan(await readScheduleFile(file));
    } catch (e) {
      setPlan(null);
      setMsg({ tone: "error", text: (e as Error).message });
    }
  }

  async function onTemplate() {
    if (!ex) return;
    const buf = await buildTemplate(project?.name ?? "Obra", ex);
    downloadBlob(`programacion-${project?.code ?? "obra"}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  async function onApply() {
    if (!diff || !ex) return;
    const s = diff.summary;
    if (
      !window.confirm(
        `Se crearán ${s.newFronts} frente(s) y ${s.newActivities} actividad(es)${updateExisting ? ` y se actualizarán ${s.updated} existentes (queda registrado qué cambió)` : "; las existentes no se tocan"}. ¿Continuar?`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r: ApplyResult = await applyImport(projectId, ex, diff, { updateExisting, importProgress, importHistory, statusDate: plan?.statusDate ?? null });
      await logImport(projectId, fileName ?? "archivo", plan?.source ?? "excel", diff, r, updateExisting);
      setMsg({
        tone: "ok",
        text: `Importación lista: ${r.frontsCreated} frente(s) y ${r.activitiesCreated} actividad(es) creadas, ${r.activitiesUpdated} actualizada(s)${r.skipped ? `, ${r.skipped} sin importar` : ""}${r.baselinesSaved ? `, ${r.baselinesSaved} fecha(s) de línea base` : ""}${r.progressEntries ? `, ${r.progressEntries} registro(s) de avance del cronograma` : ""}. Los teléfonos las reciben en la próxima sincronización.`,
      });
      setPlan(null);
      setFileName(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ tone: "error", text: `${(e as Error).message}. Lo ya escrito se conserva; corrige y vuelve a importar el mismo archivo (lo repetido queda igual).` });
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin || !projects.length) return <p className="text-zinc-600">Solo el administrador del proyecto puede importar la programación.</p>;

  const rows = diff?.activities.filter((op) => filter === "all" || op.status === filter) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Programación</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Excel (plantilla o informe diario Eiffage con hoja Memoria), MS Project (.xml) o Primavera P6 (.xer). Primero ves los cambios; nada se borra.</p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => (setPicked(e.target.value), setPlan(null))}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Button onClick={() => void onTemplate()} disabled={!ex}>
          Descargar plantilla Excel con la obra actual
        </Button>
      </div>

      {ex && !ex.activities.length ? (
        <Card className="border-l-4 border-l-blue-600">
          <h2 className="text-lg font-bold">Obra nueva: carga su programación</h2>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Pulsa <b>Descargar plantilla Excel con la obra actual</b>, llénala y súbela aquí abajo. También sirven el XML de MS Project o el XER de Primavera.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            <li>
              Hoja <b>Actividades</b> (obligatoria), una fila por actividad: <b>Frente, Código, Nombre, Unidad, Cantidad</b>. Opcionales: Inicio, Fin
              (dd/mm/aaaa), Predecesoras (códigos separados por coma), Grupo, Subcampo y Costo unitario (costo directo presupuestado por unidad, para el valor ganado).
            </li>
            <li>
              Hoja <b>Frentes</b> (opcional): Código, Nombre y Máx recursos. Si no está, los frentes se crean con los códigos de la columna Frente.
            </li>
            <li>Los encabezados van en la fila 1, en cualquier orden y con o sin tildes. El código de cada actividad no se repite.</li>
          </ul>
        </Card>
      ) : null}

      {project ? <ExportSchedule projectId={projectId} projectCode={project.code} /> : null}

      <Card>
        <h2 className="mb-2 text-lg font-bold">Importar o actualizar la programación</h2>
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-8 text-center hover:border-blue-600 dark:border-zinc-700"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
        >
          <span className="text-lg font-bold">{fileName ?? "Arrastra aquí el archivo o haz clic para elegirlo"}</span>
          <span className="text-sm text-zinc-500">
            .xlsx con hojas Frentes y Actividades · .xml de MS Project (Archivo → Guardar como → XML) · .xer exportado de Primavera P6
          </span>
          <input type="file" accept=".xlsx,.xml,.xer" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {ex ? (
          <p className="mt-2 text-sm text-zinc-500">
            {project?.name}: hoy tiene {ex.fronts.length} frente(s) y {ex.activities.length} actividad(es).
          </p>
        ) : null}
      </Card>

      {msg ? (
        <div className={cx("rounded-lg px-4 py-3 font-semibold", msg.tone === "ok" ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200")}>
          {msg.tone === "ok" ? "✓ " : ""}
          {msg.text}
        </div>
      ) : null}

      {plan && diff ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{SOURCE_LABEL[plan.source]}</Badge>
              {plan.projectName ? <span className="font-semibold">{plan.projectName}</span> : null}
              <span className="text-zinc-500">
                · {plan.fronts.length} frente(s) · {plan.activities.length} actividad(es)
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ["Frentes nuevos", diff.summary.newFronts],
                ["Actividades nuevas", diff.summary.newActivities],
                ["Con cambios", diff.summary.updated],
                ["Iguales", diff.summary.same],
                ["Les falta un dato", diff.summary.blocked],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
                  <div className="text-xs font-bold uppercase text-zinc-500">{k}</div>
                  <div className={cx("text-2xl font-extrabold tabular-nums", k === "Les falta un dato" && Number(v) > 0 && "text-red-700 dark:text-red-400")}>{v}</div>
                </div>
              ))}
            </div>
            {diff.fronts.some((f) => f.matchedBy === "name") ? (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                Frentes reconocidos por nombre:{" "}
                {diff.fronts
                  .filter((f) => f.matchedBy === "name")
                  .map((f) => `${f.name} (${f.fileCode} → ${f.code})`)
                  .join(", ")}
                .
              </p>
            ) : null}
            {plan.errors.length ? (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-900 dark:bg-red-950 dark:text-red-200">
                <b>Corrige el archivo antes de importar:</b>
                <ul className="list-disc pl-5">
                  {plan.errors.map((e, i) => (
                    <li key={i}>
                      {e.where ? <b>{e.where}: </b> : null}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.warnings.length ? (
              <details className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <summary className="cursor-pointer font-semibold">{plan.warnings.length} aviso(s)</summary>
                <ul className="list-disc pl-5">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>
                      {w.where ? <b>{w.where}: </b> : null}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {diff.untouched.length ? (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {diff.untouched.length} actividad(es) de la obra no vienen en el archivo y se conservan: {diff.untouched.map((a) => a.code).join(", ")}.
              </p>
            ) : null}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <h2 className="mr-auto text-lg font-bold">Vista previa</h2>
              {missingValues ? (
                <div className="flex items-end gap-2">
                  <Field label="Unidad para las vacías">
                    <Input value={bulkUnit} onChange={(e) => setBulkUnit(e.target.value)} placeholder="p. ej. und, m, m3" className="w-40" />
                  </Field>
                  <Button
                    disabled={!bulkUnit.trim()}
                    onClick={() =>
                      setOverrides((o) => {
                        const next = { ...o };
                        plan.activities.filter((a) => a.unit == null && !o[a.code]?.unit).forEach((a) => (next[a.code] = { ...next[a.code], unit: bulkUnit.trim() }));
                        return next;
                      })
                    }
                  >
                    Aplicar
                  </Button>
                </div>
              ) : null}
              <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtrar" className="w-48">
                <option value="all">Todas ({diff.activities.length})</option>
                {(Object.keys(STATUS) as ActivityOp["status"][]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label} ({diff.activities.filter((a) => a.status === s).length})
                  </option>
                ))}
              </Select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-2">Estado</th>
                    <th className="pr-2">Frente</th>
                    <th className="pr-2">Actividad</th>
                    <th className="pr-2">Unidad</th>
                    <th className="pr-2 text-right">Cantidad</th>
                    <th className="pr-2">Inicio → fin</th>
                    <th className="pr-2">Predecesoras</th>
                    <th>Cambios</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((op) => {
                    const a = op.activity;
                    const raw = plan.activities.find((x) => x.code === a.code)!;
                    const needsValues = !op.existingId;
                    const o = overrides[a.code] ?? {};
                    const set = (k: "unit" | "quantity", v: string) => setOverrides((prev) => ({ ...prev, [a.code]: { ...prev[a.code], [k]: v } }));
                    return (
                      <tr key={a.code} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                        <td className="py-2 pr-2">
                          <Badge tone={STATUS[op.status].tone}>{STATUS[op.status].label}</Badge>
                        </td>
                        <td className="py-2 pr-2 font-semibold">{op.frontCode}</td>
                        <td className="py-2 pr-2">
                          <b>{a.code}</b> · {a.name}
                        </td>
                        <td className="py-2 pr-2">
                          {raw.unit == null && needsValues ? (
                            <Input value={o.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="unidad" className="w-24 py-1" aria-label={`Unidad de ${a.code}`} />
                          ) : (
                            (a.unit ?? <span className="text-zinc-400">se conserva</span>)
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {raw.quantity == null && needsValues ? (
                            <Input value={o.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} placeholder="cantidad" inputMode="decimal" className="w-28 py-1 text-right" aria-label={`Cantidad de ${a.code}`} />
                          ) : a.quantity != null ? (
                            a.quantity.toLocaleString("es-CO")
                          ) : (
                            <span className="text-zinc-400">se conserva</span>
                          )}
                        </td>
                        <td className="py-2 pr-2 tabular-nums text-sm">
                          {a.start ?? "—"} → {a.finish ?? "—"}
                        </td>
                        <td className="py-2 pr-2 text-sm">{a.predecessors.join(", ") || "—"}</td>
                        <td className="py-2 text-sm">
                          {op.problems.map((p) => (
                            <div key={p} className="font-semibold text-red-700 dark:text-red-400">
                              {p}
                            </div>
                          ))}
                          {op.changes.map((c) => (
                            <div key={c.field}>
                              <b>{c.field}</b>: <span className="text-zinc-500 line-through">{c.from}</span> → {c.to}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {scheduleExtras.historyDays ? (
            <Card>
              <h2 className="text-lg font-bold">Historial diario del informe</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                El archivo trae {scheduleExtras.historyDays.toLocaleString("es-CO")} registro(s) diarios de lo ejecutado. Se cargan como avance aprobado solo los días
                posteriores al último registro de cada actividad, así que volver a importar el informe de la semana siguiente suma lo nuevo sin duplicar.
              </p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={importHistory} onChange={(e) => setImportHistory(e.target.checked)} className="h-5 w-5 accent-blue-700" />
                Autorizo cargar el historial diario como registros aprobados
              </label>
            </Card>
          ) : null}

          {plan?.source === "msproject" && scheduleExtras.baselines && ex?.zones.some((z) => z.workGroup) ? (
            <BaselineMatcher plan={plan} existing={ex} projectId={projectId} onDone={(text) => setMsg({ tone: "ok", text })} />
          ) : null}

          {scheduleExtras.baselines || scheduleExtras.progress ? (
            <Card>
              <h2 className="text-lg font-bold">Lo que trae el cronograma además de las fechas</h2>
              <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {scheduleExtras.baselines ? (
                  <li>
                    Línea base en {scheduleExtras.baselines} actividad(es) ({scheduleExtras.names.join(", ")}): se guarda y se compara en la curva S.
                  </li>
                ) : null}
                {scheduleExtras.progress ? (
                  <li>
                    Avance (% completado y fechas reales) en {scheduleExtras.progress} actividad(es)
                    {plan?.statusDate ? `, con fecha de estado ${plan.statusDate}` : ", sin fecha de estado (se usa hoy)"}.
                  </li>
                ) : (
                  <li>Sin avance registrado (todas las tareas al 0 %): el historial diario sale de los registros de campo o del informe de obra.</li>
                )}
              </ul>
              {scheduleExtras.progress ? (
                <label className="mt-3 flex items-start gap-2 font-semibold">
                  <input type="checkbox" checked={importProgress} onChange={(e) => setImportProgress(e.target.checked)} className="mt-0.5 h-5 w-5 accent-blue-700" />
                  <span>
                    Autorizo cargar ese avance como registros aprobados
                    <span className="block text-sm font-normal text-zinc-500">
                      MS Project guarda el % acumulado, no cada día: se carga solo lo que falta frente a lo ya registrado, repartido en los días laborables entre el
                      comienzo real y la fecha de estado. Cada nueva revisión del cronograma suma su avance sin duplicar.
                    </span>
                  </span>
                </label>
              ) : null}
            </Card>
          ) : null}

          <Card className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} className="h-5 w-5 accent-blue-700" />
              Autorizo actualizar las actividades existentes ({diff.summary.updated} con cambios)
            </label>
            <span className="text-sm text-zinc-500">
              {diff.summary.blocked ? `${diff.summary.blocked} actividad(es) bloqueadas no se importan (mira el motivo en la tabla). ` : ""}
              {updateExisting ? "" : "Sin autorizar, solo se crea lo nuevo. "}
              Cambiar fechas o cantidades recalcula semáforos, curva S y simulador.
            </span>
            <Button
              variant="primary"
              className="ml-auto"
              disabled={
                busy ||
                blockingErrors > 0 ||
                diff.summary.newActivities +
                  diff.summary.newFronts +
                  (updateExisting ? diff.summary.updated : 0) +
                  scheduleExtras.baselines +
                  (importProgress ? scheduleExtras.progress : 0) +
                  (importHistory ? scheduleExtras.historyDays : 0) ===
                0
              }
              onClick={() => void onApply()}
            >
              {busy ? "Importando…" : "Importar"}
            </Button>
          </Card>
        </>
      ) : null}

      {runs.length ? (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Importaciones anteriores</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-1.5 pr-3">Fecha</th>
                  <th className="pr-3">Archivo</th>
                  <th className="pr-3">Resultado</th>
                  <th>Actualizó existentes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-1.5 pr-3 tabular-nums">{new Date(r.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="pr-3">
                      {r.file_name} <span className="text-zinc-500">({r.kind === "dxf" ? "DXF" : r.source})</span>
                    </td>
                    <td className="pr-3">
                      {Object.entries(r.summary)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
                        .join(" · ") || "Sin cambios"}
                    </td>
                    <td>{r.updated_existing ? `Sí: ${r.changes.map((c) => c.codigo).join(", ") || "—"}` : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
