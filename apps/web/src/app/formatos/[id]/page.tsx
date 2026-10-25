"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  CATEGORY_LABEL,
  formulaRefs,
  newField,
  sameDefinition,
  slugId,
  validateDefinition,
  WORK_TYPES,
  type Condition,
  type Field,
  type FieldType,
  type FormCategory,
  type FormDefinition,
} from "@avanceobra/forms";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, Palette, PaletteGhost } from "@/components/builder/Canvas";
import { Preview } from "@/components/builder/Preview";
import { Properties } from "@/components/builder/Properties";
import { Badge, Button, Card, Field as Row, Input, Select, cx } from "@/components/ui";
import { exportExcel, exportJson, importFile } from "@/lib/formsIO";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Version {
  id: string;
  version: number;
  created_at: string;
  changelog: string | null;
  published_by_name: string | null;
}

interface ActivityRow {
  id: string;
  code: string;
  name: string;
  template_id: string | null;
  project: { code: string } | null;
}

/** Cambia un id en fórmulas y condiciones para no romper referencias al renombrar. */
function renameRefs(def: FormDefinition, oldId: string, newId: string): FormDefinition {
  const re = new RegExp(`(?<![A-Za-z0-9_])${oldId}(?![A-Za-z0-9_])`, "g");
  const cond = (c?: Condition): Condition | undefined =>
    !c ? c : "all" in c ? { all: c.all.map((x) => cond(x)!) } : "any" in c ? { any: c.any.map((x) => cond(x)!) } : c.field === oldId ? { ...c, field: newId } : c;
  return {
    ...def,
    fields: def.fields.map((f) => {
      const g = { ...f, id: f.id === oldId ? newId : f.id, showIf: cond(f.showIf) } as Field;
      if (g.type === "formula") g.expression = g.expression.replace(re, newId);
      if (g.type === "table") g.columns = g.columns.map((c) => (c.type === "formula" ? { ...c, expression: c.expression.replace(re, newId) } : c));
      return g;
    }),
  };
}

