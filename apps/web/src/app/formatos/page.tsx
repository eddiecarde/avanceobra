"use client";

import { CATEGORY_LABEL, emptyDefinition, TEMPLATES, WORK_TYPES, type FormCategory, type FormDefinition } from "@avanceobra/forms";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { importFile } from "@/lib/formsIO";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface TemplateRow {
  id: string;
  name: string;
  category: FormCategory;
  work_type: string | null;
  current_version: number;
  archived: boolean;
  updated_at: string;
  activities: { count: number }[];
}

/** Catálogo de formatos de la empresa: crear (en blanco o desde plantilla), importar y abrir el constructor. */
export default function Formatos() {
  const { orgId, isAdmin } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<FormCategory>("avance");
  const [workType, setWorkType] = useState("solar");
  const [base, setBase] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("form_templates")
      .select("id, name, category, work_type, current_version, archived, updated_at, activities(count)")
      .eq("org_id", orgId)
      .order("name");
    setRows((data ?? []) as unknown as TemplateRow[]);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Crea el formato y publica su versión 1 en una sola acción. */
  async function create(def: FormDefinition, templateKey?: string) {
    if (!orgId) return;
    const { data: t, error } = await supabase
      .from("form_templates")
      .insert({ org_id: orgId, name: def.name, category: def.category, work_type: def.workType, current_version: 0, description: def.description ?? null, template_key: templateKey ?? null })
      .select("id")
      .single();
    if (error || !t) return setMsg(`No se pudo crear: ${error?.message}`);
    const { error: e2 } = await supabase.rpc("publish_form_version", { p_template: t.id, p_schema: def, p_changelog: "Creación" });
    if (e2) return setMsg(`Se creó, pero no se pudo publicar: ${e2.message}`);
    router.push(`/formatos/${t.id}`);
  }

  async function onCreate() {
    if (name.trim().length < 3) return setMsg("Escribe un nombre de al menos 3 letras.");
    const tpl = TEMPLATES.find((x) => x.key === base);
    const def: FormDefinition = tpl ? { ...structuredClone(tpl.definition), name: name.trim() } : emptyDefinition(name.trim(), category, workType);
    await create(def, tpl?.key);
  }

  async function onImport(file: File) {
    const r = await importFile(file);
    if (!r.definition) return setMsg(`El archivo tiene problemas:\n• ${r.issues.join("\n• ")}`);
    await create(r.definition);
  }

  const visible = rows.filter((r) => showArchived || !r.archived);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Formatos</h1>
          <p className="text-zinc-500">Avance, inspección, checklist e informe diario. Cada registro guarda la versión con que se llenó.</p>
        </div>
        {isAdmin ? (
          <div className="flex gap-2">
            <Button onClick={() => fileRef.current?.click()}>Importar JSON / Excel</Button>
            <Button variant="primary" onClick={() => setCreating((c) => !c)}>
              ＋ Nuevo formato
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : null}
      </div>

      {msg ? (
        <div className="whitespace-pre-line rounded-lg bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {msg}{" "}
          <button className="ml-2 underline" onClick={() => setMsg(null)}>
            cerrar
          </button>
        </div>
      ) : null}

      {creating ? (
        <Card className="grid gap-4 md:grid-cols-5">
          <Field label="Nombre" className="md:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inspección de hincado — Bloque C" autoFocus />
          </Field>
          <Field label="Partir de">
            <Select value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Formato en blanco</option>
              {TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  Plantilla: {t.definition.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Categoría">
            <Select value={category} onChange={(e) => setCategory(e.target.value as FormCategory)} disabled={Boolean(base)}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de obra">
            <Select value={workType} onChange={(e) => setWorkType(e.target.value)} disabled={Boolean(base)}>
              {WORK_TYPES.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2 md:col-span-5">
            <Button variant="primary" onClick={() => void onCreate()}>
              Crear y abrir el constructor
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <input id="arch" type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        <label htmlFor="arch">Mostrar archivados</label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => (
          <Link key={r.id} href={`/formatos/${r.id}`} className="block">
            <Card className="h-full transition hover:border-blue-400 hover:shadow-sm">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Badge tone="blue">{CATEGORY_LABEL[r.category] ?? r.category}</Badge>
                <Badge>{r.work_type ?? "general"}</Badge>
                {r.archived ? <Badge tone="amber">Archivado</Badge> : null}
              </div>
              <div className="text-lg font-bold leading-snug">{r.name}</div>
              <div className="mt-1 text-sm text-zinc-500">
                v{r.current_version} · {r.activities?.[0]?.count ?? 0} actividad(es) lo usan
              </div>
            </Card>
          </Link>
        ))}
      </div>
      {visible.length === 0 ? <p className="text-zinc-500">Aún no hay formatos.</p> : null}
    </div>
  );
}
