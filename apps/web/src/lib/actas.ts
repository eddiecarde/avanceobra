"use client";

import { paymentCertificate, type CertificateLine, type CertificateTerms, type CertificateTotals, type SettlementTotals, type VatMode } from "@avanceobra/engine";
import { fetchAll } from "./dashboard";
import { supabase } from "./supabase";

export interface PricedActivity {
  id: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  unitPrice: number | null;
  subcontractUnitPrice: number | null;
  companyId: string | null;
  workGroup: string | null;
}

export interface Company {
  id: string;
  name: string;
  kind: "contratista" | "subcontratista";
}

export interface Certificate {
  id: string;
  company_id: string | null;
  number: number;
  period_start: string;
  period_end: string;
  status: "emitida" | "anulada";
  retention_pct: number;
  advance_pct: number;
  lines: CertificateLine[];
  totals: CertificateTotals;
  notes: string | null;
  issued_at: string;
  void_reason: string | null;
  /** Decisión del cliente en su portal (solo actas al cliente). */
  client_status?: "pendiente" | "aprobada" | "observada";
  client_note?: string | null;
  client_decided_name?: string | null;
}

export interface ProjectHeader {
  name: string;
  client_name: string | null;
  contractor_name: string | null;
  contract_code: string | null;
  report_signers: string[] | null;
  start_date: string | null;
}

export interface ActasData {
  project: ProjectHeader;
  activities: PricedActivity[];
  companies: Company[];
  /** Registros aprobados (fecha y cantidad) por actividad. */
  approved: { activityId: string; date: string; quantity: number }[];
  certificates: Certificate[];
  /** Contratos de los subcontratistas: condiciones de pago para su primera acta. */
  subcontracts: Subcontract[];
  /** Liquidaciones emitidas o anuladas. */
  settlements: Settlement[];
  /** Órdenes de cambio aprobadas: su valor por contrato. */
  changeOrders: { company_id: string | null; amount: number }[];
}

export interface Settlement {
  id: string;
  company_id: string | null;
  status: "emitida" | "anulada";
  totals: SettlementTotals;
  notes: string | null;
  issued_at: string;
  void_reason: string | null;
}

export interface Subcontract {
  id: string;
  company_id: string;
  contract_code: string | null;
  scope: string | null;
  start_date: string | null;
  end_date: string | null;
  retention_pct: number;
  advance_pct: number;
  advance_amount: number;
  admin_pct: number;
  contingency_pct: number;
  utility_pct: number;
  vat_mode: VatMode;
  vat_pct: number;
  notes: string | null;
}