export default function Builder() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, projectIds } = useSession();
  const [published, setPublished] = useState<FormDefinition | null>(null);
  const [def, setDef] = useState<FormDefinition | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"editar" | "probar" | "asignar" | "historial">("editar");
  const [dragType, setDragType] = useState<FieldType | null>(null);
  const [changelog, setChangelog] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const readOnly = !isAdmin;

  const load = useCallback(async () => {
    const [{ data: t }, { data: vs }] = await Promise.all([
      supabase.from("form_templates").select("archived, current_version").eq("id", id).single(),
      supabase.from("form_template_versions").select("id, version, schema, created_at, changelog, published_by_name").eq("template_id", id).order("version", { ascending: false }),
    ]);
    const current = (vs ?? []).find((v) => v.version === t?.current_version) ?? vs?.[0];
    if (current) {
      setPublished(current.schema as FormDefinition);
      setDef(structuredClone(current.schema as FormDefinition));
    }
    setVersions((vs ?? []) as Version[]);
    setArchived(Boolean(t?.archived));
  }, [id]);

  const loadActivities = useCallback(async () => {
    if (!projectIds.length) return;
    const { data } = await supabase
      .from("activities")
      .select("id, code, name, template_id, project:projects(code)")
      .in("project_id", projectIds)
      .order("code");
    setActivities((data ?? []) as unknown as ActivityRow[]);
  }, [projectIds]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  const validation = useMemo(() => (def ? validateDefinition(def) : null), [def]);
  const issuesByField = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of validation?.issues ?? []) {
      const key = (i.fieldId ?? "").split(".")[0]!;
      m.set(key, [...(m.get(key) ?? []), i.message]);
    }
    return m;
  }, [validation]);
  const dirty = Boolean(def && published && !sameDefinition(def, published));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (!def) return <div className="text-zinc-500">Cargando formato…</div>;

  const setFields = (fields: Field[]) => setDef({ ...def, fields });
  const add = (type: FieldType, at?: number) => {
    const f = newField(type, def.fields.map((x) => x.id));
    const fields = [...def.fields];
    fields.splice(at ?? fields.length, 0, f);
    setFields(fields);
    setSelected(f.id);
  };

  function onDragStart(e: DragStartEvent) {
    const a = String(e.active.id);
    if (a.startsWith("palette:")) setDragType(a.slice(8) as FieldType);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragType(null);
    const a = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || !def) return;
    if (a.startsWith("palette:")) {
      const idx = over === "canvas" ? def.fields.length : def.fields.findIndex((f) => f.id === over);
      add(a.slice(8) as FieldType, idx < 0 ? undefined : idx);
      return;
    }
    if (a !== over && over !== "canvas") {
      const from = def.fields.findIndex((f) => f.id === a);
      const to = def.fields.findIndex((f) => f.id === over);
      setFields(arrayMove(def.fields, from, to));
    }
  }

  function remove(fid: string) {
    const used = def!.fields.filter((f) => {
      if (f.id === fid) return false;
      const inFormula = f.type === "formula" && (() => { try { return formulaRefs(f.expression).includes(fid); } catch { return false; } })();
      return inFormula || JSON.stringify(f.showIf ?? {}).includes(`"${fid}"`);
    });
    if (used.length && !confirm(`"${fid}" se usa en: ${used.map((u) => u.label).join(", ")}. ¿Eliminar de todos modos?`)) return;
    setFields(def!.fields.filter((f) => f.id !== fid));
    if (selected === fid) setSelected(null);
  }

  function duplicate(fid: string) {
    const i = def!.fields.findIndex((f) => f.id === fid);
    const src = def!.fields[i]!;
    const copy = { ...structuredClone(src), id: slugId(`${src.id}_copia`, def!.fields.map((f) => f.id)), label: `${src.label} (copia)` } as Field;
    const fields = [...def!.fields];
    fields.splice(i + 1, 0, copy);
    setFields(fields);
    setSelected(copy.id);
  }

  async function publish() {
    if (!validation?.ok || !def) return;
    const { data, error } = await supabase.rpc("publish_form_version", { p_template: id, p_schema: def, p_changelog: changelog.trim() || null });
    if (error) return setMsg({ tone: "error", text: `No se pudo publicar: ${error.message}` });
    const r = (data as { version: number; created: boolean }[])[0];
    setMsg({ tone: "ok", text: r?.created ? `✓ Publicada la versión ${r.version}. Los teléfonos la reciben al sincronizar.` : "No hay cambios respecto a la versión publicada." });
    setChangelog("");
    await load();
  }

  async function toggleAssign(a: ActivityRow) {
    const next = a.template_id === id ? null : id;
    const { error } = await supabase.from("activities").update({ template_id: next }).eq("id", a.id);
    if (error) return setMsg({ tone: "error", text: error.message });
    setActivities((xs) => xs.map((x) => (x.id === a.id ? { ...x, template_id: next } : x)));
  }

  async function onImport(file: File) {
    const r = await importFile(file);
    if (!r.definition) return setMsg({ tone: "error", text: `El archivo tiene problemas: ${r.issues.join(" · ")}` });
    setDef(r.definition);
    setMsg({ tone: "ok", text: "Importado. Revisa y publica para crear una versión nueva." });
  }

  const sel = def.fields.find((f) => f.id === selected) ?? null;
  const selIndex = sel ? def.fields.indexOf(sel) : -1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/formatos" className="text-sm text-blue-700 hover:underline">
            ← Formatos
          </Link>
          <h1 className="text-2xl font-extrabold">{def.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="blue">{CATEGORY_LABEL[def.category]}</Badge>
            <Badge>{def.workType}</Badge>
            <Badge>{`Publicada v${versions[0]?.version ?? 0}`}</Badge>
            {dirty ? <Badge tone="amber">Cambios sin publicar</Badge> : <Badge tone="green">Al día</Badge>}
            {archived ? <Badge tone="amber">Archivado</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportJson(def)}>Exportar JSON</Button>
          <Button onClick={() => void exportExcel(def)}>Exportar Excel</Button>
          {!readOnly ? (
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-[15px] font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
              Importar
              <input type="file" accept=".json,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
            </label>
          ) : null}
        </div>
      </div>

      {msg ? (
        <div className={cx("rounded-lg px-4 py-2 font-semibold", msg.tone === "ok" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300")}>
          {msg.text}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ["editar", "Editar"],
            ["probar", "Probar"],
            ["asignar", `Asignar a actividades (${activities.filter((a) => a.template_id === id).length})`],
            ["historial", `Versiones (${versions.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx("-mb-px border-b-2 px-4 py-2 font-semibold", tab === k ? "border-blue-700 text-blue-800 dark:text-blue-300" : "border-transparent text-zinc-500 hover:text-zinc-800")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "editar" ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragType(null)}>
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
            <Card className="h-fit lg:sticky lg:top-20">
              <Palette onAdd={(t) => add(t)} disabled={readOnly} />
            </Card>
            <div className="space-y-3">
              <Card className="grid gap-3 sm:grid-cols-3">
                <Row label="Nombre" className="sm:col-span-3">
                  <Input value={def.name} disabled={readOnly} onChange={(e) => setDef({ ...def, name: e.target.value })} />
                </Row>
                <Row label="Categoría">
                  <Select value={def.category} disabled={readOnly} onChange={(e) => setDef({ ...def, category: e.target.value as FormCategory })}>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Row>
                <Row label="Tipo de obra">
                  <Select value={def.workType} disabled={readOnly} onChange={(e) => setDef({ ...def, workType: e.target.value })}>
                    {[...new Set([...WORK_TYPES, def.workType])].map((w) => (
                      <option key={w}>{w}</option>
                    ))}
                  </Select>
                </Row>
                <Row label="Descripción">
                  <Input value={def.description ?? ""} disabled={readOnly} onChange={(e) => setDef({ ...def, description: e.target.value || undefined })} />
                </Row>
              </Card>
              <Canvas
                fields={def.fields}
                selectedId={selected}
                onSelect={setSelected}
                onRemove={remove}
                onDuplicate={duplicate}
                issuesByField={issuesByField}
                readOnly={readOnly}
              />
            </div>
            <div className="space-y-3 lg:sticky lg:top-20 lg:h-fit">
              {!readOnly ? (
                <Card className="space-y-2">
                  {validation && !validation.ok ? (
                    <div className="text-sm font-semibold text-red-700">
                      Corrige {validation.issues.length} problema(s) para publicar:
                      <ul className="mt-1 list-disc pl-5 font-normal">
                        {validation.issues.slice(0, 6).map((i, k) => (
                          <li key={k}>{i.fieldId ? `${i.fieldId}: ` : ""}{i.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-green-700">✓ Formato válido</div>
                  )}
                  <Input placeholder="¿Qué cambió? (opcional)" value={changelog} onChange={(e) => setChangelog(e.target.value)} />
                  <div className="flex gap-2">
                    <Button variant="primary" className="flex-1" disabled={!dirty || !validation?.ok} onClick={() => void publish()}>
                      Publicar versión {(versions[0]?.version ?? 0) + 1}
                    </Button>
                    <Button variant="ghost" disabled={!dirty} onClick={() => published && setDef(structuredClone(published))}>
                      Descartar
                    </Button>
                  </div>
                </Card>
              ) : null}
              <Card>
                {sel ? (
                  <Properties
                    field={sel}
                    previous={def.fields.slice(0, selIndex)}
                    allIds={def.fields.map((f) => f.id)}
                    onChange={(f) => !readOnly && setFields(def.fields.map((x) => (x.id === sel.id ? f : x)))}
                    onRename={(o, n) => {
                      if (readOnly) return;
                      setDef(renameRefs(def, o, n));
                      setSelected(n);
                    }}
                  />
                ) : (
                  <p className="text-zinc-500">Selecciona un campo para editar sus propiedades.</p>
                )}
              </Card>
            </div>
          </div>
          <DragOverlay>{dragType ? <PaletteGhost type={dragType} /> : null}</DragOverlay>
        </DndContext>
      ) : null}

      {tab === "probar" ? (validation?.ok ? <Preview definition={def} /> : <p className="font-semibold text-red-700">Corrige los problemas del formato para probarlo.</p>) : null}

      {tab === "asignar" ? (
        <Card>
          <p className="mb-3 text-zinc-600 dark:text-zinc-400">
            Las actividades marcadas piden este formato al registrar avance en el teléfono (con la última versión publicada).
          </p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {activities.map((a) => (
              <label key={a.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <input type="checkbox" disabled={readOnly} checked={a.template_id === id} onChange={() => void toggleAssign(a)} />
                <span>
                  <span className="font-semibold">{a.code}</span> · {a.name}
                  {a.template_id && a.template_id !== id ? <span className="ml-1 text-xs text-amber-700">(tiene otro formato)</span> : null}
                </span>
              </label>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "historial" ? (
        <Card>
          <table className="w-full text-left text-[15px]">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-2">Versión</th>
                <th>Publicada</th>
                <th>Por</th>
                <th>Cambios</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 font-bold">v{v.version}</td>
                  <td>{new Date(v.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{v.published_by_name ?? "—"}</td>
                  <td>{v.changelog ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly ? (
            <div className="mt-4">
              <Button
                variant={archived ? "secondary" : "danger"}
                onClick={async () => {
                  await supabase.from("form_templates").update({ archived: !archived }).eq("id", id);
                  setArchived(!archived);
                }}
              >
                {archived ? "Reactivar formato" : "Archivar formato"}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
