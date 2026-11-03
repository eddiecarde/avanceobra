"use client";

import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface Zone {
  key: string;
  label: string;
  frontId: string | null;
  subfield: string | null;
}

interface PunchRow {
  id: string;
  description: string;
  status: string;
  activity_id: string | null;
  front_id: string | null;
  closed_at: string | null;
  verification_note: string | null;
}

interface Handover {
  id: string;
  scope: string;
  received_by_name: string;
  received_by_role: string | null;
  received_on: string;
  items: unknown[];
  created_at: string;
}

/**
 * Acta de entrega del punch list: por zona (frente o subcampo) se entrega al cliente cuando todos
 * sus punch están cerrados con su verificación y foto. Queda quién recibe, cuándo y su firma.
 */
export function PunchHandover({ projectId, canManage, today }: { projectId: string; canManage: boolean; today: string }) {
  const [data, setData] = useState<{
    zones: Zone[];
    acts: { id: string; code: string; name: string; front_id: string; subfield: string | null }[];
    punch: PunchRow[];
    photos: Record<string, string>;
    handovers: Handover[];
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [zoneKey, setZoneKey] = useState("all");
  const [form, setForm] = useState({ name: "", role: "", date: today, notes: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const pad = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    let off = false;
    void Promise.all([
      supabase.from("fronts").select("id, code, name").eq("project_id", projectId).order("code"),
      supabase.from("activities").select("id, code, name, front_id, subfield").eq("project_id", projectId),
      supabase.from("findings").select("id, description, status, activity_id, front_id, closed_at, verification_note").eq("project_id", projectId).eq("category", "punch"),
      supabase.from("punch_handovers").select("id, scope, received_by_name, received_by_role, received_on, items, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
    ]).then(async ([f, a, p, h]) => {
      const punch = (p.data ?? []) as PunchRow[];
      const ids = punch.map((x) => x.id);
      const ph = ids.length ? await supabase.from("photos").select("finding_id, storage_path").in("finding_id", ids).eq("purpose", "cierre") : { data: [] };
      if (off) return;
      const acts = (a.data ?? []) as { id: string; code: string; name: string; front_id: string; subfield: string | null }[];
      const subfields = [...new Set(acts.map((x) => x.subfield).filter(Boolean) as string[])].sort();
      setData({
        zones: [
          { key: "all", label: "Todo el proyecto", frontId: null, subfield: null },
          ...((f.data ?? []) as { id: string; code: string; name: string }[]).map((x) => ({ key: `f:${x.id}`, label: `${x.code} · ${x.name}`, frontId: x.id, subfield: null })),
          ...subfields.map((s) => ({ key: `s:${s}`, label: `Subcampo/zona ${s}`, frontId: null, subfield: s })),
        ],
        acts,
        punch,
        photos: Object.fromEntries(((ph.data ?? []) as { finding_id: string; storage_path: string }[]).map((x) => [x.finding_id, x.storage_path])),
        handovers: (h.data ?? []) as Handover[],
      });
    });
    return () => {
      off = true;
    };
  }, [projectId, version]);

  const zone = data?.zones.find((z) => z.key === zoneKey) ?? null;
  const inZone = useMemo(() => {
    if (!data || !zone) return [];
    const act = (id: string | null) => data.acts.find((a) => a.id === id);
    return data.punch.filter((f) => {
      if (!zone.frontId && !zone.subfield) return true;
      const a = act(f.activity_id);
      if (zone.frontId) return (a?.front_id ?? f.front_id) === zone.frontId;
      return a?.subfield === zone.subfield;
    });
  }, [data, zone]);
  const pending = inZone.filter((f) => f.status !== "closed");
  const closed = inZone.filter((f) => f.status === "closed");
  const noPhoto = closed.filter((f) => !data?.photos[f.id]);

  async function issue() {
    if (!data || !zone) return;
    if (form.name.trim().length < 3) return setMsg({ tone: "error", text: "Escribe el nombre de quien recibe." });
    if (!pad.current?.hasInk()) return setMsg({ tone: "error", text: "Falta la firma de quien recibe." });
    setBusy(true);
    setMsg(null);
    const id = crypto.randomUUID();
    const sigPath = `${projectId}/entregas/${id}.png`;
    const blob = await pad.current.toBlob();
    const up = await supabase.storage.from("photos").upload(sigPath, blob, { contentType: "image/png" });
    if (up.error) {
      setBusy(false);
      return setMsg({ tone: "error", text: `No se pudo guardar la firma: ${up.error.message}` });
    }
    const act = (aid: string | null) => data.acts.find((a) => a.id === aid);
    const { error } = await supabase.from("punch_handovers").insert({
      id,
      project_id: projectId,
      scope: zone.label,
      front_id: zone.frontId,
      subfield: zone.subfield,
      items: closed.map((f) => ({
        id: f.id,
        description: f.description,
        activity: act(f.activity_id) ? `${act(f.activity_id)!.code} · ${act(f.activity_id)!.name}` : null,
        closed_at: f.closed_at,
        verification_note: f.verification_note,
        photo_path: data.photos[f.id] ?? null,
      })),
      received_by_name: form.name.trim(),
      received_by_role: form.role.trim() || null,
      received_on: form.date,
      signature_path: sigPath,
      notes: form.notes.trim() || null,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: `Acta de entrega de ${zone.label} registrada con ${closed.length} punch.` });
    setForm({ name: "", role: "", date: today, notes: "" });
    pad.current.clear();
    setVersion((v) => v + 1);
  }

  if (!data) return <p className="text-zinc-500">Cargando…</p>;
  return (
    <>
      <Card>
        <h2 className="text-lg font-bold">Acta de entrega del punch list</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Se entrega una zona cuando todos sus punch están cerrados con la verificación y la foto de cierre. Quien recibe firma en pantalla.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Zona que se entrega" className="min-w-64">
            <Select value={zoneKey} onChange={(e) => setZoneKey(e.target.value)}>
              {data.zones.map((z) => (
                <option key={z.key} value={z.key}>
                  {z.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2 pb-2 text-sm">
            <Badge tone="green">{closed.length} cerrados</Badge>
            <Badge tone={pending.length ? "red" : "neutral"}>{pending.length} pendientes</Badge>
            {noPhoto.length ? <Badge tone="amber">{noPhoto.length} sin foto de cierre</Badge> : null}
          </div>
        </div>

        {inZone.length === 0 ? (
          <p className="mt-3 text-zinc-500">No hay punch en esta zona.</p>
        ) : pending.length ? (
          <div className="mt-3">
            <p className="font-semibold text-red-700 dark:text-red-400">Todavía no se puede entregar: faltan por cerrar</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {pending.map((f) => (
                <li key={f.id}>{f.description}</li>
              ))}
            </ul>
          </div>
        ) : canManage ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Recibe" hint="(nombre)">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="p. ej. Ing. Carolina Bustos" />
              </Field>
              <Field label="Cargo y empresa">
                <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="p. ej. Supervisora civil · Interventoría" />
              </Field>
              <Field label="Fecha de entrega">
                <Input type="date" value={form.date} max={today} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Observaciones" hint="(opcional)">
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <div>
              <div className="mb-1 text-xs font-bold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">Firma de quien recibe</div>
              <SignaturePad ref={pad} />
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => pad.current?.clear()}>
                  Borrar firma
                </Button>
                <Button variant="primary" className="ml-auto" disabled={busy} onClick={() => void issue()}>
                  {busy ? "Guardando…" : `Registrar entrega (${closed.length} punch)`}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">La entrega la registra el residente, el director o el administrador.</p>
        )}
        {msg ? <p className={cx("mt-2 font-semibold", msg.tone === "ok" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{msg.text}</p> : null}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Entregas registradas</h2>
        {data.handovers.length === 0 ? (
          <p className="text-zinc-500">Todavía no hay entregas.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.handovers.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="mr-auto">
                  <div className="font-semibold">{h.scope}</div>
                  <div className="text-sm text-zinc-500">
                    {h.received_on} · recibe {h.received_by_name}
                    {h.received_by_role ? ` (${h.received_by_role})` : ""} · {h.items.length} punch
                  </div>
                </div>
                <Link href={`/calidad/entrega?id=${h.id}`} className="font-semibold text-blue-700 hover:underline dark:text-blue-400">
                  Ver acta / PDF
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export interface SignaturePadHandle {
  clear: () => void;
  hasInk: () => boolean;
  toBlob: () => Promise<Blob>;
}


/** Recuadro para firmar con el dedo o el mouse. */
export const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_props, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef(false);
  useImperativeHandle(ref, () => ({
    clear: () => {
      const c = canvas.current!;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      ink.current = false;
    },
    hasInk: () => ink.current,
    toBlob: () => new Promise((res) => canvas.current!.toBlob((b) => res(b!), "image/png")),
  }));
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height] as const;
  };
  return (
    <canvas
      ref={canvas}
      width={600}
      height={200}
      aria-label="Recuadro de firma"
      className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-zinc-300 bg-white dark:border-zinc-700"
      onPointerDown={(e) => {
        drawing.current = true;
        const ctx = e.currentTarget.getContext("2d")!;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#0b2547";
        ctx.beginPath();
        ctx.moveTo(...point(e));
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const ctx = e.currentTarget.getContext("2d")!;
        ctx.lineTo(...point(e));
        ctx.stroke();
        ink.current = true;
      }}
      onPointerUp={() => (drawing.current = false)}
      onPointerLeave={() => (drawing.current = false)}
    />
  );
});
