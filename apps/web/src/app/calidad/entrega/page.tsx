"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface Item {
  id: string;
  description: string;
  activity: string | null;
  closed_at: string | null;
  verification_note: string | null;
  photo_path: string | null;
}

interface Handover {
  id: string;
  project_id: string;
  scope: string;
  items: Item[];
  received_by_name: string;
  received_by_role: string | null;
  received_on: string;
  signature_path: string | null;
  notes: string | null;
  created_at: string;
}

export default function EntregaPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Entrega />
    </Suspense>
  );
}

/** Acta de entrega del punch list lista para imprimir o guardar en PDF, con fotos de cierre y firma. */
function Entrega() {
  const id = useSearchParams().get("id") ?? "";
  const [state, setState] = useState<{ h: Handover; project: { name: string; client_name: string | null; contractor_name: string | null; contract_code: string | null }; urls: Record<string, string> } | { error: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const { data, error } = await supabase.from("punch_handovers").select("*").eq("id", id).single();
      if (error || !data) return setState({ error: error?.message ?? "No se encontró el acta." });
      const h = data as Handover;
      const { data: p } = await supabase.from("projects").select("name, client_name, contractor_name, contract_code").eq("id", h.project_id).single();
      const paths = [...h.items.map((i) => i.photo_path), h.signature_path].filter(Boolean) as string[];
      const signed = paths.length ? await supabase.storage.from("photos").createSignedUrls(paths, 3600) : { data: [] };
      const urls = Object.fromEntries((signed.data ?? []).flatMap((s, i) => (s?.signedUrl ? [[paths[i]!, s.signedUrl]] : [])));
      setState({ h, project: p as { name: string; client_name: string | null; contractor_name: string | null; contract_code: string | null }, urls });
    })();
  }, [id]);

  if (!state) return <p className="text-zinc-500">Cargando acta…</p>;
  if ("error" in state) return <p className="text-red-700">{state.error}</p>;
  const { h, project, urls } = state;
  return (
    <div className="mx-auto max-w-[1000px] space-y-4 bg-white p-2 text-black print:p-0">
      <div className="no-print flex gap-2">
        <Link href="/calidad" className="rounded-lg px-3 py-2 font-semibold text-blue-700 hover:underline">
          ← Calidad
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          Imprimir / guardar PDF
        </Button>
      </div>
      <header className="border-b-2 border-black pb-2">
        <h1 className="text-xl font-extrabold">ACTA DE ENTREGA DE PUNCH LIST</h1>
        <div className="grid grid-cols-2 gap-x-6 text-sm">
          <div>
            <b>Proyecto:</b> {project.name}
          </div>
          <div>
            <b>Contrato:</b> {project.contract_code ?? "—"}
          </div>
          <div>
            <b>Zona entregada:</b> {h.scope}
          </div>
          <div>
            <b>Fecha de entrega:</b> {h.received_on}
          </div>
          <div>
            <b>Entrega:</b> {project.contractor_name ?? "Contratista"}
          </div>
          <div>
            <b>Recibe:</b> {h.received_by_name}
            {h.received_by_role ? ` · ${h.received_by_role}` : ""}
          </div>
        </div>
      </header>
      <p className="text-sm">
        Se entregan {h.items.length} pendiente(s) del punch list de la zona, cerrados y verificados en obra, con la evidencia fotográfica de cómo quedaron.
      </p>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-200">
            {["#", "Pendiente", "Actividad", "Cerrado", "Verificación", "Foto de cierre"].map((c) => (
              <th key={c} className="border border-zinc-400 px-1 py-1 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {h.items.map((i, n) => (
            <tr key={i.id} className="break-inside-avoid align-top">
              <td className="border border-zinc-300 px-1">{n + 1}</td>
              <td className="border border-zinc-300 px-1">{i.description}</td>
              <td className="border border-zinc-300 px-1">{i.activity ?? "—"}</td>
              <td className="border border-zinc-300 px-1 whitespace-nowrap">{i.closed_at?.slice(0, 10) ?? "—"}</td>
              <td className="border border-zinc-300 px-1">{i.verification_note ?? "—"}</td>
              <td className="border border-zinc-300 p-1">
                {i.photo_path && urls[i.photo_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[i.photo_path]} alt={`Foto de cierre: ${i.description}`} className="h-24 w-32 object-cover" />
                ) : (
                  "sin foto"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {h.notes ? (
        <p className="text-sm">
          <b>Observaciones:</b> {h.notes}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-10 pt-8 text-center text-sm">
        <div>
          <div className="h-24" />
          <div className="border-t border-black pt-1">Entrega · {project.contractor_name ?? "Contratista"}</div>
        </div>
        <div>
          <div className="flex h-24 items-end justify-center">
            {h.signature_path && urls[h.signature_path] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[h.signature_path]} alt={`Firma de ${h.received_by_name}`} className="max-h-24" />
            ) : null}
          </div>
          <div className="border-t border-black pt-1">
            Recibe · {h.received_by_name}
            {h.received_by_role ? ` · ${h.received_by_role}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
