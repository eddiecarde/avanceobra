"use client";

import type { LonLat } from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { AnchorMap, type PlanOverlay } from "@/components/plans/AnchorMap";
import { Button, Card, Field, Select } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export interface ComparablePlan {
  id: string;
  label: string;
  storage_path: string;
  corners: [LonLat, LonLat, LonLat, LonLat];
}

type Corners = ComparablePlan["corners"];

const boundsOf = (cs: Corners[]): [LonLat, LonLat] => {
  const all = cs.flat();
  return [
    [Math.min(...all.map((c) => c[0])), Math.min(...all.map((c) => c[1]))],
    [Math.max(...all.map((c) => c[0])), Math.max(...all.map((c) => c[1]))],
  ];
};

/**
 * Compara dos planos sobre el satélite: el deslizador pasa de uno al otro y "Parpadear" los alterna
 * cada segundo, que es la forma más rápida de ver qué cambió entre el plano de una empresa y el de otra.
 */
export function ComparePlans({ plans, reference }: { plans: ComparablePlan[]; reference: GeoJSON.FeatureCollection }) {
  const [a, setA] = useState(plans[0]?.id ?? "");
  const [b, setB] = useState(plans[1]?.id ?? "");
  const [mix, setMix] = useState(0.5);
  const [blink, setBlink] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pa = plans.find((p) => p.id === a);
  const pb = plans.find((p) => p.id === b);

  // Enlaces firmados de los dos archivos (el bucket es privado)
  useEffect(() => {
    const need = [pa, pb].filter((p): p is ComparablePlan => !!p && !urls[p.id]);
    if (!need.length) return;
    void Promise.all(need.map((p) => supabase.storage.from("plans").createSignedUrl(p.storage_path, 3600).then((r) => [p.id, r.data?.signedUrl ?? ""] as const))).then((pairs) =>
      setUrls((u) => ({ ...u, ...Object.fromEntries(pairs.filter(([, url]) => url)) })),
    );
  }, [pa, pb, urls]);

  useEffect(() => {
    if (!blink) return;
    const t = setInterval(() => setMix((m) => (m < 0.5 ? 1 : 0)), 900);
    return () => clearInterval(t);
  }, [blink]);

  const overlays = useMemo<PlanOverlay[]>(() => {
    const out: PlanOverlay[] = [];
    if (pa && urls[pa.id]) out.push({ id: `a-${pa.id}`, url: urls[pa.id]!, corners: pa.corners, opacity: 1 - mix });
    if (pb && urls[pb.id] && pb.id !== pa?.id) out.push({ id: `b-${pb.id}`, url: urls[pb.id]!, corners: pb.corners, opacity: mix });
    return out;
  }, [pa, pb, urls, mix]);
  const focus = useMemo(() => (pa || pb ? boundsOf([pa, pb].filter((p): p is ComparablePlan => !!p).map((p) => p.corners)) : null), [pa, pb]);

  return (
    <Card>
      <h2 className="text-lg font-bold">Comparar planos</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Superpone dos planos sobre el satélite para ver en qué difieren, por ejemplo el del diseño y el de una empresa.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Plano A" className="min-w-56 flex-1">
          <Select value={a} onChange={(e) => setA(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plano B" className="min-w-56 flex-1">
          <Select value={b} onChange={(e) => setB(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => setBlink((x) => !x)} aria-pressed={blink}>
          {blink ? "Detener" : "Parpadear"}
        </Button>
      </div>
      <label className="mb-2 flex items-center gap-3 text-sm font-semibold">
        <span className="w-40 truncate text-right">{pa?.label ?? "A"}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={mix}
          onChange={(e) => {
            setBlink(false);
            setMix(Number(e.target.value));
          }}
          className="flex-1 accent-blue-700"
          aria-label="Mezcla entre el plano A y el B"
        />
        <span className="w-40 truncate">{pb?.label ?? "B"}</span>
      </label>
      <AnchorMap points={[]} reference={reference} overlays={overlays} focus={focus} onPick={() => undefined} />
    </Card>
  );
}
