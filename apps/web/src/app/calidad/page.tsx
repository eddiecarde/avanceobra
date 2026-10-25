"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { localToday, SEVERITY_LABEL } from "@/lib/dashboard";
import { PunchHandover } from "@/components/PunchHandover";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Category = "observacion" | "no_conformidad" | "punch";
type FStatus = "open" | "in_correction" | "to_review" | "closed";
const CATEGORY_LABEL: Record<Category, string> = { observacion: "Observación", no_conformidad: "No conformidad", punch: "Punch" };
const STATUS_LABEL: Record<FStatus, string> = { open: "Abierto", in_correction: "En corrección", to_review: "Por verificar", closed: "Cerrado" };
const POINT_LABEL: Record<string, string> = { espera: "Espera", testigo: "Testigo", revision: "Revisión" };

interface Activity {
  id: string;
  code: string;
  name: string;
  front_id: string;
  company_id: string | null;
}
interface Company {
  id: string;
  name: string;
}
interface Finding {
  id: string;
  category: Category;
  type: string;
  severity: string;
  status: FStatus;
  description: string;
  impeditive: boolean;
  activity_id: string | null;
  element_id: string | null;
  company_id: string | null;
  due_date: string | null;
  corrective_action: string | null;
  verification_note: string | null;
  verified_at: string | null;
  inspection_id: string | null;
  created_at: string;
}
interface Checklist {
  id: string;
  name: string;
  activity_id: string | null;
  items: { id: string; text: string }[];
  active: boolean;
}
interface Point {
  id: string;
  activity_id: string;
  name: string;
  criterion: string | null;
  frequency: string | null;
  point_type: string;
  responsible: string | null;
  checklist_id: string | null;
}
interface Inspection {
  id: string;
  checklist_id: string;
  activity_id: string | null;
  element_id: string | null;
  location_note: string | null;
  inspected_on: string;
  result: "aprobada" | "rechazada";
  answers: { id: string; text: string; result: string; note: string | null }[];
}

type Tab = "nc" | "inspecciones" | "plan" | "listas" | "entrega";
const TABS: [Tab, string][] = [
  ["nc", "No conformidades y punch"],
  ["inspecciones", "Inspecciones"],
  ["plan", "Plan de inspección"],
  ["listas", "Listas de chequeo"],
  ["entrega", "Entrega del punch"],
];
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Calidad: no conformidades y punch list con responsable, fecha límite, impeditivo o no y cierre
 * verificado; inspecciones con listas de chequeo (cada "no cumple" abre una no conformidad); y el
 * plan de inspección y ensayo por actividad.
 */