export async function loadActas(projectId: string): Promise<ActasData> {
  const [p, a, e, c, cs, sc, st, co] = await Promise.all([
    supabase.from("projects").select("name, client_name, contractor_name, contract_code, report_signers, start_date").eq("id", projectId).single(),
    fetchAll((x, y) =>
      supabase
        .from("activities")
        .select("id, code, name, unit, contract_qty, unit_price, subcontract_unit_price, company_id, work_group")
        .eq("project_id", projectId)
        .order("code")
        .order("id")
        .range(x, y),
    ),
    fetchAll((x, y) =>
      supabase.from("progress_entries").select("activity_id, work_date, quantity").eq("project_id", projectId).eq("status", "approved").order("work_date").order("id").range(x, y),
    ),
    supabase.from("project_companies").select("id, name, kind").eq("project_id", projectId).order("kind").order("name"),
    supabase.from("payment_certificates").select("*").eq("project_id", projectId).order("issued_at", { ascending: false }),
    supabase.from("subcontracts").select("*").eq("project_id", projectId),
    supabase.from("settlements").select("id, company_id, status, totals, notes, issued_at, void_reason").eq("project_id", projectId).order("issued_at", { ascending: false }),
    supabase.from("change_orders").select("company_id, amount").eq("project_id", projectId).eq("status", "aprobada"),
  ]);
  for (const r of [p, a, e, c, cs]) if (r.error) throw new Error(r.error.message);
  return {
    project: p.data as ProjectHeader,
    activities: (a.data as Record<string, unknown>[]).map((x) => ({
      id: x.id as string,
      code: x.code as string,
      name: x.name as string,
      unit: x.unit as string,
      contractQty: Number(x.contract_qty),
      unitPrice: x.unit_price == null ? null : Number(x.unit_price),
      subcontractUnitPrice: x.subcontract_unit_price == null ? null : Number(x.subcontract_unit_price),
      companyId: (x.company_id as string | null) ?? null,
      workGroup: (x.work_group as string | null) ?? null,
    })),
    companies: (c.data ?? []) as Company[],
    approved: (e.data as { activity_id: string; work_date: string; quantity: number }[]).map((x) => ({ activityId: x.activity_id, date: x.work_date, quantity: Number(x.quantity) })),
    certificates: ((cs.data ?? []) as Certificate[]).map((x) => ({ ...x, retention_pct: Number(x.retention_pct), advance_pct: Number(x.advance_pct) })),
    // Sin permiso (residente) o sin contratos: lista vacía
    subcontracts: ((sc.data ?? []) as Subcontract[]).map((x) => ({
      ...x,
      retention_pct: Number(x.retention_pct),
      advance_pct: Number(x.advance_pct),
      advance_amount: Number(x.advance_amount),
      admin_pct: Number(x.admin_pct),
      contingency_pct: Number(x.contingency_pct),
      utility_pct: Number(x.utility_pct),
      vat_pct: Number(x.vat_pct),
    })),
    settlements: (st.data ?? []) as Settlement[],
    changeOrders: ((co.data ?? []) as { company_id: string | null; amount: number | null }[]).map((x) => ({ company_id: x.company_id, amount: Number(x.amount ?? 0) })),
  };
}

/** Para quién es el acta: el cliente (todo el contrato) o una empresa (sus actividades, a su precio). */
export type CertificateTarget = { kind: "cliente" } | { kind: "empresa"; companyId: string };

export const sameTarget = (c: Certificate, t: CertificateTarget) => (t.kind === "cliente" ? c.company_id == null : c.company_id === t.companyId);

/** Última acta vigente (no anulada) del mismo destinatario: de ella sale lo ya cobrado. */
export function lastCertificate(data: ActasData, t: CertificateTarget) {
  return data.certificates.filter((c) => c.status === "emitida" && sameTarget(c, t)).sort((a, b) => b.number - a.number)[0] ?? null;
}

/** Condiciones de la última acta del mismo destinatario (para no volver a escribirlas). */
export function lastTerms(data: ActasData, t: CertificateTarget): Required<CertificateTerms> {
  const x = lastCertificate(data, t)?.totals;
  // Primera acta de un subcontratista: las condiciones de su contrato
  const sc = !x && t.kind === "empresa" ? data.subcontracts.find((s) => s.company_id === t.companyId) : undefined;
  if (sc)
    return {
      retentionPct: sc.retention_pct,
      advancePct: sc.advance_pct,
      adminPct: sc.admin_pct,
      contingencyPct: sc.contingency_pct,
      utilityPct: sc.utility_pct,
      vatMode: sc.vat_mode,
      vatPct: sc.vat_mode !== "none" ? sc.vat_pct : 0.19,
    };
  return {
    retentionPct: x?.retentionPct ?? 0,
    advancePct: x?.advancePct ?? 0,
    adminPct: x?.adminPct ?? 0,
    contingencyPct: x?.contingencyPct ?? 0,
    utilityPct: x?.utilityPct ?? 0,
    vatMode: x?.vatMode ?? "none",
    vatPct: x?.vatMode && x.vatMode !== "none" ? x.vatPct : 0.19,
  };
}

export const VAT_LABEL: Record<VatMode, string> = { none: "Sin IVA", utility: "IVA sobre la utilidad (AIU)", full: "IVA sobre el total" };

