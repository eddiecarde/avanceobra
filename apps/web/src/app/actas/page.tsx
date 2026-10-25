"use client";

import type { CertificateTerms, VatMode } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, downloadBlob, Field, Input, Select } from "@/components/ui";
import {
  certificateXlsx,
  cop,
  lastTerms,
  loadActas,
  previewCertificate,
  pricesXlsx,
  qty,
  readPricesXlsx,
  sameTarget,
  type ActasData,
  type Certificate,
  type CertificateTarget,
  type PricedActivity,
  VAT_LABEL,
} from "@/lib/actas";
import { CLIENT_STATUS } from "@/lib/cliente";
import { localToday } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const pctIn = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n / 100 : 0;
};

/** Condiciones del acta como se escriben en el formulario (porcentajes en texto). */
interface TermsForm {
  retention: string;
  advance: string;
  admin: string;
  contingency: string;
  utility: string;
  vatMode: VatMode;
  vat: string;
}
const pctOut = (x: number) => (x * 100).toLocaleString("es-CO", { maximumFractionDigits: 4, useGrouping: false });
const toForm = (t: Required<CertificateTerms>): TermsForm => ({
  retention: pctOut(t.retentionPct),
  advance: pctOut(t.advancePct),
  admin: pctOut(t.adminPct),
  contingency: pctOut(t.contingencyPct),
  utility: pctOut(t.utilityPct),
  vatMode: t.vatMode,
  vat: pctOut(t.vatPct),
});

