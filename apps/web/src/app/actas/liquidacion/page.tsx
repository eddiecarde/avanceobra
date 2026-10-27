"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cop, settlementRows, type ProjectHeader, type Settlement } from "@/lib/actas";
import { supabase } from "@/lib/supabase";

export default function LiquidacionPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Liquidacion />
    </Suspense>
  );
}

/** Acta de liquidación lista para imprimir o guardar en PDF. */
function Liquidacion() {
  const id = useSearchParams().get("id") ?? "";
  const [state, setState] = useState<{ s: Settlement; project: ProjectHeader; target: string } | { error: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const { data, error } = await supabase.from("settlements").select("*").eq("id", id).single();
      if (error || !data) return setState({ error: error?.message ?? "No se encontró la liquidación." });
      const s = data as Settlement & { project_id: string };
      const [{ data: p }, company] = await Promise.all([
        supabase.from("projects").select("name, client_name, contractor_name, contract_code, report_signers, start_date").eq("id", s.project_id).single(),
        s.company_id ? supabase.from("project_companies").select("name").eq("id", s.company_id).single() : Promise.resolve({ data: null }),
      ]);
      const project = p as ProjectHeader;
      setState({ s, project, target: (company.data as { name: string } | null)?.name ?? project.client_name ?? "Cliente" });
    })();
  }, [id]);

  if (!state) return <p className="text-zinc-500">Cargando liquidación…</p>;
  if ("error" in state) return <p className="text-red-700">{state.error}</p>;
  const { s, project, target } = state;
  const signers = project.report_signers?.length ? project.report_signers : ["Contratista", "Interventoría", "Cliente"];

  return (
    <div className="mx-auto max-w-[900px] space-y-4 bg-white p-2 text-black print:p-0">
      <div className="no-print flex gap-2">
        <Link href="/actas" className="rounded-lg px-3 py-2 font-semibold text-blue-700 hover:underline">
          ← Actas
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          Imprimir / guardar PDF
        </Button>
      </div>
      <header className="border-b-2 border-black pb-2">
        <h1 className="text-xl font-extrabold">
          ACTA DE LIQUIDACIÓN FINAL
          {s.status === "anulada" ? " — ANULADA" : ""}
        </h1>
        <div className="grid grid-cols-2 gap-x-6 text-sm">
          <div>
            <b>Proyecto:</b> {project.name}
          </div>
          <div>
            <b>Contrato:</b> {project.contract_code ?? "—"}
          </div>
          <div>
            <b>{s.company_id ? "Subcontratista" : "Cliente"}:</b> {target}
          </div>
          <div>
            <b>Contratista:</b> {project.contractor_name ?? "—"}
          </div>
          <div>
            <b>Emitida:</b> {s.issued_at.slice(0, 10)}
          </div>
        </div>
        {s.status === "anulada" ? <p className="mt-1 text-sm font-semibold">Motivo de anulación: {s.void_reason}</p> : null}
      </header>
      <table className="w-full text-sm">
        <tbody>
          {settlementRows(s.totals).map(([label, v, strong]) => (
            <tr key={label} className={strong ? "border-y-2 border-black font-extrabold" : "border-b border-zinc-300"}>
              <td className="py-1 pr-6">{label}</td>
              <td className="text-right tabular-nums">{cop(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.notes ? (
        <p className="text-sm">
          <b>Observaciones:</b> {s.notes}
        </p>
      ) : null}
      <p className="text-sm">
        Las partes declaran recibido el objeto del contrato en los términos anteriores y quedan a paz y salvo por todo concepto una vez se pague el saldo indicado.
      </p>
      <div className="grid grid-cols-3 gap-8 pt-16 text-center text-sm">
        {signers.map((x) => (
          <div key={x} className="border-t border-black pt-1">
            {x}
          </div>
        ))}
      </div>
    </div>
  );
}