export function previewCertificate(data: ActasData, t: CertificateTarget, cutoff: string, opts: CertificateTerms) {
  const last = lastCertificate(data, t);
  const previous = new Map((last?.lines ?? []).map((l) => [l.id, l.cumulativeQty]));
  const cum = new Map<string, number>();
  for (const e of data.approved) if (e.date <= cutoff) cum.set(e.activityId, (cum.get(e.activityId) ?? 0) + e.quantity);
  const acts = t.kind === "cliente" ? data.activities : data.activities.filter((a) => a.companyId === t.companyId);
  const result = paymentCertificate(
    acts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      contractQty: a.contractQty,
      unitPrice: t.kind === "cliente" ? a.unitPrice : a.subcontractUnitPrice,
      previousQty: previous.get(a.id) ?? 0,
      cumulativeQty: cum.get(a.id) ?? 0,
    })),
    opts,
  );
  const periodStart = last ? addDay(last.period_end) : (data.project.start_date ?? data.approved[0]?.date ?? cutoff);
  return { ...result, last, number: Math.max(0, ...data.certificates.filter((c) => sameTarget(c, t)).map((c) => c.number)) + 1, periodStart: periodStart > cutoff ? cutoff : periodStart };
}

const addDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

// Tolerantes a datos incompletos (actas antiguas o editadas a mano): muestran 0
export const cop = (n: number | null | undefined) => `$${Math.round(n ?? 0).toLocaleString("es-CO")}`;
export const qty = (n: number | null | undefined) => (n ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 2 });

const pctTxt = (x: number | undefined) => `${((x ?? 0) * 100).toLocaleString("es-CO")} %`;

/** Renglones de totales del acta (los de AIU e IVA solo si aplican: las actas antiguas no los tienen). */
export function totalsRows(t: CertificateTotals): [string, number][] {
  const aiu = !!(t.adminAmount || t.contingencyAmount || t.utilityAmount);
  return [
    [aiu ? "Valor del contrato (costo directo)" : "Valor del contrato", t.contractAmount],
    ["Acumulado anterior", t.previousAmount],
    [aiu ? "Costo directo de este periodo" : "Valor de este periodo", t.periodAmount],
    ...(aiu
      ? ([
          [`Administración (${pctTxt(t.adminPct)})`, t.adminAmount],
          [`Imprevistos (${pctTxt(t.contingencyPct)})`, t.contingencyAmount],
          [`Utilidad (${pctTxt(t.utilityPct)})`, t.utilityAmount],
          ["Subtotal antes de IVA", t.subtotalAmount],
        ] as [string, number][])
      : []),
    ...(t.vatAmount ? ([[`IVA ${pctTxt(t.vatPct)} ${t.vatMode === "utility" ? "sobre la utilidad" : "sobre el total"}`, t.vatAmount]] as [string, number][]) : []),
    ...(t.grossAmount != null && t.grossAmount !== t.periodAmount ? ([["Valor del acta", t.grossAmount]] as [string, number][]) : []),
    [`Retención (${pctTxt(t.retentionPct)})`, -t.retentionAmount],
    [`Amortización del anticipo (${pctTxt(t.advancePct)})`, -t.advanceAmount],
    ["NETO A PAGAR", t.netAmount],
    ["Acumulado a la fecha (costo directo)", t.cumulativeAmount],
    ["Saldo del contrato", t.balanceAmount],
  ];
}

/** Renglones de la liquidación final (para pantalla e impresión). */
export function settlementRows(t: SettlementTotals): [string, number, boolean?][] {
  return [
    ["Valor inicial del contrato", t.initialValue],
    ["Órdenes de cambio aprobadas", t.changeOrdersAmount],
    ["Valor final del contrato", t.finalValue, true],
    ["Ejecutado y aprobado", t.executedValue],
    ["No ejecutado (no se paga)", t.notExecuted],
    [`Facturado en ${t.certificates} acta(s) (costo directo)`, t.billedDirect],
    ["Pendiente por facturar (costo directo)", t.pendingDirect],
    ...(t.pendingAiu ? ([["AIU de lo pendiente", t.pendingAiu]] as [string, number][]) : []),
    ...(t.pendingVat ? ([["IVA de lo pendiente", t.pendingVat]] as [string, number][]) : []),
    ["Retención acumulada que se devuelve", t.retentionToReturn],
    ["Anticipo por amortizar (se descuenta)", -t.advancePending],
    ["SALDO A PAGAR EN LA LIQUIDACIÓN", t.balance, true],
    ["Pagado en actas (neto)", t.paidNet],
    ["Anticipo entregado", t.advanceGiven],
    ["Total recibido con la liquidación", t.totalPaid, true],
  ];
}

