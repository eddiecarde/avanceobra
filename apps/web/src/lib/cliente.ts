"use client";

import type { SettlementTotals } from "@avanceobra/engine";
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

export interface ClientChangeOrder {
  id: string;
  number: number;
  title: string;
  description: string | null;
  reason: string;
  days_extension: number;
  status: "enviada" | "aprobada" | "rechazada";
  amount: number | null;
  decided_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  items: { activity: string; unit: string; delta_qty: number; new_unit_price: number | null; is_new: boolean }[];
}

export interface ClientView {
  dash: DashData;
  header: ProjectHeader;
  certificates: ClientCertificate[];
  handovers: Handover[];
  changeOrders: ClientChangeOrder[];
  settlement: { id: string; totals: SettlementTotals; notes: string | null; issued_at: string } | null;
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
  const raw = data as Omit<RawDash, "resources"> & {
    header: ProjectHeader;
    certificates: ClientCertificate[];
    handovers: Handover[];
    change_orders?: ClientChangeOrder[];
    settlement?: ClientView["settlement"];
  };
  return {
    dash: buildDashData({ ...raw, resources: [] }, null),
    header: raw.header,
    certificates: raw.certificates,
    handovers: raw.handovers,
    changeOrders: raw.change_orders ?? [],
    settlement: raw.settlement ?? null,
  };
}

export async function decideChangeOrder(id: string, approve: boolean, note: string) {
  const { error } = await supabase.rpc("client_decide_change_order", { p_id: id, p_approve: approve, p_note: note });
  if (error) throw new Error(error.message);
}

export async function decideCertificate(id: string, decision: "aprobada" | "observada", note: string) {
  const { error } = await supabase.rpc("client_decide_certificate", { p_id: id, p_decision: decision, p_note: note });
  if (error) throw new Error(error.message);
}