/** Actas de corte y cobro: lo aprobado × precio unitario, por contrato (cliente) o por subcontratista. */
export default function Actas() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canIssue = role === "admin" || role === "director";
  const [loaded, setLoaded] = useState<{ projectId: string; data?: ActasData; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const data = loaded?.projectId === projectId ? (loaded.data ?? null) : null;
  const [targetKey, setTargetKey] = useState("cliente");
  const [cutoff, setCutoff] = useState(localToday());
  // Condiciones por destinatario: arrancan con las de su última acta
  const [termsByTarget, setTermsByTarget] = useState<Record<string, TermsForm>>({});
  const [notes, setNotes] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadActas(projectId).then(
      (d) => setLoaded({ projectId, data: d }),
      (e: Error) => setLoaded({ projectId, error: e.message }),
    );
  }, [projectId, version]);

  const target: CertificateTarget = targetKey === "cliente" ? { kind: "cliente" } : { kind: "empresa", companyId: targetKey };
  const targetName = (companyId: string | null) => (companyId ? (data?.companies.find((c) => c.id === companyId)?.name ?? "Empresa") : (data?.project.client_name ?? "Cliente"));
  const terms = termsByTarget[targetKey] ?? (data ? toForm(lastTerms(data, target)) : null);
  const setTerm = <K extends keyof TermsForm>(k: K, v: TermsForm[K]) => terms && setTermsByTarget({ ...termsByTarget, [targetKey]: { ...terms, [k]: v } });
  const termsNum: CertificateTerms | null = terms
    ? {
        retentionPct: pctIn(terms.retention),
        advancePct: pctIn(terms.advance),
        adminPct: pctIn(terms.admin),
        contingencyPct: pctIn(terms.contingency),
        utilityPct: pctIn(terms.utility),
        vatMode: terms.vatMode,
        vatPct: pctIn(terms.vat),
      }
    : null;
  const termsKey = JSON.stringify(termsNum);
  const preview = useMemo(
    () => (data && termsNum ? previewCertificate(data, target, cutoff, termsNum) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, targetKey, cutoff, termsKey],
  );
  const lines = preview ? (showAll ? preview.lines : preview.lines.filter((l) => Math.abs(l.periodQty) > 1e-9)) : [];

  async function issue() {
    if (!preview || !data) return;
    if (preview.last && cutoff <= preview.last.period_end) return setMsg({ tone: "error", text: `El corte debe ser posterior al de la acta ${preview.last.number} (${preview.last.period_end}).` });
    if (!window.confirm(`Se emitirá el acta N° ${preview.number} para ${targetName(target.kind === "cliente" ? null : target.companyId)} por ${cop(preview.totals.netAmount)} neto. Una vez emitida no se modifica (solo se anula). ¿Continuar?`)) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("payment_certificates").insert({
      project_id: projectId,
      company_id: target.kind === "cliente" ? null : target.companyId,
      number: preview.number,
      period_start: preview.periodStart,
      period_end: cutoff,
      retention_pct: preview.totals.retentionPct,
      advance_pct: preview.totals.advancePct,
      lines: preview.lines,
      totals: preview.totals,
      notes: notes.trim() || null,
      issued_by: (await supabase.auth.getUser()).data.user?.id,
    });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: `Acta N° ${preview.number} emitida. La siguiente acta parte de lo cobrado en esta.` });
    setNotes("");
    setVersion((v) => v + 1);
  }

  async function voidCert(c: Certificate) {
    const reason = window.prompt(`¿Por qué se anula el acta N° ${c.number}?`);
    if (!reason) return;
    const { error } = await supabase.from("payment_certificates").update({ status: "anulada", void_reason: reason }).eq("id", c.id);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: `Acta N° ${c.number} anulada.` });
    setVersion((v) => v + 1);
  }

  async function exportCert(c: Certificate) {
    if (!data) return;
    const buf = await certificateXlsx(c, data.project, targetName(c.company_id));
    downloadBlob(`acta-${c.number}${c.company_id ? `-${targetName(c.company_id).replace(/\W+/g, "-")}` : ""}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  if (!projects.length) return <p className="text-zinc-500">No tienes proyectos asignados.</p>;
  const history = data?.certificates.filter((c) => sameTarget(c, target)) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Actas de corte y cobro</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Lo aprobado en campo × precio unitario: valor del periodo, acumulado y saldo, para el cliente o para cada subcontratista.</p>
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

      {loaded?.error ? <Card className="text-red-700">No se pudo cargar: {loaded.error}</Card> : null}
      {!data || !preview || !terms ? (
        !loaded?.error ? <p className="text-zinc-500">Cargando…</p> : null
      ) : (
        <>
          <Card>
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Acta para">
                <Select value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
                  <option value="cliente">Cliente: {data.project.client_name ?? "contrato principal"}</option>
                  {data.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.kind === "subcontratista" ? "Subcontratista" : "Contratista"}: {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha de corte">
                <Input type="date" value={cutoff} max={localToday()} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
              </Field>
              <Field label="Retención" hint="(%)">
                <Input inputMode="decimal" value={terms.retention} onChange={(e) => setTerm("retention", e.target.value)} />
              </Field>
              <Field label="Amortización anticipo" hint="(%)">
                <Input inputMode="decimal" value={terms.advance} onChange={(e) => setTerm("advance", e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button onClick={() => setShowPrices((v) => !v)} aria-expanded={showPrices} className="w-full">
                  {showPrices ? "Cerrar precios" : "Precios unitarios"}
                </Button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-5">
              <Field label="Administración" hint="(%)">
                <Input inputMode="decimal" value={terms.admin} onChange={(e) => setTerm("admin", e.target.value)} />
              </Field>
              <Field label="Imprevistos" hint="(%)">
                <Input inputMode="decimal" value={terms.contingency} onChange={(e) => setTerm("contingency", e.target.value)} />
              </Field>
              <Field label="Utilidad" hint="(%)">
                <Input inputMode="decimal" value={terms.utility} onChange={(e) => setTerm("utility", e.target.value)} />
              </Field>
              <Field label="IVA">
                <Select value={terms.vatMode} onChange={(e) => setTerm("vatMode", e.target.value as VatMode)}>
                  {(Object.keys(VAT_LABEL) as VatMode[]).map((m) => (
                    <option key={m} value={m}>
                      {VAT_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tarifa de IVA" hint="(%)">
                <Input inputMode="decimal" value={terms.vat} disabled={terms.vatMode === "none"} onChange={(e) => setTerm("vat", e.target.value)} />
              </Field>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Acta N° {preview.number} · periodo {preview.periodStart} a {cutoff}
              {preview.last ? ` · continúa la N° ${preview.last.number} (corte ${preview.last.period_end})` : " · primera acta"}. Solo cuenta lo aprobado por el residente.
            </p>
          </Card>

          {showPrices ? <PricesEditor data={data} canEdit={canIssue} target={target} onSaved={() => setVersion((v) => v + 1)} /> : null}

          {preview.missingPrice.length ? (
            <Card className="border-l-4 border-l-amber-500">
              <b>{preview.missingPrice.length} ítem(s) sin precio</b>{" "}
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                no entran en el acta ({preview.missingPrice.slice(0, 6).join(", ")}
                {preview.missingPrice.length > 6 ? "…" : ""}). Cárgalos en «Precios unitarios», uno por uno o desde Excel.
              </span>
            </Card>
          ) : null}

          <div className={cx("grid gap-3 sm:grid-cols-2", preview.totals.grossAmount !== preview.totals.periodAmount ? "xl:grid-cols-6" : "xl:grid-cols-5")}>
            <Total label="Valor del contrato" value={cop(preview.totals.contractAmount)} sub={`${preview.lines.length} ítem(s) con precio · costo directo`} />
            <Total label="Este periodo" value={cop(preview.totals.periodAmount)} sub={`Costo directo · anterior ${cop(preview.totals.previousAmount)}`} />
            {preview.totals.grossAmount !== preview.totals.periodAmount ? (
              <Total
                label="Valor del acta"
                value={cop(preview.totals.grossAmount)}
                sub={`AIU ${cop(preview.totals.subtotalAmount - preview.totals.periodAmount)} · IVA ${cop(preview.totals.vatAmount)}`}
              />
            ) : null}
            <Total
              label="Neto a pagar"
              value={cop(preview.totals.netAmount)}
              sub={`Retención ${cop(preview.totals.retentionAmount)} · anticipo ${cop(preview.totals.advanceAmount)}`}
              strong
            />
            <Total
              label="Acumulado"
              value={cop(preview.totals.cumulativeAmount)}
              sub={preview.totals.financialProgress == null ? "—" : `${(preview.totals.financialProgress * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} % del contrato`}
            />
            <Total label="Saldo del contrato" value={cop(preview.totals.balanceAmount)} />
          </div>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-lg font-bold">Ítems del acta</h2>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-blue-700" />
                Ver también los ítems sin movimiento en el periodo
              </label>
            </div>
            {lines.length === 0 ? (
              <p className="text-zinc-500">No hay cantidades aprobadas nuevas en este periodo.</p>
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
                    <tr>
                      <th className="px-2 py-2">Ítem</th>
                      <th className="px-2">Und</th>
                      <th className="px-2 text-right">Precio unit.</th>
                      <th className="px-2 text-right">Cant. contrato</th>
                      <th className="px-2 text-right">Anterior</th>
                      <th className="px-2 text-right">Periodo</th>
                      <th className="px-2 text-right">Acumulado</th>
                      <th className="px-2 text-right">Valor periodo</th>
                      <th className="px-2 text-right">Valor acumulado</th>
                      <th className="px-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-1.5">
                          <b>{l.code}</b> · {l.name}
                          {l.exceeds ? <Badge tone="amber">Supera el contrato</Badge> : null}
                        </td>
                        <td className="px-2">{l.unit}</td>
                        <td className="px-2 text-right tabular-nums">{cop(l.unitPrice)}</td>
                        <td className="px-2 text-right tabular-nums">{qty(l.contractQty)}</td>
                        <td className="px-2 text-right tabular-nums">{qty(l.previousQty)}</td>
                        <td className={cx("px-2 text-right font-semibold tabular-nums", l.periodQty < 0 && "text-red-700 dark:text-red-400")}>{qty(l.periodQty)}</td>
                        <td className="px-2 text-right tabular-nums">{qty(l.cumulativeQty)}</td>
                        <td className={cx("px-2 text-right font-semibold tabular-nums", l.periodAmount < 0 && "text-red-700 dark:text-red-400")}>{cop(l.periodAmount)}</td>
                        <td className="px-2 text-right tabular-nums">{cop(l.cumulativeAmount)}</td>
                        <td className="px-2 text-right tabular-nums">{cop(l.balanceAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canIssue ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="Observaciones del acta" hint="(opcional)" className="min-w-64 flex-1">
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="p. ej. Incluye ajuste por corrección del registro del 12/03" />
                </Field>
                <Button variant="primary" disabled={busy || preview.lines.length === 0} onClick={() => void issue()}>
                  {busy ? "Emitiendo…" : `Emitir acta N° ${preview.number}`}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Las actas las emite el director o el administrador.</p>
            )}
            {msg ? <p className={cx("mt-2 font-semibold", msg.tone === "ok" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{msg.text}</p> : null}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-bold">Actas emitidas · {targetName(target.kind === "cliente" ? null : target.companyId)}</h2>
            {history.length === 0 ? (
              <p className="text-zinc-500">Todavía no hay actas para este destinatario.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1">N°</th>
                    <th>Periodo</th>
                    <th className="text-right">Periodo</th>
                    <th className="text-right">Neto</th>
                    <th className="text-right">Acumulado</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id} className={cx("border-t border-zinc-100 dark:border-zinc-800", c.status === "anulada" && "text-zinc-400 line-through")}>
                      <td className="py-1.5 font-bold">{c.number}</td>
                      <td>
                        {c.period_start} a {c.period_end}
                      </td>
                      <td className="text-right tabular-nums">{cop(c.totals.periodAmount)}</td>
                      <td className="text-right font-semibold tabular-nums">{cop(c.totals.netAmount)}</td>
                      <td className="text-right tabular-nums">{cop(c.totals.cumulativeAmount)}</td>
                      <td>
                        <Badge tone={c.status === "emitida" ? "green" : "neutral"}>{c.status === "emitida" ? "Emitida" : "Anulada"}</Badge>{" "}
                        {c.company_id == null && c.status === "emitida" && c.client_status ? (
                          <span title={c.client_decided_name ? `${c.client_decided_name}${c.client_note ? `: ${c.client_note}` : ""}` : undefined}>
                            <Badge tone={CLIENT_STATUS[c.client_status].tone}>Cliente: {CLIENT_STATUS[c.client_status].label.toLowerCase()}</Badge>
                          </span>
                        ) : null}
                        {c.client_status === "observada" && c.client_note ? <div className="text-xs text-red-700 dark:text-red-400">{c.client_note}</div> : null}
                      </td>
                      <td className="space-x-1 text-right no-underline">
                        <Button size="sm" onClick={() => void exportCert(c)}>
                          Excel
                        </Button>
                        <Link href={`/actas/ver?id=${c.id}`} className="inline-flex rounded-lg px-2.5 py-1 text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">
                          Ver / PDF
                        </Link>
                        {canIssue && c.status === "emitida" ? (
                          <Button size="sm" variant="ghost" onClick={() => void voidCert(c)}>
                            Anular
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Total({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className={cx("p-3", strong && "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40")}>
      <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="mt-1 text-xl font-extrabold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-zinc-500">{sub}</div> : null}
    </Card>
  );
}

/** Precios por ítem: con el cliente y con el subcontratista. Se editan aquí o se cargan desde Excel. */
function PricesEditor({ data, canEdit, target, onSaved }: { data: ActasData; canEdit: boolean; target: CertificateTarget; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, { unitPrice?: string; subcontractUnitPrice?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const acts = target.kind === "cliente" ? data.activities : data.activities.filter((a) => a.companyId === target.companyId);
  const shown = acts.filter((a) => !q || `${a.code} ${a.name} ${a.workGroup ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const parse = (s: string | undefined) => (s == null ? undefined : s.trim() === "" ? null : Number(s.replace(/[$\s.]/g, "").replace(",", ".")));

  async function save(changes: Map<string, { unitPrice?: number | null; subcontractUnitPrice?: number | null }>) {
    setBusy(true);
    setMsg(null);
    let n = 0;
    for (const [id, c] of changes) {
      const patch: Record<string, unknown> = {};
      if (c.unitPrice !== undefined) patch.unit_price = c.unitPrice;
      if (c.subcontractUnitPrice !== undefined) patch.subcontract_unit_price = c.subcontractUnitPrice;
      if (!Object.keys(patch).length) continue;
      const { error } = await supabase.from("activities").update(patch).eq("id", id);
      if (error) {
        setBusy(false);
        return setMsg(`Error en un precio: ${error.message}`);
      }
      n++;
    }
    setBusy(false);
    setEdits({});
    setMsg(`${n} ítem(s) con precio actualizado.`);
    onSaved();
  }

  function saveEdits() {
    const changes = new Map<string, { unitPrice?: number | null; subcontractUnitPrice?: number | null }>();
    for (const [id, e] of Object.entries(edits)) {
      const u = parse(e.unitPrice);
      const s = parse(e.subcontractUnitPrice);
      if ((u != null && !(u >= 0)) || (s != null && !(s >= 0))) return setMsg("Hay un precio que no es un número válido.");
      changes.set(id, { unitPrice: u, subcontractUnitPrice: s });
    }
    void save(changes);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    const byCode = await readPricesXlsx(file);
    const changes = new Map<string, { unitPrice?: number | null; subcontractUnitPrice?: number | null }>();
    for (const a of data.activities) {
      const p = byCode.get(a.code);
      if (p && (p.unitPrice !== undefined || p.subcontractUnitPrice !== undefined)) changes.set(a.id, p);
    }
    if (!changes.size) return setMsg("El archivo no trae precios para códigos de esta obra.");
    if (!window.confirm(`Se actualizarán los precios de ${changes.size} ítem(s). ¿Continuar?`)) return;
    await save(changes);
  }

  const val = (a: PricedActivity, k: "unitPrice" | "subcontractUnitPrice") => edits[a.id]?.[k] ?? (a[k] == null ? "" : String(a[k]));
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">Precios unitarios</h2>
        <Input placeholder="Buscar código, ítem o grupo" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button onClick={() => void pricesXlsx(data.activities).then((b) => downloadBlob("precios.xlsx", b, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))}>
          Descargar plantilla
        </Button>
        {canEdit ? (
          <label className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Cargar desde Excel
            <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => void importFile(e.target.files?.[0])} />
          </label>
        ) : null}
      </div>
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
        «Precio unitario» es el del contrato con el cliente; «Precio subcontrato», el que se le paga a la empresa responsable de la actividad. En la plantilla de Excel
        llena las columnas E y F y vuelve a cargarla.
      </p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
            <tr>
              <th className="px-2 py-2">Ítem</th>
              <th className="px-2">Und</th>
              <th className="px-2 text-right">Cantidad</th>
              <th className="px-2">Precio unitario</th>
              <th className="px-2">Precio subcontrato</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-2 py-1">
                  <b>{a.code}</b> · {a.name}
                </td>
                <td className="px-2">{a.unit}</td>
                <td className="px-2 text-right tabular-nums">{qty(a.contractQty)}</td>
                {(["unitPrice", "subcontractUnitPrice"] as const).map((k) => (
                  <td key={k} className="px-2">
                    <Input
                      aria-label={`${k === "unitPrice" ? "Precio unitario" : "Precio subcontrato"} de ${a.code}`}
                      inputMode="decimal"
                      disabled={!canEdit}
                      value={val(a, k)}
                      onChange={(e) => setEdits({ ...edits, [a.id]: { ...edits[a.id], [k]: e.target.value } })}
                      className="py-1"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {acts.length > shown.length ? <p className="mt-1 text-xs text-zinc-500">Se muestran 200 de {acts.length}: usa el buscador o la plantilla de Excel.</p> : null}
      <div className="mt-3 flex items-center gap-3">
        {canEdit ? (
          <Button variant="primary" disabled={busy || !Object.keys(edits).length} onClick={saveEdits}>
            {busy ? "Guardando…" : `Guardar ${Object.keys(edits).length || ""} cambio(s)`}
          </Button>
        ) : null}
        {msg ? <span className="text-sm font-semibold">{msg}</span> : null}
      </div>
    </Card>
  );
}