/** Acta en Excel: encabezado del contrato, ítems con anterior, periodo y acumulado, totales y firmas. */
export async function certificateXlsx(cert: Certificate, project: ProjectHeader, targetName: string): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Acta ${cert.number}`, { views: [{ state: "frozen", ySplit: 8 }] });
  const bold = { bold: true };
  ws.addRow([`ACTA DE CORTE N° ${cert.number}${cert.status === "anulada" ? " (ANULADA)" : ""}`]).font = { bold: true, size: 14 };
  ws.addRow(["Proyecto", project.name]);
  ws.addRow(["Contrato", project.contract_code ?? ""]);
  ws.addRow([cert.company_id ? "Subcontratista" : "Cliente", targetName]);
  ws.addRow(["Contratista", project.contractor_name ?? ""]);
  ws.addRow(["Periodo", `${cert.period_start} a ${cert.period_end}`]);
  ws.addRow([]);
  const head = ws.addRow([
    "Código",
    "Ítem",
    "Und",
    "Cant. contrato",
    "Precio unitario",
    "Valor contrato",
    "Cant. anterior",
    "Cant. periodo",
    "Cant. acumulada",
    "Valor anterior",
    "Valor periodo",
    "Valor acumulado",
    "Saldo",
  ]);
  head.font = bold;
  head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } }));
  for (const l of cert.lines)
    ws.addRow([l.code, l.name, l.unit, l.contractQty, l.unitPrice, l.contractAmount, l.previousQty, l.periodQty, l.cumulativeQty, l.previousAmount, l.periodAmount, l.cumulativeAmount, l.balanceAmount]);
  const t = cert.totals;
  ws.addRow([]);
  for (const [label, v] of totalsRows(t)) {
    const r = ws.addRow(["", label, "", "", "", "", "", "", "", "", v]);
    r.getCell(2).font = bold;
    r.getCell(11).font = bold;
  }
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(["", ...(project.report_signers?.length ? project.report_signers : ["Elaboró", "Revisó", "Aprobó"])].map((s, i) => (i ? `______________________\n${s}` : "")));
  ws.columns.forEach((c, i) => {
    c.width = i === 1 ? 46 : i === 0 ? 18 : 15;
    if (i >= 3) c.numFmt = i === 4 || i === 5 || i >= 9 ? '"$"#,##0' : "#,##0.00";
  });
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Plantilla de precios: código, ítem, unidad, cantidad y los dos precios (para llenar en Excel). */
export async function pricesXlsx(acts: PricedActivity[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Precios");
  ws.addRow(["Código", "Ítem", "Unidad", "Cantidad contrato", "Precio unitario", "Precio subcontrato"]).font = { bold: true };
  for (const a of acts) ws.addRow([a.code, a.name, a.unit, a.contractQty, a.unitPrice, a.subcontractUnitPrice]);
  ws.columns.forEach((c, i) => (c.width = i === 1 ? 50 : 18));
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Lee la plantilla de precios: código → precios (vacío = sin cambio). */
export async function readPricesXlsx(file: File): Promise<Map<string, { unitPrice?: number | null; subcontractUnitPrice?: number | null }>> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0]!;
  const num = (v: unknown) => {
    const x = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
    if (x == null || x === "") return undefined;
    const n = typeof x === "number" ? x : Number(String(x).replace(/[$\s.]/g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const out = new Map<string, { unitPrice?: number | null; subcontractUnitPrice?: number | null }>();
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const code = String(r.getCell(1).value ?? "").trim();
    if (!code) return;
    out.set(code, { unitPrice: num(r.getCell(5).value), subcontractUnitPrice: num(r.getCell(6).value) });
  });
  return out;
}
