"use client";

import type { Certificate, ProjectHeader } from "./actas";
import { buildDashData, type DashData, type RawDash } from "./dashboard";
import { supabase } from "./supabase";

export interface ClientProject {
  id: string;
  name: string;
  client_name: string | null;
  contractor_name: string | null;
}

export type ClientCertificate = Omit<Certificate, "company_id" | "retention_pct" | "advance_pct"> & {
  client_status: "pendiente" | "aprobada" | "observada";
  client_note: string | null;
  client_decided_name: string | null;
  client_decided_at: string | null;
};

export interface Handover {
  id: string;
  scope: string;
  subfield: string | null;
  items: { description?: string; category?: string; closed_at?: string | null }[];
  received_by_name: string;
  received_by_role: string | null;
  received_on: string;
  notes: string | null;
}

export interface ClientView {
  dash: DashData;
  header: ProjectHeader;
  certificates: ClientCertificate[];
  handovers: Handover[];
}

export const CLIENT_STATUS: Record<ClientCertificate["client_status"], { label: string; tone: "amber" | "green" | "red" }> = {
  pendiente: { label: "Por revisar", tone: "amber" },
  aprobada: { label: "Aprobada", tone: "green" },
  observada: { label: "Con observaciones", tone: "red" },
};

/** Obras donde el usuario es cliente (no miembro del equipo). */
export async function loadClientProjects(): Promise<ClientProject[]> {
  const { data, error } = await supabase.rpc("client_projects");
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientProject[];
}

/** Lo que ve el cliente: avance (sin costos ni notas), actas al cliente y entregas del punch list. */
export async function loadClientView(projectId: string): Promise<ClientView> {
  const { data, error } = await supabase.rpc("client_project", { p_project: projectId });
  if (error) throw new Error(error.message);
  const raw = data as Omit<RawDash, "resources"> & { header: ProjectHeader; certificates: ClientCertificate[]; handovers: Handover[] };
  return { dash: buildDashData({ ...raw, resources: [] }, null), header: raw.header, certificates: raw.certificates, handovers: raw.handovers };
}

export async function decideCertificate(id: string, decision: "aprobada" | "observada", note: string) {
  const { error } = await supabase.rpc("client_decide_certificate", { p_id: id, p_decision: decision, p_note: note });
  if (error) throw new Error(error.message);
}
