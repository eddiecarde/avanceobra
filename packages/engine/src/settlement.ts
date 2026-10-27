/**
 * Acta de liquidación final de un contrato (el del cliente o el de un subcontratista):
 *  valor inicial + órdenes de cambio aprobadas = valor final;
 *  ejecutado (aprobado × precio) − facturado en actas = pendiente por facturar (con su AIU e IVA);
 *  + retención acumulada que se devuelve − anticipo que falta por amortizar = saldo a pagar.
 */
import type { CertificateTerms } from "./payments.js";

export interface SettlementInput {
  /** Actividades del contrato con su cantidad y precio actuales (ya con las órdenes aplicadas). */
  lines: { contractQty: number; unitPrice: number | null; approvedQty: number }[];
  /** Actas vigentes del contrato. */
  certificates: { cumulativeAmount: number; retentionAmount: number; advanceAmount: number; netAmount: number; number: number }[];
  /** Valor de las órdenes de cambio aprobadas. */
  changeOrdersAmount: number;
  /** Anticipo entregado al contratista o subcontratista. */
  advanceGiven: number;
  /** Condiciones para lo pendiente por facturar (AIU e IVA del contrato). */
  terms?: CertificateTerms;
}

export interface SettlementTotals {
  initialValue: number;
  changeOrdersAmount: number;
  finalValue: number;
  executedValue: number;
  /** Lo del contrato que no se ejecutó (no se paga). */
  notExecuted: number;
  billedDirect: number;
  certificates: number;
  pendingDirect: number;
  pendingAiu: number;
  pendingVat: number;
  pendingGross: number;
  retentionToReturn: number;
  advanceGiven: number;
  advanceAmortized: number;
  advancePending: number;
  paidNet: number;
  /** Saldo a pagar en la liquidación (negativo = el contratista debe devolver). */
  balance: number;
  /** Total recibido con la liquidación: lo pagado en actas + el saldo + el anticipo. */
  totalPaid: number;
}

const money = (x: number) => Math.round(x * 100) / 100;

export function contractSettlement(input: SettlementInput): SettlementTotals {
  const priced = input.lines.filter((l) => l.unitPrice != null);
  const finalValue = money(priced.reduce((t, l) => t + l.contractQty * l.unitPrice!, 0));
  const executedValue = money(priced.reduce((t, l) => t + l.approvedQty * l.unitPrice!, 0));
  const last = [...input.certificates].sort((a, b) => b.number - a.number)[0];
  const billedDirect = money(last?.cumulativeAmount ?? 0);
  const pendingDirect = money(executedValue - billedDirect);
  const t = input.terms ?? {};
  const aiuPct = (t.adminPct ?? 0) + (t.contingencyPct ?? 0) + (t.utilityPct ?? 0);
  const pendingAiu = money(pendingDirect * aiuPct);
  const vatPct = t.vatMode && t.vatMode !== "none" ? (t.vatPct ?? 0.19) : 0;
  const vatBase = t.vatMode === "utility" ? pendingDirect * (t.utilityPct ?? 0) : t.vatMode === "full" ? pendingDirect + pendingAiu : 0;
  const pendingVat = money(vatBase * vatPct);
  const pendingGross = money(pendingDirect + pendingAiu + pendingVat);
  const retentionToReturn = money(input.certificates.reduce((s, c) => s + c.retentionAmount, 0));
  const advanceAmortized = money(input.certificates.reduce((s, c) => s + c.advanceAmount, 0));
  const advancePending = money(Math.max(0, input.advanceGiven - advanceAmortized));
  const paidNet = money(input.certificates.reduce((s, c) => s + c.netAmount, 0));
  const balance = money(pendingGross + retentionToReturn - advancePending);
  return {
    initialValue: money(finalValue - input.changeOrdersAmount),
    changeOrdersAmount: money(input.changeOrdersAmount),
    finalValue,
    executedValue,
    notExecuted: money(Math.max(0, finalValue - executedValue)),
    billedDirect,
    certificates: input.certificates.length,
    pendingDirect,
    pendingAiu,
    pendingVat,
    pendingGross,
    retentionToReturn,
    advanceGiven: money(input.advanceGiven),
    advanceAmortized,
    advancePending,
    paidNet,
    balance,
    totalPaid: money(paidNet + balance + input.advanceGiven),
  };
}
