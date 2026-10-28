"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import type { AiBox } from "@/lib/ai";
import { supabase } from "@/lib/supabase";

export interface EntryAiCheck {
  entry_id: string;
  status: "consistente" | "revisar" | "sin_evidencia" | "error";
  reported: number;
  sam_count: number | null;
  sam_concept: string | null;
  vision_count: number | null;
  matches_activity: boolean | null;
  comment: string;
  photos: { photo_id: string; width: number | null; height: number | null; boxes: AiBox[] }[];
  checked_at: string;
}

const LABEL: Record<EntryAiCheck["status"], string> = {
  consistente: "IA: consistente",
  revisar: "IA: revisar",
  sin_evidencia: "IA: sin evidencia",
  error: "IA: error",
};
const TONE: Record<EntryAiCheck["status"], "green" | "amber" | "red" | "neutral"> = { consistente: "green", revisar: "amber", sin_evidencia: "red", error: "neutral" };

export function AiCheckBadge({ check }: { check: EntryAiCheck }) {
  return <Badge tone={TONE[check.status]}>{LABEL[check.status]}</Badge>;
}

/** Foto con las cajas que marcó SAM 3.1 (en % para que escale con la imagen). */
export function BoxedPhoto({ src, width, height, boxes, alt }: { src: string; width: number; height: number; boxes: AiBox[]; alt: string }) {
  return (
    <div className="relative inline-block max-w-full overflow-hidden rounded-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block max-h-80 w-auto max-w-full" />
      {boxes.map((b, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none absolute rounded-sm border-2 border-rose-600"
          style={{ left: `${(b.x1 / width) * 100}%`, top: `${(b.y1 / height) * 100}%`, width: `${((b.x2 - b.x1) / width) * 100}%`, height: `${((b.y2 - b.y1) / height) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** Detalle de la verificación: qué contó SAM, qué vio Muse Spark y las fotos marcadas. */
export function AiCheckDetail({ check, unit }: { check: EntryAiCheck; unit: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = check.photos.map((p) => p.photo_id);
    if (!ids.length) return;
    let off = false;
    void supabase
      .from("photos")
      .select("id, storage_path")
      .in("id", ids)
      .then(async ({ data }) => {
        const out: Record<string, string> = {};
        for (const p of (data ?? []) as { id: string; storage_path: string }[]) {
          const { data: s } = await supabase.storage.from("photos").createSignedUrl(p.storage_path, 3600);
          if (s) out[p.id] = s.signedUrl;
        }
        if (!off) setUrls(out);
      });
    return () => {
      off = true;
    };
  }, [check]);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AiCheckBadge check={check} />
        <span>
          Reportado: <b>{check.reported.toLocaleString("es-CO")} {unit}</b>
        </span>
        {check.sam_count != null ? (
          <span>
            · SAM 3.1 contó <b>{check.sam_count}</b> ({check.sam_concept}) en la foto con más elementos
          </span>
        ) : null}
        {check.vision_count != null ? (
          <span>
            · Muse Spark ve unos <b>{check.vision_count}</b>
          </span>
        ) : null}
        {check.matches_activity === false ? <Badge tone="amber">La foto no parece de esta actividad</Badge> : null}
      </div>
      {check.comment ? <p className="text-zinc-700 dark:text-zinc-300">«{check.comment}»</p> : null}
      <div className="flex flex-wrap gap-2">
        {check.photos.map((p) =>
          urls[p.photo_id] && p.width && p.height ? (
            <BoxedPhoto key={p.photo_id} src={urls[p.photo_id]} width={p.width} height={p.height} boxes={p.boxes} alt={`Foto con ${p.boxes.length} elementos marcados`} />
          ) : null,
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Verificado el {new Date(check.checked_at).toLocaleString("es-CO")} con SAM 3.1 y Muse Spark (Meta). Una foto no muestra todo lo del día: es una ayuda para el residente, no
        reemplaza su criterio.
      </p>
    </div>
  );
}
