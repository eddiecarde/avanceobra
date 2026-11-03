"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cop, qty, totalsRows, type Certificate, type ProjectHeader } from "@/lib/actas";
import { projectLogo } from "@/lib/logo";
import { supabase } from "@/lib/supabase";

export default function VerActaPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <VerActa />
    </Suspense>
  );
}

/** Acta lista para imprimir o guardar en PDF (Imprimir → Guardar como PDF). */
function VerActa() {
  const id = useSearchParams().get("id") ?? "";
  const [state, setState] = useState<{ cert: Certificate; project: ProjectHeader; target: string } | { error: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const { data: c, error } = await supabase.from("payment_certificates").select("*").eq("id", id).single();
      if (error || !c) return setState({ error: error?.message ?? "No se encontró el acta." });
      const cert = c as Certificate & { project_id: string };
      const [{ data: p }, company] = await Promise.all([
        supabase.from("projects").select("name, client_name, contractor_name, contract_code, report_signers, start_date, logo_path, org:organizations(logo_path)").eq("id", cert.project_id).single(),
        cert.company_id ? supabase.from("project_companies").select("name").eq("id", cert.company_id).single() : Promise.resolve({ data: null }),
      ]);
      const project = p as ProjectHeader;
      setState({ cert, project, target: (company.data as { name: string } | null)?.name ?? project.client_name ?? "Cliente" });
    })();
  }, [id]);

  if (!state) return <p className="text-zinc-500">Cargando acta…</p>;
  if ("error" in state) return <p className="text-red-700">{state.error}</p>;
  const { cert, project, target } = state;
  const logo = projectLogo(project as ProjectHeader & { logo_path?: string | null; org?: unknown });
  const t = cert.totals;
  const signers = project.report_signers?.length ? project.report_signers : ["Elaboró", "Revisó", "Aprobó"];

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 bg-white p-2 text-black print:p-0">
      <div className="no-print flex gap-2">
        <Link href="/actas" className="rounded-lg px-3 py-2 font-semibold text-blue-700 hover:underline">
          ← Actas
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          Imprimir / guardar PDF
        </Button>
      </div>
      <header className="border-b-2 border-black pb-2">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="Logo de la empresa" className="float-right h-12 w-auto max-w-[180px] object-contain" />
        ) : null}
        <h1 className="text-xl font-extrabold">
          ACTA DE CORTE N° {cert.number}
          {cert.status === "anulada" ? " — ANULADA" : ""}
        </h1>
        <div className="grid grid-cols-2 gap-x-6 text-sm">
          <div>
            <b>Proyecto:</b> {project.name}
          </div>
          <div>
            <b>Contrato:</b> {project.contract_code ?? "—"}
          </div>
          <div>
            <b>{cert.company_id ? "Subcontratista" : "Cliente"}:</b> {target}
          </div>
          <div>
            <b>Contratista:</b> {project.contractor_name ?? "—"}
          </div>
          <div>
            <b>Periodo:</b> {cert.period_start} a {cert.period_end}
          </div>
          <div>
            <b>Emitida:</b> {cert.issued_at.slice(0, 10)}
          </div>
        </div>
        {cert.status === "anulada" ? <p className="mt-1 text-sm font-semibold">Motivo de anulación: {cert.void_reason}</p> : null}
      </header>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-zinc-200">
            {["Código", "Ítem", "Und", "Precio", "Cant. contrato", "Anterior", "Periodo", "Acumulado", "Valor periodo", "Valor acumulado", "Saldo"].map((h) => (
              <th key={h} className="border border-zinc-400 px-1 py-1 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cert.lines
            .filter((l) => Math.abs(l.periodQty) > 1e-9 || l.cumulativeQty > 0)
            .map((l) => (
              <tr key={l.id}>
                <td className="border border-zinc-300 px-1">{l.code}</td>
                <td className="border border-zinc-300 px-1">{l.name}</td>
                <td className="border border-zinc-300 px-1">{l.unit}</td>
                <td className="border border-zinc-300 px-1 text-right tabular-nums">{cop(l.unitPrice)}</td>
                <td className="border border-zinc-300 px-1 text-right tabular-nums">{qty(l.contractQty)}</td>
                <td className="border border-zinc-300 px-1 text-right tabular-nums">{qty(l.previousQty)}</td>
                <td className="border border-zinc-300 px-1 text-right font-semibold tabular-nums">{qty(l.periodQty)}</td>
                <td className="border border-zinc-300 px-1 text-right tabular-nums">{qty(l.cumulativeQty)}</td>
                <td className="border border-zinc-300 px-1 text-right font-semibold tabular-nums">{cop(l.periodAmount)}</td>
                <td className="border border-zinc-300 px-1 text-right tabular-nums">{cop(l.cumulativeAmount)}</td>
                <td className="border border-zinc-300 px-1 text-right tabular-nums">{cop(l.balanceAmount)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <table className="ml-auto text-sm">
        <tbody>
          {totalsRows(t).map(([label, v]) => (
            <tr key={label} className={label === "NETO A PAGAR" ? "border-y-2 border-black font-extrabold" : ""}>
              <td className="pr-6 py-0.5">{label}</td>
              <td className="text-right tabular-nums">{cop(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cert.notes ? (
        <p className="text-sm">
          <b>Observaciones:</b> {cert.notes}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-8 pt-16 text-center text-sm">
        {signers.map((s) => (
          <div key={s} className="border-t border-black pt-1">
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
