"use client";

import { useEffect, useState } from "react";
import { DashboardView } from "@/components/dash/DashboardView";
import { Badge, Button, Card, cx, Field, Select, Textarea } from "@/components/ui";
import { cop, qty, totalsRows } from "@/lib/actas";
import { CLIENT_STATUS, decideCertificate, loadClientProjects, loadClientView, type ClientCertificate, type ClientProject, type ClientView } from "@/lib/cliente";
import { useSession } from "@/lib/session";

type Tab = "actas" | "avance" | "entregas";
const TABS: { key: Tab; label: string }[] = [
  { key: "actas", label: "Actas de cobro" },
  { key: "avance", label: "Avance de obra" },
  { key: "entregas", label: "Entregas del punch list" },
];

/** Portal del cliente: ve el avance, aprueba u observa las actas de cobro y consulta las entregas del punch list. */
export default function Cliente() {
  const { signOut, session } = useSession();
  const [projects, setProjects] = useState<ClientProject[] | null>(null);
  const [picked, setPicked] = useState("");
  const [view, setView] = useState<{ projectId: string; data?: ClientView; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("actas");
  const [openId, setOpenId] = useState<string | null>(null);
  const projectId = picked || projects?.[0]?.id || "";

  useEffect(() => {
    loadClientProjects().then(setProjects, () => setProjects([]));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    loadClientView(projectId).then(
      (data) => setView({ projectId, data }),
      (e: Error) => setView({ projectId, error: e.message }),
    );
  }, [projectId, version]);

  const data = view?.projectId === projectId ? view.data : undefined;
  const pending = data?.certificates.filter((c) => c.status === "emitida" && c.client_status === "pendiente").length ?? 0;
  const open = data?.certificates.find((c) => c.id === openId) ?? null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-extrabold tracking-tight">
            Avance<span className="text-blue-700">Obra</span>
          </span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Portal del cliente</span>
          <span className="ml-auto text-sm text-zinc-500">{session?.user.email}</span>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            Salir
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6">
        {projects === null ? (
          <p className="text-zinc-500">Cargando…</p>
        ) : !projects.length ? (
          <Card>
            <h1 className="text-xl font-bold">No tienes obras asignadas</h1>
            <p className="text-zinc-600 dark:text-zinc-400">Pide al contratista que te dé acceso como cliente desde la página Equipo.</p>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="mr-auto">
                <h1 className="text-2xl font-extrabold">{projects.find((p) => p.id === projectId)?.name}</h1>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {data?.header.contractor_name ? `Contratista: ${data.header.contractor_name}` : "Contratista"}
                  {data?.header.contract_code ? ` · contrato ${data.header.contract_code}` : ""}
                </p>
              </div>
              {projects.length > 1 ? (
                <Field label="Obra">
                  <Select value={projectId} onChange={(e) => (setPicked(e.target.value), setOpenId(null))}>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>

            <div role="tablist" className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cx(
                    "rounded-lg border px-3 py-1.5 font-semibold",
                    tab === t.key ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {t.label}
                  {t.key === "actas" && pending ? ` (${pending} por revisar)` : ""}
                </button>
              ))}
            </div>

            {view?.error && view.projectId === projectId ? <Card className="text-red-700">No se pudo cargar: {view.error}</Card> : null}
            {!data ? (
              !view?.error ? <p className="text-zinc-500">Cargando…</p> : null
            ) : tab === "avance" ? (
              <DashboardView data={data.dash} error={null} note="Datos al momento de abrir la página · sin costos internos del contratista" />
            ) : tab === "entregas" ? (
              <Handovers data={data} />
            ) : (
              <>
                <Card>
                  {data.certificates.length ? (
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-zinc-500">
                        <tr>
                          <th className="py-1">N°</th>
                          <th>Periodo</th>
                          <th className="text-right">Valor del acta</th>
                          <th className="text-right">Neto a pagar</th>
                          <th>Estado</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.certificates.map((c) => (
                          <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1.5 font-bold">{c.number}</td>
                            <td>
                              {c.period_start} a {c.period_end}
                            </td>
                            <td className="text-right tabular-nums">{cop(c.totals.grossAmount ?? c.totals.periodAmount)}</td>
                            <td className="text-right font-semibold tabular-nums">{cop(c.totals.netAmount)}</td>
                            <td>
                              {c.status === "anulada" ? <Badge>Anulada</Badge> : <Badge tone={CLIENT_STATUS[c.client_status].tone}>{CLIENT_STATUS[c.client_status].label}</Badge>}
                            </td>
                            <td className="text-right">
                              <Button size="sm" onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-expanded={openId === c.id}>
                                {openId === c.id ? "Cerrar" : c.status === "emitida" && c.client_status === "pendiente" ? "Revisar" : "Ver"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-zinc-500">El contratista aún no ha emitido actas de cobro.</p>
                  )}
                </Card>
                {open ? <CertificateReview key={open.id} cert={open} onDecided={() => setVersion((v) => v + 1)} /> : null}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** Detalle del acta (ítems del periodo y totales) y la decisión del cliente. */
function CertificateReview({ cert, onDecided }: { cert: ClientCertificate; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = cert.lines.filter((l) => Math.abs(l.periodQty) > 1e-9);
  const canDecide = cert.status === "emitida" && cert.client_status === "pendiente";

  async function decide(decision: "aprobada" | "observada") {
    if (decision === "observada" && note.trim().length < 5) return setError("Escribe qué hay que corregir en el acta.");
    if (decision === "aprobada" && !window.confirm(`¿Aprobar el acta N° ${cert.number} por ${cop(cert.totals.netAmount)} neto?`)) return;
    setBusy(true);
    setError(null);
    try {
      await decideCertificate(cert.id, decision, note);
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">
        Acta N° {cert.number} · {cert.period_start} a {cert.period_end}
      </h2>
      {cert.notes ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Observaciones del contratista: {cert.notes}</p> : null}
      <div className="mt-3 max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="py-1">Ítem</th>
              <th className="text-right">Cant. periodo</th>
              <th className="text-right">Acumulado</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Valor periodo</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1">
                  {l.code} · {l.name}
                </td>
                <td className="text-right tabular-nums">
                  {qty(l.periodQty)} {l.unit}
                </td>
                <td className="text-right tabular-nums">
                  {qty(l.cumulativeQty)} de {qty(l.contractQty)}
                </td>
                <td className="text-right tabular-nums">{cop(l.unitPrice)}</td>
                <td className="text-right font-semibold tabular-nums">{cop(l.periodAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="mt-3 ml-auto text-sm">
        <tbody>
          {totalsRows(cert.totals).map(([label, v]) => (
            <tr key={label} className={label === "NETO A PAGAR" ? "border-y-2 border-zinc-800 font-extrabold dark:border-zinc-200" : ""}>
              <td className="py-0.5 pr-6">{label}</td>
              <td className="text-right tabular-nums">{cop(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canDecide ? (
        <div className="mt-4 space-y-2">
          <Field label="Observaciones" hint="(obligatorias si el acta tiene algo por corregir)">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void decide("aprobada")}>
              Aprobar acta
            </Button>
            <Button disabled={busy} onClick={() => void decide("observada")}>
              Devolver con observaciones
            </Button>
            {error ? <span className="font-semibold text-red-700 dark:text-red-400">{error}</span> : null}
          </div>
        </div>
      ) : cert.client_decided_at ? (
        <p className="mt-3 text-sm">
          <b>{CLIENT_STATUS[cert.client_status].label}</b> por {cert.client_decided_name} el {new Date(cert.client_decided_at).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}
          {cert.client_note ? `: ${cert.client_note}` : "."}
        </p>
      ) : null}
    </Card>
  );
}

/** Actas de entrega del punch list: zona, quién recibió y cuántos punch se cerraron. */
function Handovers({ data }: { data: ClientView }) {
  if (!data.handovers.length) return <Card className="text-zinc-500">Aún no hay entregas del punch list.</Card>;
  return (
    <Card>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1">Fecha</th>
            <th>Zona</th>
            <th className="text-right">Punch cerrados</th>
            <th>Recibió</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          {data.handovers.map((h) => (
            <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">{h.received_on}</td>
              <td>{h.scope}</td>
              <td className="text-right tabular-nums">{h.items.length}</td>
              <td>
                {h.received_by_name}
                {h.received_by_role ? ` · ${h.received_by_role}` : ""}
              </td>
              <td className="text-zinc-600 dark:text-zinc-400">{h.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
