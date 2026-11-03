"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface ShareLink {
  id: string;
  token: string;
  label: string;
  include_findings: boolean;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

const fmt = (t: string) => new Date(t).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
export const shareUrl = (token: string) => `${window.location.origin}/ver?t=${token}`;

/** Enlaces de solo lectura del dashboard: crear (con vencimiento), copiar y revocar. Solo admin y director. */
export function ShareLinks({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<{ projectId: string; rows: ShareLink[]; at: number } | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("30");
  const [includeFindings, setIncludeFindings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Recarga la lista al cambiar de proyecto o después de crear o revocar
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);
  useEffect(() => {
    let off = false;
    supabase
      .from("share_links")
      .select("id, token, label, include_findings, created_by_name, created_at, expires_at, revoked_at, view_count, last_viewed_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (off) return;
        if (error) setMsg({ tone: "error", text: error.message });
        setLinks({ projectId, rows: (data ?? []) as ShareLink[], at: Date.now() });
      });
    return () => {
      off = true;
    };
  }, [projectId, version]);

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setMsg({ tone: "ok", text: "Enlace copiado. Pégalo en el correo o WhatsApp de quien lo va a ver." });
    } catch {
      setMsg({ tone: "error", text: `No se pudo copiar automáticamente: ${shareUrl(token)}` });
    }
  }

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    setMsg(null);
    const expires = new Date(Date.now() + Number(days) * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("share_links")
      .insert({ project_id: projectId, label: label.trim(), expires_at: expires, include_findings: includeFindings })
      .select("token")
      .single();
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setLabel("");
    load();
    await copy(data.token);
  }

  async function revoke(l: ShareLink) {
    if (!window.confirm(`¿Revocar el enlace "${l.label}"? Quien lo tenga dejará de ver el dashboard.`)) return;
    const { error } = await supabase.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", l.id);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: `Enlace "${l.label}" revocado.` });
    load();
  }

  const rows = links?.projectId === projectId ? links.rows : [];
  // Hora de la última carga: decide si un enlace ya venció
  const now = links?.at ?? 0;

  return (
    <Card>
      <h2 className="text-lg font-bold">Compartir el dashboard (solo lectura)</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Para el cliente o la interventoría, sin crear usuario. Ve avance, curva S, semáforos, Pareto de horas y plano. No ve costos, notas de campo, fotos ni nombres.
        Todo enlace vence y se puede revocar.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Para quién" className="min-w-56 flex-1">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="p. ej. Interventoría Consorcio XYZ" maxLength={120} />
        </Field>
        <Field label="Vence en">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="180">6 meses</option>
            <option value="365">1 año</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 pb-2.5 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={includeFindings} onChange={(e) => setIncludeFindings(e.target.checked)} />
          Incluir hallazgos
        </label>
        <Button variant="primary" disabled={busy || !label.trim()} onClick={() => void create()}>
          Crear y copiar enlace
        </Button>
      </div>
      {msg ? <p className={msg.tone === "ok" ? "mt-2 font-semibold text-green-700 dark:text-green-400" : "mt-2 font-semibold text-red-700 dark:text-red-400"}>{msg.text}</p> : null}
      {rows.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-2">Para quién</th>
                <th className="pr-2">Estado</th>
                <th className="pr-2">Vence</th>
                <th className="pr-2 text-right">Visitas</th>
                <th className="pr-2">Creado por</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const active = !l.revoked_at && new Date(l.expires_at).getTime() > now;
                return (
                  <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-2 font-semibold">
                      {l.label}
                      {!l.include_findings ? <span className="ml-1 font-normal text-zinc-500">(sin hallazgos)</span> : null}
                    </td>
                    <td className="pr-2">
                      {l.revoked_at ? <Badge tone="red">Revocado</Badge> : active ? <Badge tone="green">Activo</Badge> : <Badge>Vencido</Badge>}
                    </td>
                    <td className="pr-2 tabular-nums">{fmt(l.expires_at)}</td>
                    <td className="pr-2 text-right tabular-nums">
                      {l.view_count}
                      {l.last_viewed_at ? <div className="text-xs text-zinc-500">última {fmt(l.last_viewed_at)}</div> : null}
                    </td>
                    <td className="pr-2">{l.created_by_name ?? "—"}</td>
                    <td className="py-2 text-right">
                      {active ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" onClick={() => void copy(l.token)}>
                            Copiar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void revoke(l)}>
                            Revocar
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
