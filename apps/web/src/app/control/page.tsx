"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { localToday } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const TEST_STATUS: Record<string, { label: string; tone: "neutral" | "blue" | "green" | "red" | "amber" }> = {
  pendiente: { label: "Pendiente", tone: "amber" },
  enviado: { label: "Enviado al laboratorio", tone: "blue" },
  aprobado: { label: "Aprobado", tone: "green" },
  rechazado: { label: "Rechazado", tone: "red" },
  no_aplica: { label: "No aplica", tone: "neutral" },
};

interface LabTest {
  id: string;
  activity_id: string | null;
  name: string;
  standard: string | null;
  sample_date: string | null;
  sent_date: string | null;
  lab: string | null;
  status: string;
  result: string | null;
  observation: string | null;
}

interface Constraint {
  id: string;
  activity_id: string | null;
  description: string;
  responsible: string | null;
  need_by: string | null;
  status: "abierta" | "liberada";
  released_at: string | null;
  created_at: string;
}

const emptyTest = { name: "", standard: "", activity_id: "", sample_date: "", sent_date: "", lab: "", status: "pendiente" };
const emptyConstraint = { description: "", activity_id: "", responsible: "", need_by: "" };

/** Ensayos y pruebas de laboratorio, y restricciones que impiden avanzar (secciones del informe semanal). */
export default function Control() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const canEdit = memberships.some((m) => m.project_id === projectId && ["resident", "director", "admin"].includes(m.role));
  const [rows, setRows] = useState<{ projectId: string; tests: LabTest[]; constraints: Constraint[]; activities: { id: string; code: string; name: string }[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [newTest, setNewTest] = useState(emptyTest);
  const [newC, setNewC] = useState(emptyConstraint);
  const [msg, setMsg] = useState<string | null>(null);
  const today = localToday();

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      supabase.from("lab_tests").select("*").eq("project_id", projectId).order("sample_date", { ascending: false, nullsFirst: true }),
      supabase.from("project_constraints").select("*").eq("project_id", projectId).order("status").order("need_by", { nullsFirst: false }),
      supabase.from("activities").select("id, code, name").eq("project_id", projectId).order("code"),
    ]).then(([t, c, a]) => {
      if (off) return;
      setMsg(t.error?.message ?? c.error?.message ?? null);
      setRows({ projectId, tests: (t.data ?? []) as LabTest[], constraints: (c.data ?? []) as Constraint[], activities: a.data ?? [] });
    });
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const data = rows?.projectId === projectId ? rows : null;
  const act = (id: string | null) => data?.activities.find((a) => a.id === id);
  const reload = () => setVersion((v) => v + 1);
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) setMsg(error.message);
    else {
      setMsg(null);
      reload();
    }
    return !error;
  };
  const opt = (s: string) => (s.trim() ? s.trim() : null);

  if (!projects.length) return <p className="text-zinc-500">No tienes proyectos asignados.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Ensayos y restricciones</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Se incluyen en el informe semanal. {canEdit ? "" : "Solo lectura: los registra el residente, el director o el administrador."}</p>
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
      {msg ? <p className="rounded-lg bg-red-50 px-4 py-2 font-semibold text-red-900 dark:bg-red-950 dark:text-red-200">{msg}</p> : null}

      <Card>
        <h2 className="mb-3 text-lg font-bold">Ensayos y pruebas</h2>
        {canEdit ? (
          <form
            className="mb-4 grid gap-2 md:grid-cols-4 xl:grid-cols-8"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                supabase.from("lab_tests").insert({
                  project_id: projectId,
                  name: newTest.name.trim(),
                  standard: opt(newTest.standard),
                  activity_id: newTest.activity_id || null,
                  sample_date: newTest.sample_date || null,
                  sent_date: newTest.sent_date || null,
                  lab: opt(newTest.lab),
                  status: newTest.status,
                }),
              ).then((ok) => ok && setNewTest(emptyTest));
            }}
          >
            <Field label="Ensayo / prueba" className="md:col-span-2">
              <Input value={newTest.name} onChange={(e) => setNewTest({ ...newTest, name: e.target.value })} placeholder="p. ej. Densidad en campo" required />
            </Field>
            <Field label="Norma">
              <Input value={newTest.standard} onChange={(e) => setNewTest({ ...newTest, standard: e.target.value })} placeholder="INV E-161" />
            </Field>
            <Field label="Actividad">
              <Select value={newTest.activity_id} onChange={(e) => setNewTest({ ...newTest, activity_id: e.target.value })}>
                <option value="">—</option>
                {data?.activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Toma de muestra">
              <Input type="date" value={newTest.sample_date} max={today} onChange={(e) => setNewTest({ ...newTest, sample_date: e.target.value })} />
            </Field>
            <Field label="Envío">
              <Input type="date" value={newTest.sent_date} max={today} onChange={(e) => setNewTest({ ...newTest, sent_date: e.target.value })} />
            </Field>
            <Field label="Laboratorio">
              <Input value={newTest.lab} onChange={(e) => setNewTest({ ...newTest, lab: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" type="submit" disabled={!newTest.name.trim()} className="w-full">
                Agregar
              </Button>
            </div>
          </form>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-2">Ensayo</th>
                <th className="pr-2">Norma</th>
                <th className="pr-2">Actividad</th>
                <th className="pr-2">Toma / envío</th>
                <th className="pr-2">Estado</th>
                <th className="pr-2">Resultado</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>
              {data?.tests.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-2 pr-2 font-semibold">
                    {t.name}
                    {t.lab ? <div className="font-normal text-zinc-500">{t.lab}</div> : null}
                  </td>
                  <td className="py-2 pr-2">{t.standard ?? "—"}</td>
                  <td className="py-2 pr-2">{act(t.activity_id)?.code ?? "—"}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {t.sample_date ?? "—"} / {t.sent_date ?? "—"}
                  </td>
                  <td className="py-2 pr-2">
                    {canEdit ? (
                      <Select
                        value={t.status}
                        aria-label={`Estado de ${t.name}`}
                        className="py-1"
                        onChange={(e) =>
                          void run(
                            supabase
                              .from("lab_tests")
                              .update({ status: e.target.value, sent_date: e.target.value === "enviado" && !t.sent_date ? today : t.sent_date })
                              .eq("id", t.id),
                          )
                        }
                      >
                        {Object.entries(TEST_STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={TEST_STATUS[t.status]?.tone}>{TEST_STATUS[t.status]?.label ?? t.status}</Badge>
                    )}
                  </td>
                  {(["result", "observation"] as const).map((k) => (
                    <td key={k} className="py-2 pr-2">
                      {canEdit ? (
                        <Input
                          defaultValue={t[k] ?? ""}
                          className="py-1"
                          aria-label={`${k === "result" ? "Resultado" : "Observación"} de ${t.name}`}
                          onBlur={(e) => e.target.value !== (t[k] ?? "") && void run(supabase.from("lab_tests").update({ [k]: opt(e.target.value) }).eq("id", t.id))}
                        />
                      ) : (
                        (t[k] ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.tests.length ? <p className="py-4 text-zinc-500">Sin ensayos registrados.</p> : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Restricciones</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Lo que impide avanzar (permisos, diseños, materiales, accesos), quién debe liberarlo y para cuándo.</p>
        {canEdit ? (
          <form
            className="mb-4 grid gap-2 md:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                supabase.from("project_constraints").insert({
                  project_id: projectId,
                  description: newC.description.trim(),
                  activity_id: newC.activity_id || null,
                  responsible: opt(newC.responsible),
                  need_by: newC.need_by || null,
                }),
              ).then((ok) => ok && setNewC(emptyConstraint));
            }}
          >
            <Field label="Restricción" className="md:col-span-2">
              <Input value={newC.description} onChange={(e) => setNewC({ ...newC, description: e.target.value })} placeholder="p. ej. Falta permiso de servidumbre" required />
            </Field>
            <Field label="Actividad">
              <Select value={newC.activity_id} onChange={(e) => setNewC({ ...newC, activity_id: e.target.value })}>
                <option value="">—</option>
                {data?.activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsable">
              <Input value={newC.responsible} onChange={(e) => setNewC({ ...newC, responsible: e.target.value })} placeholder="p. ej. Cliente" />
            </Field>
            <Field label="Necesaria para">
              <Input type="date" value={newC.need_by} onChange={(e) => setNewC({ ...newC, need_by: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" type="submit" disabled={!newC.description.trim()} className="w-full">
                Agregar
              </Button>
            </div>
          </form>
        ) : null}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data?.constraints.map((c) => {
            const late = c.status === "abierta" && c.need_by != null && c.need_by < today;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                <Badge tone={c.status === "liberada" ? "green" : late ? "red" : "amber"}>{c.status === "liberada" ? "Liberada" : late ? "Vencida" : "Abierta"}</Badge>
                <div className="min-w-0 flex-1">
                  <div className={cx("font-medium", c.status === "liberada" && "text-zinc-500 line-through")}>{c.description}</div>
                  <div className="text-sm text-zinc-500">
                    {[act(c.activity_id)?.code, c.responsible ? `responsable: ${c.responsible}` : null, c.need_by ? `para el ${c.need_by}` : null, c.released_at ? `liberada el ${c.released_at}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {canEdit ? (
                  <Button size="sm" onClick={() => void run(supabase.from("project_constraints").update({ status: c.status === "abierta" ? "liberada" : "abierta" }).eq("id", c.id))}>
                    {c.status === "abierta" ? "Liberar" : "Reabrir"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {data && !data.constraints.length ? <p className="py-4 text-zinc-500">Sin restricciones registradas.</p> : null}
      </Card>
    </div>
  );
}
