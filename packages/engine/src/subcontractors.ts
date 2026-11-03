/**
 * Desempeño de cada subcontratista: plazo (avance contra lo programado, en dinero), plata
 * (ejecutado, facturado, por facturar y retenido), cumplimiento del plan semanal (PPC) y calidad
 * (no conformidades abiertas, vencidas y días para cerrarlas). Con un semáforo y lo que lo explica.
 */
import { addDays, workdayCounter, type ISODate, type WorkCalendar } from "./calendar.js";

export interface SubActivity {
  id: string;
  companyId: string | null;
  contractQty: number;
  /** Precio unitario del subcontrato; null = sin precio (cuenta en cantidades, no en dinero). */
  unitPrice: number | null;
  plannedStart: ISODate | null;
  plannedFinish: ISODate | null;
}

export interface SubCertificate {
  companyId: string;
  number: number;
  periodEnd: ISODate;
  cumulativeAmount: number;
  retentionAmount: number;
}

export interface SubFinding {
  companyId: string | null;
  category: string;
  status: string;
  dueDate: ISODate | null;
  createdAt: ISODate;
  closedAt: ISODate | null;
}

export interface SubPlanItem {
  companyId: string | null;
  weekStart: ISODate;
  /** Cumplido al cerrar la semana (null = la semana no se ha cerrado). */
  done: boolean | null;
}

export interface SubcontractorScore {
  companyId: string;
  activities: number;
  priced: number;
  contractValue: number;
  /** Valor de lo aprobado a la fecha (cantidad aprobada × precio). */
  executedValue: number;
  plannedValue: number;
  /** Avance físico en dinero: ejecutado ÷ valor del contrato. */
  progress: number | null;
  spi: number | null;
  /** Acumulado de la última acta vigente y retención sumada de todas. */
  billed: number;
  toBill: number;
  retained: number;
  lastCertificate: number | null;
  /** Plan semanal de las últimas 4 semanas cerradas: cumplidas ÷ comprometidas. */
  ppc: number | null;
  planItems: number;
  ncOpen: number;
  ncOverdue: number;
  /** Promedio de días entre reportar y cerrar una no conformidad o punch (las cerradas). */
  ncCloseDays: number | null;
  status: "green" | "amber" | "red";
  reasons: string[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const days = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export function subcontractorScores(input: {
  companyIds: string[];
  activities: SubActivity[];
  approved: { activityId: string; date: ISODate; quantity: number }[];
  certificates: SubCertificate[];
  findings: SubFinding[];
  planItems: SubPlanItem[];
  cutoff: ISODate;
  calendar?: WorkCalendar;
}): SubcontractorScore[] {
  const { cutoff } = input;
  const dated = input.activities.filter((a) => a.plannedStart && a.plannedFinish);
  const first = dated.reduce<ISODate>((m, a) => (a.plannedStart! < m ? a.plannedStart! : m), cutoff);
  const last = dated.reduce<ISODate>((m, a) => (a.plannedFinish! > m ? a.plannedFinish! : m), cutoff);
  const count = workdayCounter(input.calendar ?? {}, first, last);
  const plannedQty = (a: SubActivity) => {
    if (!a.plannedStart || !a.plannedFinish || cutoff < a.plannedStart) return 0;
    if (cutoff >= a.plannedFinish) return a.contractQty;
    const total = count(a.plannedStart, a.plannedFinish);
    return total > 0 ? (a.contractQty * count(a.plannedStart, cutoff)) / total : a.contractQty;
  };
  const approvedQty = new Map<string, number>();
  for (const e of input.approved) if (e.date <= cutoff) approvedQty.set(e.activityId, (approvedQty.get(e.activityId) ?? 0) + e.quantity);
  const fourWeeksAgo = addDays(cutoff, -28);

  return input.companyIds.map((companyId) => {
    const acts = input.activities.filter((a) => a.companyId === companyId);
    const priced = acts.filter((a) => a.unitPrice != null && a.unitPrice > 0);
    const value = (q: (a: SubActivity) => number) => priced.reduce((t, a) => t + q(a) * a.unitPrice!, 0);
    const contractValue = value((a) => a.contractQty);
    const executedValue = value((a) => approvedQty.get(a.id) ?? 0);
    const plannedValue = value(plannedQty);

    const certs = input.certificates.filter((c) => c.companyId === companyId && c.periodEnd <= cutoff).sort((a, b) => b.number - a.number);
    const billed = certs[0]?.cumulativeAmount ?? 0;
    const retained = certs.reduce((t, c) => t + c.retentionAmount, 0);

    const items = input.planItems.filter((i) => i.companyId === companyId && i.done != null && i.weekStart >= fourWeeksAgo && i.weekStart <= cutoff);
    const ppc = ratio(items.filter((i) => i.done).length, items.length);

    const nc = input.findings.filter((f) => f.companyId === companyId && (f.category === "no_conformidad" || f.category === "punch"));
    const open = nc.filter((f) => f.status !== "closed");
    const overdue = open.filter((f) => f.dueDate != null && f.dueDate < cutoff);
    const closed = nc.filter((f) => f.status === "closed" && f.closedAt);
    const ncCloseDays = closed.length ? closed.reduce((t, f) => t + days(f.createdAt, f.closedAt!), 0) / closed.length : null;

    const spi = ratio(executedValue, plannedValue);
    const reasons: string[] = [];
    let red = false;
    let amber = false;
    if (spi != null && spi < 0.85) (red = true), reasons.push(`Atrasado: ejecutó ${Math.round(spi * 100)} % de lo programado a la fecha.`);
    else if (spi != null && spi < 0.95) (amber = true), reasons.push(`Algo atrasado: ${Math.round(spi * 100)} % de lo programado.`);
    if (overdue.length >= 3) (red = true), reasons.push(`${overdue.length} no conformidades vencidas sin cerrar.`);
    else if (overdue.length > 0) (amber = true), reasons.push(`${overdue.length} no conformidad(es) vencida(s).`);
    if (ppc != null && ppc < 0.6) (red = true), reasons.push(`Cumple solo el ${Math.round(ppc * 100)} % de lo que compromete en el plan semanal.`);
    else if (ppc != null && ppc < 0.8) (amber = true), reasons.push(`Plan semanal cumplido al ${Math.round(ppc * 100)} %.`);
    const toBill = Math.max(0, executedValue - billed);
    if (contractValue > 0 && toBill > contractValue * 0.1) (amber = true), reasons.push("Tiene más del 10 % del contrato ejecutado y aprobado sin facturar.");
    if (priced.length < acts.length) reasons.push(`${acts.length - priced.length} actividad(es) sin precio de subcontrato: no entran en los valores.`);

    return {
      companyId,
      activities: acts.length,
      priced: priced.length,
      contractValue,
      executedValue,
      plannedValue,
      progress: ratio(executedValue, contractValue),
      spi,
      billed,
      toBill,
      retained,
      lastCertificate: certs[0]?.number ?? null,
      ppc,
      planItems: items.length,
      ncOpen: open.length,
      ncOverdue: overdue.length,
      ncCloseDays,
      status: red ? "red" : amber ? "amber" : "green",
      reasons,
    };
  });
}
