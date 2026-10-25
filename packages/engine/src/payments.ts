/**
 * Acta de corte y cobro: convierte las cantidades aprobadas en dinero. Por ítem: lo cobrado en
 * actas anteriores, lo del periodo (acumulado aprobado menos lo ya cobrado), el acumulado y el
 * saldo del contrato. Totales con AIU (administración, imprevistos y utilidad sobre el costo
 * directo), IVA (sobre la utilidad en contratos AIU o sobre el total), retención (retegarantía) y
 * amortización del anticipo. La retención y el anticipo se calculan sobre el valor antes de IVA.
 */

/** IVA del acta: sin IVA, sobre la utilidad (contratos AIU, art. 462-1 E.T.) o sobre el total. */
export type VatMode = "none" | "utility" | "full";

export interface CertificateTerms {
  retentionPct?: number;
  advancePct?: number;
  adminPct?: number;
  contingencyPct?: number;
  utilityPct?: number;
  vatMode?: VatMode;
  vatPct?: number;
}

export interface CertificateItemInput {
  id: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  /** Precio unitario pactado (con el cliente o con el subcontratista); null = sin precio. */
  unitPrice: number | null;
  /** Cantidad ya cobrada en las actas anteriores (acumulado de la última acta vigente). */
  previousQty: number;
  /** Cantidad aprobada acumulada hasta el corte. */
  cumulativeQty: number;
}

export interface CertificateLine {
  id: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  unitPrice: number;
  previousQty: number;
  periodQty: number;
  cumulativeQty: number;
  contractAmount: number;
  previousAmount: number;
  periodAmount: number;
  cumulativeAmount: number;
  balanceAmount: number;
  /** El acumulado supera la cantidad del contrato (se cobra, pero hay que soportarlo con una adición). */
  exceeds: boolean;
}

export interface CertificateTotals {
  contractAmount: number;
  previousAmount: number;
  periodAmount: number;
  cumulativeAmount: number;
  balanceAmount: number;
  retentionPct: number;
  retentionAmount: number;
  advancePct: number;
  advanceAmount: number;
  adminPct: number;
  adminAmount: number;
  contingencyPct: number;
  contingencyAmount: number;
  utilityPct: number;
  utilityAmount: number;
  /** Costo directo del periodo + AIU (antes de IVA). */
  subtotalAmount: number;
  vatMode: VatMode;
  vatPct: number;
  vatAmount: number;
  /** Valor del acta: subtotal + IVA. */
  grossAmount: number;
  /** A pagar en esta acta: valor del acta − retención − amortización del anticipo. */
  netAmount: number;
  /** Avance financiero: acumulado ÷ valor del contrato. */
  financialProgress: number | null;
}

const money = (x: number) => Math.round(x * 100) / 100;

export function paymentCertificate(items: CertificateItemInput[], opts: CertificateTerms = {}) {
  const missingPrice = items.filter((i) => i.unitPrice == null).map((i) => i.code);
  const lines: CertificateLine[] = items
    .filter((i) => i.unitPrice != null)
    .map((i) => {
      const price = i.unitPrice!;
      // Si una corrección bajó lo aprobado, el periodo sale negativo: se descuenta en esta acta
      const periodQty = i.cumulativeQty - i.previousQty;
      return {
        id: i.id,
        code: i.code,
        name: i.name,
        unit: i.unit,
        contractQty: i.contractQty,
        unitPrice: price,
        previousQty: i.previousQty,
        periodQty,
        cumulativeQty: i.cumulativeQty,
        contractAmount: money(i.contractQty * price),
        previousAmount: money(i.previousQty * price),
        periodAmount: money(periodQty * price),
        cumulativeAmount: money(i.cumulativeQty * price),
        balanceAmount: money((i.contractQty - i.cumulativeQty) * price),
        exceeds: i.cumulativeQty > i.contractQty + 1e-9,
      };
    });
  const sum = (k: keyof CertificateLine) => money(lines.reduce((t, l) => t + (l[k] as number), 0));
  const retentionPct = opts.retentionPct ?? 0;
  const advancePct = opts.advancePct ?? 0;
  const periodAmount = sum("periodAmount");
  const contractAmount = sum("contractAmount");
  const cumulativeAmount = sum("cumulativeAmount");
  const adminPct = opts.adminPct ?? 0;
  const contingencyPct = opts.contingencyPct ?? 0;
  const utilityPct = opts.utilityPct ?? 0;
  const vatMode = opts.vatMode ?? "none";
  const vatPct = vatMode === "none" ? 0 : (opts.vatPct ?? 0.19);
  const adminAmount = money(periodAmount * adminPct);
  const contingencyAmount = money(periodAmount * contingencyPct);
  const utilityAmount = money(periodAmount * utilityPct);
  const subtotalAmount = money(periodAmount + adminAmount + contingencyAmount + utilityAmount);
  const vatAmount = money((vatMode === "utility" ? utilityAmount : vatMode === "full" ? subtotalAmount : 0) * vatPct);
  const grossAmount = money(subtotalAmount + vatAmount);
  const retentionAmount = money(subtotalAmount * retentionPct);
  const advanceAmount = money(subtotalAmount * advancePct);
  const totals: CertificateTotals = {
    contractAmount,
    previousAmount: sum("previousAmount"),
    periodAmount,
    cumulativeAmount,
    balanceAmount: sum("balanceAmount"),
    retentionPct,
    retentionAmount,
    advancePct,
    advanceAmount,
    adminPct,
    adminAmount,
    contingencyPct,
    contingencyAmount,
    utilityPct,
    utilityAmount,
    subtotalAmount,
    vatMode,
    vatPct,
    vatAmount,
    grossAmount,
    netAmount: money(grossAmount - retentionAmount - advanceAmount),
    financialProgress: contractAmount > 0 ? cumulativeAmount / contractAmount : null,
  };
  return { lines, totals, missingPrice };
}
