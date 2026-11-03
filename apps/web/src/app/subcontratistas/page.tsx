"use client";

import { subcontractorScores, type SubcontractorScore, type VatMode } from "@avanceobra/engine";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { VAT_LABEL, type Subcontract } from "@/lib/actas";
import { fetchAll, loadDashboard, localToday, type DashData } from "@/lib/dashboard";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const M = (n: number) => `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
const P = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const pctIn = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n / 100 : 0;
};
const pctOut = (x: number) => (x * 100).toLocaleString("es-CO", { maximumFractionDigits: 4, useGrouping: false });
const money = (s: string) => {
  const n = Number(s.trim().replace(/[$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const STATUS: Record<SubcontractorScore["status"], { label: string; tone: "green" | "amber" | "red" }> = {
  green: { label: "Al día", tone: "green" },
  amber: { label: "Atención", tone: "amber" },
  red: { label: "Crítico", tone: "red" },
};

interface Loaded {
  projectId: string;
  dash: DashData;
  prices: Map<string, number | null>;
  certificates: { company_id: string; number: number; period_end: string; totals: { cumulativeAmount?: number; retentionAmount?: number } }[];
  planItems: { company_id: string | null; done: boolean | null; week_start: string }[];
  subcontracts: Subcontract[];
}

/** Subcontratistas: su contrato y su desempeño (plazo, plata, plan semanal y calidad) en una sola vista. */
export default function Subcontratistas() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const canSee = role === "resident" || role === "director" || role === "admin";
  const canEdit = role === "director" || role === "admin";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cutoff = localToday();

  useEffect(() => {
    if (!projectId || !canSee) return;
    let off = false;
    void Promise.all([
      loadDashboard(projectId),
      fetchAll<{ id: string; subcontract_unit_price: number | null }>((a, b) =>
        supabase.from("activities").select("id, subcontract_unit_price").eq("project_id", projectId).order("id").range(a, b),
      ),
      supabase.from("payment_certificates").select("company_id, number, period_end, totals").eq("project_id", projectId).not("company_id", "is", null).eq("status", "emitida"),
      supabase.from("weekly_plan_items").select("company_id, done, plan:weekly_plans(week_start)").eq("project_id", projectId),
      supabase.from("subcontracts").select("*").eq("project_id", projectId),
    ]).then(
      ([dash, prices, certs, items, sc]) => {
        if (off) return;
        const err = prices.error ?? certs.error ?? items.error ?? sc.error;
        if (err) return setError(err.message);
        setLoaded({
          projectId,
          dash,
          prices: new Map(prices.data.map((p) => [p.id, p.subcontract_unit_price == null ? null : Number(p.subcontract_unit_price)])),
          certificates: (certs.data ?? []) as Loaded["certificates"],
          planItems: ((items.data ?? []) as unknown as { company_id: string | null; done: boolean | null; plan: { week_start: string } | null }[]).map((i) => ({
            company_id: i.company_id,
            done: i.done,
            week_start: i.plan?.week_start ?? "",
          })),
          subcontracts: (sc.data ?? []) as Subcontract[],
        });
      },
      (e: Error) => !off && setError(e.message),
    );
    return () => {
      off = true;
    };
  }, [projectId, canSee, version]);

  const data = loaded?.projectId === projectId ? loaded : null;
  const subs = useMemo(() => data?.dash.companies.filter((c) => c.kind === "subcontratista") ?? [], [data]);
  const scores = useMemo(() => {
    if (!data) return [];
    return subcontractorScores({
      companyIds: subs.map((s) => s.id),
      activities: data.dash.activities.map((a) => ({
        id: a.id,
        companyId: a.companyId,
        contractQty: a.contractQty,
        unitPrice: data.prices.get(a.id) ?? null,
        plannedStart: a.plannedStart,
        plannedFinish: a.plannedFinish,
      })),
      approved: data.dash.entries.filter((e) => e.status === "approved").map((e) => ({ activityId: e.activityId, date: e.workDate, quantity: e.quantity })),
      certificates: data.certificates.map((c) => ({
        companyId: c.company_id,
        number: c.number,
        periodEnd: c.period_end,
        cumulativeAmount: Number(c.totals.cumulativeAmount ?? 0),
        retentionAmount: Number(c.totals.retentionAmount ?? 0),
      })),
      findings: data.dash.findings.map((f) => ({ companyId: f.companyId, category: f.category, status: f.status, dueDate: f.dueDate, createdAt: f.createdAt, closedAt: f.closedAt })),
      planItems: data.planItems.map((i) => ({ companyId: i.company_id, weekStart: i.week_start, done: i.done })),
      cutoff,
      calendar: data.dash.project.calendar,
    });
  }, [data, subs, cutoff]);

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  if (!canSee) return <p className="text-zinc-600">Los subcontratos los ven el residente, el director y el administrador.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Subcontratistas</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Contrato y desempeño de cada uno: plazo, plata, plan semanal y calidad, para decidir a quién darle más frente o a quién llamar.</p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => (setPicked(e.target.value), setOpen(null))}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {error ? <Card className="text-red-700">No se pudo cargar: {error}</Card> : null}
      {!data ? (
        !error ? <p className="text-zinc-500">Cargando…</p> : null
      ) : !subs.length ? (
        <Card>
          <h2 className="text-lg font-bold">Aún no hay subcontratistas</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Créalos en <Link href="/equipo" className="font-semibold text-blue-700 underline dark:text-blue-400">Equipo → Empresas</Link> con tipo subcontratista y
            asígnales sus actividades en <Link href="/proyecto" className="font-semibold text-blue-700 underline dark:text-blue-400">Proyecto</Link>. Los precios
            del subcontrato se cargan en Actas de cobro.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1">Subcontratista</th>
                  <th className="text-right">Contrato</th>
                  <th className="text-right">Avance</th>
                  <th className="text-right">SPI</th>
                  <th className="text-right">Ejecutado</th>
                  <th className="text-right">Facturado</th>
                  <th className="text-right">Por facturar</th>
                  <th className="text-right">Retenido</th>
                  <th className="text-right">Plan semanal</th>
                  <th className="text-right">NC abiertas</th>
                  <th className="text-right">Días para cerrar</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scores.map((s) => {
                  const company = subs.find((c) => c.id === s.companyId)!;
                  return (
                    <tr key={s.companyId} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                      <td className="py-2">
                        <b>{company.name}</b>
                        <div className="text-xs text-zinc-500">
                          {s.activities} actividad(es){data.subcontracts.some((c) => c.company_id === s.companyId) ? "" : " · sin contrato registrado"}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{M(s.contractValue)}</td>
                      <td className="text-right tabular-nums">{P(s.progress)}</td>
                      <td className={cx("text-right font-semibold tabular-nums", s.spi != null && (s.spi < 0.85 ? "text-red-700 dark:text-red-400" : s.spi < 0.95 ? "text-amber-600" : "text-green-700 dark:text-green-400"))}>
                        {s.spi == null ? "—" : s.spi.toLocaleString("es-CO", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                      </td>
                      <td className="text-right tabular-nums">{M(s.executedValue)}</td>
                      <td className="text-right tabular-nums">
                        {M(s.billed)}
                        {s.lastCertificate ? <div className="text-xs text-zinc-500">acta {s.lastCertificate}</div> : null}
                      </td>
                      <td className="text-right tabular-nums">{M(s.toBill)}</td>
                      <td className="text-right tabular-nums">{M(s.retained)}</td>
                      <td className="text-right tabular-nums">{s.planItems ? P(s.ppc) : "—"}</td>
                      <td className={cx("text-right tabular-nums", s.ncOverdue > 0 && "font-semibold text-red-700 dark:text-red-400")}>
                        {s.ncOpen}
                        {s.ncOverdue ? <div className="text-xs">{s.ncOverdue} vencida(s)</div> : null}
                      </td>
                      <td className="text-right tabular-nums">{s.ncCloseDays == null ? "—" : s.ncCloseDays.toLocaleString("es-CO", { maximumFractionDigits: 1 })}</td>
                      <td>
                        <span title={s.reasons.join(" ")}>
                          <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                        </span>
                      </td>
                      <td className="text-right">
                        <Button size="sm" onClick={() => setOpen(open === s.companyId ? null : s.companyId)} aria-expanded={open === s.companyId}>
                          {open === s.companyId ? "Cerrar" : "Contrato"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {scores.some((s) => s.reasons.length) ? (
            <ul className="mt-3 space-y-1 text-sm">
              {scores
                .filter((s) => s.reasons.length)
                .map((s) => (
                  <li key={s.companyId}>
                    <b>{subs.find((c) => c.id === s.companyId)!.name}:</b> {s.reasons.join(" ")}
                  </li>
                ))}
            </ul>
          ) : null}
        </Card>
      )}

      {data && open ? (
        <ContractEditor
          key={open}
          projectId={projectId}
          companyId={open}
          companyName={subs.find((c) => c.id === open)?.name ?? ""}
          current={data.subcontracts.find((c) => c.company_id === open) ?? null}
          canEdit={canEdit}
          onSaved={() => setVersion((v) => v + 1)}
        />
      ) : null}
    </div>
  );
}

/** Contrato del subcontratista: alcance, fechas y condiciones de pago (las usa su primera acta). */
function ContractEditor({
  projectId,
  companyId,
  companyName,
  current,
  canEdit,
  onSaved,
}: {
  projectId: string;
  companyId: string;
  companyName: string;
  current: Subcontract | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [f, setF] = useState(() => ({
    contract_code: current?.contract_code ?? "",
    scope: current?.scope ?? "",
    start_date: current?.start_date ?? "",
    end_date: current?.end_date ?? "",
    retention: pctOut(Number(current?.retention_pct ?? 0)),
    advance: pctOut(Number(current?.advance_pct ?? 0)),
    advance_amount: String(Number(current?.advance_amount ?? 0) || ""),
    admin: pctOut(Number(current?.admin_pct ?? 0)),
    contingency: pctOut(Number(current?.contingency_pct ?? 0)),
    utility: pctOut(Number(current?.utility_pct ?? 0)),
    vat_mode: (current?.vat_mode ?? "none") as VatMode,
    vat: pctOut(Number(current?.vat_pct ?? 0.19)),
    notes: current?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("subcontracts").upsert(
      {
        project_id: projectId,
        company_id: companyId,
        contract_code: f.contract_code.trim() || null,
        scope: f.scope.trim() || null,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        retention_pct: pctIn(f.retention),
        advance_pct: pctIn(f.advance),
        advance_amount: money(f.advance_amount),
        admin_pct: pctIn(f.admin),
        contingency_pct: pctIn(f.contingency),
        utility_pct: pctIn(f.utility),
        vat_mode: f.vat_mode,
        vat_pct: pctIn(f.vat),
        notes: f.notes.trim() || null,
      },
      { onConflict: "project_id,company_id" },
    );
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: "Contrato guardado. Su primera acta de pago arranca con estas condiciones." });
    onSaved();
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Contrato de {companyName}</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Sus actividades son las que tienen su empresa en Proyecto; sus precios, los «precios de subcontrato» de Actas de cobro.
      </p>
      <fieldset disabled={!canEdit} className="grid gap-3 md:grid-cols-4">
        <Field label="Número de contrato">
          <Input value={f.contract_code} onChange={(e) => set("contract_code", e.target.value)} />
        </Field>
        <Field label="Inicio">
          <Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </Field>
        <Field label="Terminación">
          <Input type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} />
        </Field>
        <Field label="Anticipo entregado" hint="($)">
          <Input inputMode="numeric" value={f.advance_amount} onChange={(e) => set("advance_amount", e.target.value)} />
        </Field>
        <Field label="Alcance" className="md:col-span-4">
          <Textarea rows={2} value={f.scope} onChange={(e) => set("scope", e.target.value)} placeholder="p. ej. Hincado de pilotes de los subcampos 1 a 10, con suministro de equipo" />
        </Field>
        <Field label="Retención" hint="(%)">
          <Input inputMode="decimal" value={f.retention} onChange={(e) => set("retention", e.target.value)} />
        </Field>
        <Field label="Amortización anticipo" hint="(%)">
          <Input inputMode="decimal" value={f.advance} onChange={(e) => set("advance", e.target.value)} />
        </Field>
        <Field label="IVA">
          <Select value={f.vat_mode} onChange={(e) => set("vat_mode", e.target.value)}>
            {(Object.keys(VAT_LABEL) as VatMode[]).map((m) => (
              <option key={m} value={m}>
                {VAT_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tarifa de IVA" hint="(%)">
          <Input inputMode="decimal" value={f.vat} disabled={f.vat_mode === "none"} onChange={(e) => set("vat", e.target.value)} />
        </Field>
        <Field label="Administración" hint="(%)">
          <Input inputMode="decimal" value={f.admin} onChange={(e) => set("admin", e.target.value)} />
        </Field>
        <Field label="Imprevistos" hint="(%)">
          <Input inputMode="decimal" value={f.contingency} onChange={(e) => set("contingency", e.target.value)} />
        </Field>
        <Field label="Utilidad" hint="(%)">
          <Input inputMode="decimal" value={f.utility} onChange={(e) => set("utility", e.target.value)} />
        </Field>
        <Field label="Notas">
          <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar contrato"}
          </Button>
        ) : (
          <span className="text-sm text-zinc-500">Solo el director o el administrador cambian el contrato.</span>
        )}
        {msg ? <span className={msg.tone === "ok" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-red-700 dark:text-red-400"}>{msg.text}</span> : null}
      </div>
    </Card>
  );
}