export default function Calidad() {
  const { memberships, session } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canManage = role === "resident" || role === "director" || role === "admin";
  const today = localToday();

  const [tab, setTab] = useState<Tab>("nc");
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [elementCodes, setElementCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      supabase.from("activities").select("id, code, name, front_id, company_id").eq("project_id", projectId).order("code"),
      supabase.from("project_companies").select("id, name").eq("project_id", projectId).order("name"),
      supabase
        .from("findings")
        .select("id, category, type, severity, status, description, impeditive, activity_id, element_id, company_id, due_date, corrective_action, verification_note, verified_at, inspection_id, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("checklists").select("id, name, activity_id, items, active").eq("project_id", projectId).order("name"),
      supabase.from("inspection_points").select("id, activity_id, name, criterion, frequency, point_type, responsible, checklist_id").eq("project_id", projectId).order("sort"),
      supabase.from("inspections").select("id, checklist_id, activity_id, element_id, location_note, inspected_on, result, answers").eq("project_id", projectId).order("inspected_on", { ascending: false }).limit(200),
    ]).then(async ([a, c, f, l, p, i]) => {
      if (off) return;
      const fs = (f.data ?? []) as Finding[];
      const ins = (i.data ?? []) as Inspection[];
      setActs((a.data ?? []) as Activity[]);
      setCompanies((c.data ?? []) as Company[]);
      setFindings(fs);
      setChecklists((l.data ?? []) as Checklist[]);
      setPoints((p.data ?? []) as Point[]);
      setInspections(ins);
      // Códigos de los elementos del plano mencionados (sin descargar todo el plano)
      const ids = [...new Set([...fs, ...ins].map((x) => x.element_id).filter((x): x is string => !!x))];
      if (ids.length) {
        const { data } = await supabase.from("elements").select("id, code").in("id", ids);
        if (!off) setElementCodes(Object.fromEntries((data ?? []).map((e: { id: string; code: string }) => [e.id, e.code])));
      }
    });
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const reload = () => setVersion((v) => v + 1);
  const actOf = (id: string | null) => acts.find((a) => a.id === id);
  const actLabel = (id: string | null) => (actOf(id) ? `${actOf(id)!.code} · ${actOf(id)!.name}` : "—");
  const companyOf = (id: string | null) => companies.find((c) => c.id === id)?.name ?? "Sin empresa";

  async function act(run: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setMsg(null);
    const { error } = await run();
    setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: ok });
    if (!error) reload();
    return !error;
  }

  /** Busca un elemento del plano por su código (TRK-001). */
  async function elementId(code: string): Promise<string | null | false> {
    if (!code.trim()) return null;
    const { data } = await supabase.from("elements").select("id").eq("project_id", projectId).eq("code", code.trim().toUpperCase()).maybeSingle();
    return (data?.id as string | undefined) ?? false;
  }

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Calidad</h1>
          <p className="text-zinc-600 dark:text-zinc-400">No conformidades, punch list, inspecciones con listas de chequeo y el plan de inspección y ensayo.</p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => setPicked(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("rounded-t-lg px-3 py-2 font-semibold", tab === k ? "border-b-2 border-blue-700 text-blue-800 dark:text-blue-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900")}
          >
            {label}
          </button>
        ))}
      </div>

      {msg ? (
        <p role={msg.tone === "error" ? "alert" : "status"} className={cx("rounded-lg px-4 py-2 font-semibold", msg.tone === "ok" ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200")}>
          {msg.text}
        </p>
      ) : null}

      {tab === "nc" ? (
        <NcTab {...{ findings, acts, companies, canManage, today, actLabel, companyOf, elementCodes, act, elementId, projectId, me: session?.user.id ?? "", setMsg }} />
      ) : tab === "inspecciones" ? (
        <InspectionsTab {...{ checklists, inspections, acts, actLabel, elementCodes, findings, projectId, today, elementId, act, setMsg }} />
      ) : tab === "entrega" ? (
        <PunchHandover projectId={projectId} canManage={canManage} today={today} />
      ) : tab === "plan" ? (
        <PlanTab {...{ points, acts, checklists, canManage, actLabel, act, projectId }} />
      ) : (
        <ChecklistsTab {...{ checklists, acts, canManage, actLabel, act, projectId }} />
      )}
    </div>
  );
}

