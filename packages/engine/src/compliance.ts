/**
 * Seguridad social y SST al día: documentos de la empresa (planilla PILA del mes, ARL, póliza…)
 * y de cada trabajador (ARL, EPS, examen médico, inducción, curso de alturas…), con su vencimiento.
 * Un trabajador está habilitado si tiene vigentes todos los obligatorios; "por vencer" si alguno
 * vence en los próximos días; bloqueado si falta o venció alguno.
 */
import { addDays, type ISODate } from "./calendar.js";

export const COMPANY_DOCS = {
  pila: "Planilla de seguridad social (PILA)",
  arl_empresa: "Afiliación ARL de la empresa",
  poliza: "Póliza",
  sg_sst: "SG-SST (estándares mínimos)",
  camara_comercio: "Cámara de comercio",
} as const;

export const WORKER_DOCS = {
  arl: "Afiliación ARL",
  eps: "Afiliación EPS",
  pension: "Afiliación a pensión",
  examen_medico: "Examen médico ocupacional",
  induccion: "Inducción SST de la obra",
  alturas: "Curso de trabajo seguro en alturas",
  espacios_confinados: "Curso de espacios confinados",
  licencia: "Licencia de conducción",
  certificado_operador: "Certificado de operador de equipo",
} as const;

export type CompanyDocType = keyof typeof COMPANY_DOCS;
export type WorkerDocType = keyof typeof WORKER_DOCS;
export type DocType = CompanyDocType | WorkerDocType;

/** Obligatorios: los de la empresa y los de todo trabajador (más alturas si trabaja en alturas). */
export const REQUIRED_COMPANY_DOCS: CompanyDocType[] = ["pila"];
export const REQUIRED_WORKER_DOCS: WorkerDocType[] = ["arl", "eps", "examen_medico", "induccion"];

export interface ComplianceDoc {
  docType: string;
  /** Sin fecha de vencimiento = vigente (p. ej. una afiliación). */
  expiresOn: ISODate | null;
}

export type DocState = "ok" | "soon" | "expired";
export type ComplianceStatus = "ok" | "soon" | "blocked";

export interface ComplianceResult {
  status: ComplianceStatus;
  /** Obligatorios que no tienen ningún documento. */
  missing: string[];
  /** Obligatorios cuyo documento más reciente ya venció. */
  expired: string[];
  /** Obligatorios que vencen pronto, con su fecha. */
  soon: { docType: string; expiresOn: ISODate }[];
}

/** Estado de un documento según su vencimiento (soonDays = días de aviso). */
export function docState(expiresOn: ISODate | null, today: ISODate, soonDays = 15): DocState {
  if (!expiresOn) return "ok";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, soonDays) ? "soon" : "ok";
}

/** Vigencia de cada tipo: el documento que vence más tarde (sin fecha = sin vencimiento). */
function latestByType(docs: ComplianceDoc[]): Map<string, ISODate | null> {
  const out = new Map<string, ISODate | null>();
  for (const d of docs) {
    if (!out.has(d.docType)) out.set(d.docType, d.expiresOn);
    else {
      const prev = out.get(d.docType)!;
      if (prev !== null && (d.expiresOn === null || d.expiresOn > prev)) out.set(d.docType, d.expiresOn);
    }
  }
  return out;
}

function evaluate(required: string[], docs: ComplianceDoc[], today: ISODate, soonDays: number): ComplianceResult {
  const latest = latestByType(docs);
  const missing = required.filter((t) => !latest.has(t));
  const expired = required.filter((t) => latest.has(t) && docState(latest.get(t)!, today, soonDays) === "expired");
  const soon = required
    .filter((t) => latest.has(t) && docState(latest.get(t)!, today, soonDays) === "soon")
    .map((t) => ({ docType: t, expiresOn: latest.get(t)! }));
  return { status: missing.length || expired.length ? "blocked" : soon.length ? "soon" : "ok", missing, expired, soon };
}

export function workerCompliance(worker: { worksAtHeight: boolean }, docs: ComplianceDoc[], today: ISODate, soonDays = 15): ComplianceResult {
  const required: string[] = [...REQUIRED_WORKER_DOCS, ...(worker.worksAtHeight ? (["alturas"] as const) : [])];
  return evaluate(required, docs, today, soonDays);
}

export function companyCompliance(docs: ComplianceDoc[], today: ISODate, soonDays = 15): ComplianceResult {
  return evaluate(REQUIRED_COMPANY_DOCS, docs, today, soonDays);
}

export const docLabel = (t: string) => (COMPANY_DOCS as Record<string, string>)[t] ?? (WORKER_DOCS as Record<string, string>)[t] ?? t;
