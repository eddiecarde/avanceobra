"use client";

import {
  COMPANY_DOCS,
  companyCompliance,
  docLabel,
  docState,
  WORKER_DOCS,
  workerCompliance,
  type ComplianceResult,
  type ComplianceStatus,
} from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { localToday } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface Company {
  id: string;
  name: string;
  kind: "contratista" | "subcontratista";
}
interface Worker {
  id: string;
  company_id: string | null;
  full_name: string;
  document_id: string | null;
  role: string | null;
  works_at_height: boolean;
  active: boolean;
}
interface Doc {
  id: string;
  company_id: string | null;
  worker_id: string | null;
  doc_type: string;
  issued_on: string | null;
  expires_on: string | null;
  file_path: string | null;
  notes: string | null;
}

const STATUS: Record<ComplianceStatus, { label: string; tone: "green" | "amber" | "red" }> = {
  ok: { label: "Habilitado", tone: "green" },
  soon: { label: "Por vencer", tone: "amber" },
  blocked: { label: "No habilitado", tone: "red" },
};
const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "sin vencimiento");
/** Último día del mes de una fecha (la planilla del mes vence al final del mes). */
const endOfMonth = (d: string) => {
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1, 0);
  return x.toISOString().slice(0, 10);
};
const explain = (r: ComplianceResult) =>
  [
    r.missing.length ? `Falta: ${r.missing.map(docLabel).join(", ")}` : "",
    r.expired.length ? `Vencido: ${r.expired.map(docLabel).join(", ")}` : "",
    r.soon.length ? `Vence pronto: ${r.soon.map((s) => `${docLabel(s.docType)} (${fmt(s.expiresOn)})`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

/** Seguridad social y SST al día por empresa y por trabajador, con soportes, vencimientos y bloqueo opcional. */
export default function Sst() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const me = memberships.find((m) => m.project_id === projectId);
  const sub = me?.sub_company_id ?? null;
  const canManage = !!sub || me?.role === "resident" || me?.role === "director" || me?.role === "admin";
  const canBlock = !sub && (me?.role === "director" || me?.role === "admin");
  const today = localToday();
  const [data, setData] = useState<{ projectId: string; companies: Company[]; workers: Worker[]; docs: Doc[]; block: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      supabase.from("project_companies").select("id, name, kind").eq("project_id", projectId).order("kind").order("name"),
      supabase.from("workers").select("*").eq("project_id", projectId).order("full_name"),
      supabase.from("compliance_documents").select("*").eq("project_id", projectId).order("expires_on", { ascending: false }),
      supabase.from("projects").select("compliance_block").eq("id", projectId).single(),
    ]).then(([c, w, d, p]) => {
      if (off) return;
      const err = c.error ?? w.error ?? d.error;
      if (err) return setMsg({ tone: "error", text: err.message });
      setData({
        projectId,
        companies: (c.data ?? []) as Company[],
        workers: (w.data ?? []) as Worker[],
        docs: (d.data ?? []) as Doc[],
        block: !!p.data?.compliance_block,
      });
    });
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const current = data?.projectId === projectId ? data : null;
  // El contratista ve su personal directo y todas las empresas; el subcontratista, solo la suya
  const groups = useMemo(() => {
    if (!current) return [];
    const list: { id: string | null; name: string; kind: string }[] = sub
      ? current.companies.filter((c) => c.id === sub).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))
      : [
          ...current.companies.filter((c) => c.kind === "contratista").map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
          { id: null, name: "Personal directo del contratista", kind: "contratista" },
          ...current.companies.filter((c) => c.kind === "subcontratista").map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
        ];
    return list.map((g) => {
      const workers = current.workers.filter((w) => w.company_id === g.id && w.active);
      const companyDocs = current.docs.filter((d) => d.company_id === g.id && !d.worker_id);
      return {
        ...g,
        company: companyCompliance(companyDocs.map((d) => ({ docType: d.doc_type, expiresOn: d.expires_on })), today),
        companyDocs,
        workers: workers.map((w) => ({
          ...w,
          result: workerCompliance(
            { worksAtHeight: w.works_at_height },
            current.docs.filter((d) => d.worker_id === w.id).map((d) => ({ docType: d.doc_type, expiresOn: d.expires_on })),
            today,
          ),
          docs: current.docs.filter((d) => d.worker_id === w.id),
        })),
      };
    });
  }, [current, sub, today]);

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  const all = groups.flatMap((g) => g.workers);
  const count = (s: ComplianceStatus) => all.filter((w) => w.result.status === s).length;
  const reload = () => setVersion((v) => v + 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Seguridad social y SST</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Planilla del mes de cada empresa y documentos de cada trabajador (ARL, EPS, examen médico, inducción, alturas), con sus vencimientos.
          </p>
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
      {msg ? (
        <p role="status" className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>
          {msg.text}
        </p>
      ) : null}

      {!current ? (
        <p className="text-zinc-500">Cargando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Trabajadores habilitados", value: count("ok"), tone: "" },
              { label: "Por vencer (15 días)", value: count("soon"), tone: count("soon") ? "text-amber-600" : "" },
              { label: "No habilitados", value: count("blocked"), tone: count("blocked") ? "text-red-700 dark:text-red-400" : "" },
              { label: "Empresas sin planilla vigente", value: groups.filter((g) => g.company.status === "blocked").length, tone: "" },
            ].map((k) => (
              <Card key={k.label}>
                <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{k.label}</p>
                <p className={cx("mt-1 text-3xl font-extrabold tabular-nums", k.tone)}>{k.value}</p>
              </Card>
            ))}
          </div>

          {canBlock ? (
            <Card>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-blue-700"
                  checked={current.block}
                  onChange={async (e) => {
                    const on = e.target.checked;
                    const { error } = await supabase.from("projects").update({ compliance_block: on }).eq("id", projectId);
                    if (error) return setMsg({ tone: "error", text: error.message });
                    setMsg({ tone: "ok", text: on ? "Bloqueo activado." : "Bloqueo desactivado." });
                    reload();
                  }}
                />
                <span>
                  <b>Bloquear el avance de una empresa sin planilla vigente</b>
                  <span className="block text-sm text-zinc-600 dark:text-zinc-400">
                    Mientras la PILA de una empresa esté vencida, nadie puede registrar avance en sus actividades (en el teléfono sale el motivo). Se levanta solo
                    al cargar la planilla.
                  </span>
                </span>
              </label>
            </Card>
          ) : null}

          {groups.map((g) => (
            <CompanyCard key={g.id ?? "directo"} projectId={projectId} group={g} canManage={canManage} today={today} onChanged={reload} onMessage={setMsg} />
          ))}
        </>
      )}
    </div>
  );
}

type Group = {
  id: string | null;
  name: string;
  kind: string;
  company: ComplianceResult;
  companyDocs: Doc[];
  workers: (Worker & { result: ComplianceResult; docs: Doc[] })[];
};

function CompanyCard({
  projectId,
  group,
  canManage,
  today,
  onChanged,
  onMessage,
}: {
  projectId: string;
  group: Group;
  canManage: boolean;
  today: string;
  onChanged: () => void;
  onMessage: (m: { tone: "ok" | "error"; text: string }) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [worker, setWorker] = useState({ full_name: "", document_id: "", role: "", works_at_height: false });

  async function addWorker() {
    const { error } = await supabase.from("workers").insert({
      project_id: projectId,
      company_id: group.id,
      full_name: worker.full_name.trim(),
      document_id: worker.document_id.trim() || null,
      role: worker.role.trim() || null,
      works_at_height: worker.works_at_height,
    });
    if (error) return onMessage({ tone: "error", text: error.message.includes("duplicate") ? "Ya hay un trabajador con esa cédula en la obra." : error.message });
    onMessage({ tone: "ok", text: `${worker.full_name.trim()} agregado. Carga sus documentos para habilitarlo.` });
    setWorker({ full_name: "", document_id: "", role: "", works_at_height: false });
    onChanged();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-bold">{group.name}</h2>
        {group.id !== null || group.companyDocs.length ? (
          <span title={explain(group.company)}>
            <Badge tone={STATUS[group.company.status].tone}>Planilla: {group.company.status === "blocked" ? "no vigente" : group.company.status === "soon" ? "por vencer" : "vigente"}</Badge>
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-sm font-bold text-zinc-500 uppercase">Documentos de la empresa</h3>
      <DocList docs={group.companyDocs} today={today} />
      {canManage ? (
        <DocForm projectId={projectId} companyId={group.id} workerId={null} types={COMPANY_DOCS} onSaved={onChanged} onMessage={onMessage} label={`documento de ${group.name}`} />
      ) : null}

      <h3 className="mt-4 text-sm font-bold text-zinc-500 uppercase">Trabajadores ({group.workers.length})</h3>
      {group.workers.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1">Nombre</th>
                <th>Cédula</th>
                <th>Cargo</th>
                <th>Estado</th>
                <th>Qué le falta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {group.workers.map((w) => (
                <tr key={w.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1.5 font-semibold">
                    {w.full_name}
                    {w.works_at_height ? <span className="block text-xs font-normal text-zinc-500">Trabaja en alturas</span> : null}
                  </td>
                  <td className="tabular-nums">{w.document_id ?? "—"}</td>
                  <td>{w.role ?? "—"}</td>
                  <td>
                    <Badge tone={STATUS[w.result.status].tone}>{STATUS[w.result.status].label}</Badge>
                  </td>
                  <td className="text-xs text-zinc-600 dark:text-zinc-400">{explain(w.result) || "—"}</td>
                  <td className="text-right">
                    <Button size="sm" onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id} aria-label={`Documentos de ${w.full_name}`}>
                      {open === w.id ? "Cerrar" : "Documentos"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Sin trabajadores registrados.</p>
      )}
      {open
        ? (() => {
            const w = group.workers.find((x) => x.id === open)!;
            return (
              <div className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <h4 className="font-bold">Documentos de {w.full_name}</h4>
                <DocList docs={w.docs} today={today} />
                {canManage ? (
                  <DocForm projectId={projectId} companyId={group.id} workerId={w.id} types={WORKER_DOCS} onSaved={onChanged} onMessage={onMessage} label={`documento de ${w.full_name}`} />
                ) : null}
              </div>
            );
          })()
        : null}

      {canManage ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Nombre del trabajador" className="min-w-48 flex-1">
            <Input value={worker.full_name} onChange={(e) => setWorker({ ...worker, full_name: e.target.value })} />
          </Field>
          <Field label="Cédula">
            <Input value={worker.document_id} onChange={(e) => setWorker({ ...worker, document_id: e.target.value })} />
          </Field>
          <Field label="Cargo">
            <Input value={worker.role} onChange={(e) => setWorker({ ...worker, role: e.target.value })} />
          </Field>
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={worker.works_at_height} onChange={(e) => setWorker({ ...worker, works_at_height: e.target.checked })} className="h-4 w-4 accent-blue-700" />
            Trabaja en alturas
          </label>
          <Button disabled={worker.full_name.trim().length < 3} onClick={() => void addWorker()}>
            Agregar trabajador
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function DocList({ docs, today }: { docs: Doc[]; today: string }) {
  if (!docs.length) return <p className="text-sm text-zinc-500">Sin documentos.</p>;
  async function openFile(path: string) {
    const { data, error } = await supabase.storage.from("compliance").createSignedUrl(path, 300);
    if (!error && data) window.open(data.signedUrl, "_blank", "noopener");
  }
  return (
    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {docs.map((d) => {
        const st = docState(d.expires_on, today);
        return (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="mr-auto">
              <b>{docLabel(d.doc_type)}</b>
              {d.notes ? <span className="text-zinc-500"> · {d.notes}</span> : null}
            </span>
            <span className={cx("tabular-nums", st === "expired" ? "font-semibold text-red-700 dark:text-red-400" : st === "soon" ? "font-semibold text-amber-600" : "text-zinc-600")}>
              {st === "expired" ? "Venció " : d.expires_on ? "Vence " : ""}
              {fmt(d.expires_on)}
            </span>
            {d.file_path ? (
              <Button size="sm" variant="ghost" onClick={() => void openFile(d.file_path!)}>
                Ver soporte
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function DocForm({
  projectId,
  companyId,
  workerId,
  types,
  label,
  onSaved,
  onMessage,
}: {
  projectId: string;
  companyId: string | null;
  workerId: string | null;
  types: Record<string, string>;
  label: string;
  onSaved: () => void;
  onMessage: (m: { tone: "ok" | "error"; text: string }) => void;
}) {
  const first = Object.keys(types)[0]!;
  const [f, setF] = useState({ doc_type: first, expires_on: first === "pila" ? endOfMonth(localToday()) : "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    let file_path: string | null = null;
    if (file) {
      const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-60);
      file_path = `${projectId}/${companyId ?? "contratista"}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("compliance").upload(file_path, file, { contentType: file.type || undefined });
      if (error) {
        setBusy(false);
        return onMessage({ tone: "error", text: `No se pudo subir el soporte: ${error.message}` });
      }
    }
    const { error } = await supabase.from("compliance_documents").insert({
      project_id: projectId,
      company_id: companyId,
      worker_id: workerId,
      doc_type: f.doc_type,
      expires_on: f.expires_on || null,
      notes: f.notes.trim() || null,
      file_path,
    });
    setBusy(false);
    if (error) return onMessage({ tone: "error", text: error.message });
    onMessage({ tone: "ok", text: `${docLabel(f.doc_type)} guardado.` });
    setF({ ...f, notes: "" });
    setFile(null);
    onSaved();
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Field label="Documento">
        <Select
          aria-label={`Tipo de ${label}`}
          value={f.doc_type}
          onChange={(e) => setF({ ...f, doc_type: e.target.value, expires_on: e.target.value === "pila" ? endOfMonth(localToday()) : f.expires_on })}
        >
          {Object.entries(types).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Vence" hint="(vacío = no vence)">
        <Input aria-label={`Vencimiento de ${label}`} type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} />
      </Field>
      <Field label="Nota">
        <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="p. ej. Mes de octubre" />
      </Field>
      <Field label="Soporte" hint="(PDF o foto)">
        <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
      </Field>
      <Button variant="primary" disabled={busy} onClick={() => void save()} aria-label={`Guardar ${label}`}>
        {busy ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