type ActFn = (run: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => Promise<boolean>;
type SetMsg = (m: { tone: "ok" | "error"; text: string } | null) => void;

function NcTab(p: {
  findings: Finding[];
  acts: Activity[];
  companies: Company[];
  canManage: boolean;
  today: string;
  actLabel: (id: string | null) => string;
  companyOf: (id: string | null) => string;
  elementCodes: Record<string, string>;
  act: ActFn;
  elementId: (code: string) => Promise<string | null | false>;
  projectId: string;
  me: string;
  setMsg: SetMsg;
}) {
  const [cat, setCat] = useState<"" | Category>("");
  const [state, setState] = useState<"abiertos" | "todos" | "cerrados">("abiertos");
  const [onlyImp, setOnlyImp] = useState(false);
  const [company, setCompany] = useState("");
  const [closing, setClosing] = useState<{ id: string; note: string; file: File | null } | null>(null);
  const empty = { category: "no_conformidad" as Category, description: "", activity_id: "", element: "", company_id: "", impeditive: false, severity: "medium", due_date: addDaysIso(p.today, 7) };
  const [form, setForm] = useState(empty);

  const rows = p.findings.filter(
    (f) =>
      (!cat || f.category === cat) &&
      (state === "todos" || (state === "abiertos" ? f.status !== "closed" : f.status === "closed")) &&
      (!onlyImp || f.impeditive) &&
      (!company || (f.company_id ?? "none") === company),
  );
  const open = p.findings.filter((f) => f.status !== "closed" && f.category !== "observacion");
  const impOpen = open.filter((f) => f.impeditive).length;
  const overdue = open.filter((f) => f.due_date && f.due_date < p.today).length;

  async function create() {
    if (form.description.trim().length < 5) return p.setMsg({ tone: "error", text: "Describe la no conformidad o el pendiente (al menos 5 letras)." });
    const el = await p.elementId(form.element);
    if (el === false) return p.setMsg({ tone: "error", text: `No hay un elemento con el código ${form.element.trim().toUpperCase()} en el plano.` });
    const a = p.acts.find((x) => x.id === form.activity_id);
    const ok = await p.act(
      () =>
        supabase.from("findings").insert({
          id: crypto.randomUUID(),
          project_id: p.projectId,
          front_id: a?.front_id ?? null,
          type: "quality",
          severity: form.severity,
          description: form.description.trim(),
          category: form.category,
          impeditive: form.impeditive,
          activity_id: a?.id ?? null,
          element_id: el,
          company_id: form.company_id || a?.company_id || null,
          due_date: form.due_date || null,
          created_by: p.me,
        }),
      `${CATEGORY_LABEL[form.category]} registrada.`,
    );
    if (ok) setForm(empty);
  }

  // Cierre verificado: primero la foto del "después" (archivo y su fila), luego el estado con la nota
  async function closeWithPhoto(f: Finding, note: string, file: File | null) {
    if (f.category !== "observacion" && !file) {
      p.setMsg({ tone: "error", text: "Adjunta la foto de cierre: es la evidencia de cómo quedó." });
      return false;
    }
    if (file) {
      const photoId = crypto.randomUUID();
      const path = `${p.projectId}/${f.id}/${photoId}.jpg`;
      const up = await supabase.storage.from("photos").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (up.error) {
        p.setMsg({ tone: "error", text: `No se pudo subir la foto: ${up.error.message}` });
        return false;
      }
      const row = await supabase
        .from("photos")
        .insert({ id: photoId, project_id: p.projectId, finding_id: f.id, storage_path: path, taken_at: new Date().toISOString(), annotation: "Cierre", uploaded: true, purpose: "cierre" });
      if (row.error) {
        p.setMsg({ tone: "error", text: row.error.message });
        return false;
      }
    }
    return move(f, "closed", { verification_note: note.trim() || null });
  }

  const move = (f: Finding, status: FStatus, extra: Record<string, unknown> = {}) =>
    p.act(() => supabase.from("findings").update({ status, ...extra }).eq("id", f.id), `${CATEGORY_LABEL[f.category]}: ${STATUS_LABEL[status].toLowerCase()}.`);

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Abiertos", open.length, open.length ? "warn" : "good"],
          ["Impeditivos abiertos", impOpen, impOpen ? "bad" : "good"],
          ["Vencidos", overdue, overdue ? "bad" : "good"],
        ].map(([label, n, tone]) => (
          <Card key={label as string} className="p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</div>
            <div className={cx("text-2xl font-extrabold tabular-nums", tone === "bad" && "text-red-700 dark:text-red-400", tone === "warn" && "text-amber-700 dark:text-amber-400", tone === "good" && "text-green-700 dark:text-green-400")}>{n}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Categoría">
            <Select value={cat} onChange={(e) => setCat(e.target.value as "" | Category)}>
              <option value="">Todas</option>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => (
                <option key={k} value={k}>
                  {CATEGORY_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={state} onChange={(e) => setState(e.target.value as typeof state)}>
              <option value="abiertos">Abiertos</option>
              <option value="cerrados">Cerrados</option>
              <option value="todos">Todos</option>
            </Select>
          </Field>
          <Field label="Empresa responsable">
            <Select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Todas</option>
              {p.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">Sin empresa</option>
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2 font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={onlyImp} onChange={(e) => setOnlyImp(e.target.checked)} />
            Solo impeditivos
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-3">Qué</th>
                <th className="pr-3">Actividad / elemento</th>
                <th className="pr-3">Responsable</th>
                <th className="pr-3">Límite</th>
                <th className="pr-3">Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <Fragment key={f.id}>
                  <tr className="border-b border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-2 pr-3">
                      <Badge tone={f.category === "no_conformidad" ? "red" : f.category === "punch" ? "amber" : "neutral"}>{CATEGORY_LABEL[f.category]}</Badge>{" "}
                      {f.impeditive ? <Badge tone="red">Impeditivo</Badge> : null} <span className="text-sm text-zinc-500">{SEVERITY_LABEL[f.severity]}</span>
                      <div>{f.description}</div>
                      {f.corrective_action ? <div className="text-sm text-zinc-600 dark:text-zinc-400">Acción: {f.corrective_action}</div> : null}
                      {f.verification_note ? <div className="text-sm text-green-800 dark:text-green-300">Verificado: {f.verification_note}</div> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {p.actLabel(f.activity_id)}
                      {f.element_id ? <div className="text-sm text-zinc-500">Elemento {p.elementCodes[f.element_id] ?? "del plano"}</div> : null}
                    </td>
                    <td className="py-2 pr-3">{p.companyOf(f.company_id)}</td>
                    <td className={cx("py-2 pr-3 tabular-nums", f.status !== "closed" && f.due_date && f.due_date < p.today && "font-bold text-red-700 dark:text-red-400")}>{f.due_date ?? "—"}</td>
                    <td className="py-2 pr-3">{STATUS_LABEL[f.status]}</td>
                    <td className="py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {f.status === "open" ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              const action = window.prompt("Acción correctiva (qué se va a hacer)")?.trim();
                              if (action !== undefined) void move(f, "in_correction", action ? { corrective_action: action } : {});
                            }}
                          >
                            Iniciar corrección
                          </Button>
                        ) : null}
                        {f.status === "in_correction" ? (
                          <Button size="sm" onClick={() => void move(f, "to_review")}>
                            Pedir verificación
                          </Button>
                        ) : null}
                        {f.status === "to_review" && p.canManage ? (
                          <>
                            <Button size="sm" variant="primary" onClick={() => setClosing({ id: f.id, note: "", file: null })}>
                              Verificar y cerrar
                            </Button>
                            <Button size="sm" onClick={() => void move(f, "in_correction")}>
                              Devolver
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {closing?.id === f.id ? (
                    <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                      <td colSpan={6} className="p-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="Verificación del cierre" hint="(qué se revisó y cómo quedó)" className="min-w-80 flex-1">
                            <Input value={closing.note} onChange={(e) => setClosing({ ...closing, note: e.target.value })} placeholder="p. ej. Cota verificada con topografía, dentro de tolerancia" />
                          </Field>
                          <Field label="Foto de cierre" hint="(cómo quedó; obligatoria en NC y punch)">
                            <Input type="file" accept="image/*" onChange={(e) => setClosing({ ...closing, file: e.target.files?.[0] ?? null })} />
                          </Field>
                          <Button variant="primary" onClick={() => void closeWithPhoto(f, closing.note, closing.file).then((ok) => ok && setClosing(null))}>
                            Cerrar
                          </Button>
                          <Button variant="ghost" onClick={() => setClosing(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="mt-2 text-zinc-500">Nada con estos filtros.</p> : null}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Registrar no conformidad o punch</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Categoría">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
              <option value="no_conformidad">No conformidad</option>
              <option value="punch">Punch (pendiente de terminación)</option>
              <option value="observacion">Observación</option>
            </Select>
          </Field>
          <Field label="Actividad">
            <Select value={form.activity_id} onChange={(e) => setForm({ ...form, activity_id: e.target.value })}>
              <option value="">—</option>
              {p.acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Elemento del plano" hint="(código, opcional)">
            <Input value={form.element} onChange={(e) => setForm({ ...form, element: e.target.value })} placeholder="TRK-001" />
          </Field>
          <Field label="Empresa responsable">
            <Select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
              <option value="">La de la actividad</option>
              {p.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Descripción" className="sm:col-span-2 lg:col-span-4">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qué no cumple o qué falta terminar, y dónde" />
          </Field>
          <Field label="Severidad">
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha límite">
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </Field>
          <label className="flex items-end gap-2 pb-2 font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={form.impeditive} onChange={(e) => setForm({ ...form, impeditive: e.target.checked })} />
            Impeditivo (no deja avanzar o entregar)
          </label>
          <div className="flex items-end">
            <Button variant="primary" onClick={() => void create()}>
              Registrar
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function InspectionsTab(p: {
  checklists: Checklist[];
  inspections: Inspection[];
  acts: Activity[];
  actLabel: (id: string | null) => string;
  elementCodes: Record<string, string>;
  findings: Finding[];
  projectId: string;
  today: string;
  elementId: (code: string) => Promise<string | null | false>;
  act: ActFn;
  setMsg: SetMsg;
}) {
  const active = p.checklists.filter((c) => c.active);
  const [listId, setListId] = useState("");
  const list = active.find((c) => c.id === listId);
  const [activity, setActivity] = useState("");
  const [element, setElement] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(p.today);
  const [answers, setAnswers] = useState<Record<string, { result: string; note: string; impeditive: boolean }>>({});

  async function submit() {
    if (!list) return;
    const el = await p.elementId(element);
    if (el === false) return p.setMsg({ tone: "error", text: `No hay un elemento con el código ${element.trim().toUpperCase()} en el plano.` });
    const payload = {
      project_id: p.projectId,
      checklist_id: list.id,
      activity_id: activity || list.activity_id || null,
      element_id: el,
      location_note: location,
      inspected_on: date,
      answers: list.items.map((it) => ({ id: it.id, ...(answers[it.id] ?? { result: "", note: "", impeditive: false }) })),
    };
    let nc = 0;
    const ok = await p.act(async () => {
      const r = await supabase.rpc("submit_inspection", { p: payload });
      nc = (r.data as { non_conformities?: number } | null)?.non_conformities ?? 0;
      return r;
    }, "Inspección registrada.");
    if (ok) {
      p.setMsg({ tone: "ok", text: nc ? `Inspección rechazada: se abrieron ${nc} no conformidad(es).` : "Inspección aprobada." });
      setAnswers({});
      setElement("");
      setLocation("");
    }
  }

  return (
    <>
      <Card>
        <h2 className="mb-2 text-lg font-bold">Nueva inspección</h2>
        {active.length === 0 ? (
          <p className="text-zinc-500">Primero crea una lista de chequeo en la pestaña Listas de chequeo.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Lista de chequeo">
                <Select
                  value={listId}
                  onChange={(e) => {
                    setListId(e.target.value);
                    setAnswers({});
                  }}
                >
                  <option value="">Elegir…</option>
                  {active.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Actividad">
                <Select value={activity || list?.activity_id || ""} onChange={(e) => setActivity(e.target.value)}>
                  <option value="">—</option>
                  {p.acts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Elemento del plano" hint="(código)">
                <Input value={element} onChange={(e) => setElement(e.target.value)} placeholder="TRK-001" />
              </Field>
              <Field label="Ubicación">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Fila 12, subcampo 3" />
              </Field>
              <Field label="Fecha">
                <Input type="date" value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {list ? (
              <ol className="mt-4 space-y-3">
                {list.items.map((it, i) => {
                  const a = answers[it.id] ?? { result: "", note: "", impeditive: false };
                  const set = (patch: Partial<typeof a>) => setAnswers({ ...answers, [it.id]: { ...a, ...patch } });
                  return (
                    <li key={it.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <div className="mb-2 font-semibold">
                        {i + 1}. {it.text}
                      </div>
                      <div role="radiogroup" aria-label={it.text} className="flex flex-wrap gap-2">
                        {[
                          ["ok", "Cumple"],
                          ["no_ok", "No cumple"],
                          ["na", "No aplica"],
                        ].map(([v, label]) => (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={a.result === v}
                            onClick={() => set({ result: v })}
                            className={cx(
                              "rounded-full border-2 px-4 py-1.5 font-semibold",
                              a.result === v
                                ? v === "no_ok"
                                  ? "border-red-700 bg-red-700 text-white"
                                  : "border-blue-700 bg-blue-700 text-white"
                                : "border-zinc-300 dark:border-zinc-700",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {a.result === "no_ok" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <Input value={a.note} onChange={(e) => set({ note: e.target.value })} placeholder="Qué no cumple" aria-label={`Qué no cumple en ${it.text}`} className="min-w-72 flex-1" />
                          <label className="flex items-center gap-2 text-sm font-semibold">
                            <input type="checkbox" className="h-5 w-5 accent-red-700" checked={a.impeditive} onChange={(e) => set({ impeditive: e.target.checked })} />
                            Impeditivo
                          </label>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {list ? (
              <Button variant="primary" className="mt-3" onClick={() => void submit()}>
                Registrar inspección
              </Button>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Inspecciones realizadas</h2>
        {p.inspections.length === 0 ? (
          <p className="text-zinc-500">Todavía no hay inspecciones.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="pr-3">Lista</th>
                  <th className="pr-3">Actividad / elemento</th>
                  <th className="pr-3">Resultado</th>
                  <th className="text-right">No conformidades</th>
                </tr>
              </thead>
              <tbody>
                {p.inspections.map((i) => (
                  <tr key={i.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-3 tabular-nums">{i.inspected_on}</td>
                    <td className="pr-3">{p.checklists.find((c) => c.id === i.checklist_id)?.name ?? "—"}</td>
                    <td className="pr-3">
                      {p.actLabel(i.activity_id)}
                      {i.element_id ? ` · ${p.elementCodes[i.element_id] ?? "elemento"}` : ""}
                      {i.location_note ? <div className="text-sm text-zinc-500">{i.location_note}</div> : null}
                    </td>
                    <td className="pr-3">
                      <Badge tone={i.result === "aprobada" ? "green" : "red"}>{i.result === "aprobada" ? "Aprobada" : "Rechazada"}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{p.findings.filter((f) => f.inspection_id === i.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function PlanTab(p: { points: Point[]; acts: Activity[]; checklists: Checklist[]; canManage: boolean; actLabel: (id: string | null) => string; act: ActFn; projectId: string }) {
  const empty = { activity_id: "", name: "", criterion: "", frequency: "", point_type: "testigo", responsible: "", checklist_id: "" };
  const [form, setForm] = useState(empty);
  const byActivity = p.acts.filter((a) => p.points.some((x) => x.activity_id === a.id));

  async function add() {
    const ok = await p.act(
      () =>
        supabase.from("inspection_points").insert({
          project_id: p.projectId,
          activity_id: form.activity_id,
          name: form.name.trim(),
          criterion: form.criterion.trim() || null,
          frequency: form.frequency.trim() || null,
          point_type: form.point_type,
          responsible: form.responsible.trim() || null,
          checklist_id: form.checklist_id || null,
          sort: p.points.length,
        }),
      "Punto agregado al plan de inspección.",
    );
    if (ok) setForm({ ...empty, activity_id: form.activity_id });
  }

  return (
    <>
      <Card>
        <h2 className="text-lg font-bold">Plan de inspección y ensayo</h2>
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Qué se inspecciona en cada actividad, con qué criterio y frecuencia. Espera: no se sigue sin liberar; testigo: se avisa para presenciar; revisión: documental.
        </p>
        {byActivity.length === 0 ? (
          <p className="text-zinc-500">Todavía no hay puntos de inspección.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3">Punto</th>
                  <th className="pr-3">Tipo</th>
                  <th className="pr-3">Criterio de aceptación</th>
                  <th className="pr-3">Frecuencia</th>
                  <th className="pr-3">Responsable</th>
                  <th className="pr-3">Lista</th>
                  <th />
                </tr>
              </thead>
              {byActivity.map((a) => (
                <tbody key={a.id}>
                  <tr>
                    <td colSpan={7} className="pt-3 pb-1 text-sm font-bold text-zinc-500">
                      {a.code} · {a.name}
                    </td>
                  </tr>
                  {p.points
                    .filter((x) => x.activity_id === a.id)
                    .map((x) => (
                      <tr key={x.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-2 pr-3 font-semibold">{x.name}</td>
                        <td className="pr-3">
                          <Badge tone={x.point_type === "espera" ? "red" : x.point_type === "testigo" ? "amber" : "neutral"}>{POINT_LABEL[x.point_type]}</Badge>
                        </td>
                        <td className="pr-3">{x.criterion ?? "—"}</td>
                        <td className="pr-3">{x.frequency ?? "—"}</td>
                        <td className="pr-3">{x.responsible ?? "—"}</td>
                        <td className="pr-3">{p.checklists.find((c) => c.id === x.checklist_id)?.name ?? "—"}</td>
                        <td className="text-right">
                          {p.canManage ? (
                            <Button size="sm" variant="ghost" onClick={() => void p.act(() => supabase.from("inspection_points").delete().eq("id", x.id), "Punto quitado.")}>
                              Quitar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>
      {p.canManage ? (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Agregar punto de inspección</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Actividad">
              <Select value={form.activity_id} onChange={(e) => setForm({ ...form, activity_id: e.target.value })}>
                <option value="">Elegir…</option>
                {p.acts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Punto">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Liberación de hincado" />
            </Field>
            <Field label="Tipo">
              <Select value={form.point_type} onChange={(e) => setForm({ ...form, point_type: e.target.value })}>
                <option value="espera">Espera</option>
                <option value="testigo">Testigo</option>
                <option value="revision">Revisión</option>
              </Select>
            </Field>
            <Field label="Lista de chequeo">
              <Select value={form.checklist_id} onChange={(e) => setForm({ ...form, checklist_id: e.target.value })}>
                <option value="">—</option>
                {p.checklists.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Criterio de aceptación" className="sm:col-span-2">
              <Input value={form.criterion} onChange={(e) => setForm({ ...form, criterion: e.target.value })} placeholder="Verticalidad ≤ 1 %, cota ± 2 cm" />
            </Field>
            <Field label="Frecuencia">
              <Input value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} placeholder="1 de cada 20 pilotes" />
            </Field>
            <Field label="Responsable">
              <Input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} placeholder="Residente de calidad" />
            </Field>
          </div>
          <Button variant="primary" className="mt-3" disabled={!form.activity_id || form.name.trim().length < 3} onClick={() => void add()}>
            Agregar al plan
          </Button>
        </Card>
      ) : null}
    </>
  );
}

function ChecklistsTab(p: { checklists: Checklist[]; acts: Activity[]; canManage: boolean; actLabel: (id: string | null) => string; act: ActFn; projectId: string }) {
  const [form, setForm] = useState({ name: "", activity_id: "", items: "" });
  const lines = form.items.split("\n").map((x) => x.trim()).filter(Boolean);

  async function add() {
    const ok = await p.act(
      () =>
        supabase.from("checklists").insert({
          project_id: p.projectId,
          name: form.name.trim(),
          activity_id: form.activity_id || null,
          items: lines.map((text, i) => ({ id: String(i + 1), text })),
        }),
      "Lista de chequeo creada.",
    );
    if (ok) setForm({ name: "", activity_id: "", items: "" });
  }

  return (
    <>
      <Card>
        <h2 className="mb-2 text-lg font-bold">Listas de chequeo</h2>
        {p.checklists.length === 0 ? (
          <p className="text-zinc-500">Todavía no hay listas de chequeo.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {p.checklists.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start gap-3 py-2">
                <div className="min-w-64 flex-1">
                  <div className="font-semibold">
                    {c.name} {c.active ? null : <Badge tone="neutral">Inactiva</Badge>}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {p.actLabel(c.activity_id)} · {c.items.length} punto(s): {c.items.map((x) => x.text).join(" · ")}
                  </div>
                </div>
                {p.canManage ? (
                  <Button size="sm" variant="ghost" onClick={() => void p.act(() => supabase.from("checklists").update({ active: !c.active }).eq("id", c.id), c.active ? "Lista desactivada." : "Lista activada.")}>
                    {c.active ? "Desactivar" : "Activar"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {p.canManage ? (
        <Card>
          <h2 className="mb-2 text-lg font-bold">Nueva lista de chequeo</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hincado de pilotes" />
            </Field>
            <Field label="Actividad" hint="(opcional)">
              <Select value={form.activity_id} onChange={(e) => setForm({ ...form, activity_id: e.target.value })}>
                <option value="">—</option>
                {p.acts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Puntos a revisar" hint="(uno por línea)" className="sm:col-span-2">
              <Textarea rows={5} value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} placeholder={"Verticalidad dentro de 1 %\nCota de cabeza según plano\nSin daño en el galvanizado"} />
            </Field>
          </div>
          <Button variant="primary" className="mt-3" disabled={form.name.trim().length < 3 || !lines.length} onClick={() => void add()}>
            Crear lista ({lines.length} puntos)
          </Button>
        </Card>
      ) : null}
    </>
  );
}
