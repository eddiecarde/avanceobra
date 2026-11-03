"use client";

import { centroid, codeElements, mapGeometry, parseDxf, toEwkt, type DxfDrawing, type DxfGeometry, type XY } from "@avanceobra/importers";
import type { LonLat } from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { AnchorMap } from "@/components/plans/AnchorMap";
import { Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { CRS, guessCrs, toLonLat, type CrsCode } from "@/lib/crs";
import { supabase } from "@/lib/supabase";

type Kind = "tracker" | "pile" | "table" | "segment" | "trench" | "axis" | "other";
const KINDS: { value: Kind; label: string; prefix: string }[] = [
  { value: "tracker", label: "Tracker", prefix: "TRK" },
  { value: "pile", label: "Pilote / hinca", prefix: "HIN" },
  { value: "table", label: "Mesa", prefix: "MES" },
  { value: "trench", label: "Zanja", prefix: "ZNJ" },
  { value: "segment", label: "Tramo (cable, vía)", prefix: "TRA" },
  { value: "axis", label: "Eje", prefix: "EJE" },
  { value: "other", label: "Otro", prefix: "ELM" },
];
const SCALE = { m: 1, cm: 0.01, mm: 0.001 } as const;

interface Activity {
  id: string;
  code: string;
  name: string;
  unit: string;
  front_id: string;
}

interface LayerMap {
  kind: Kind | "";
  activityId: string;
  prefix: string;
}

interface ExistingElement {
  id: string;
  code: string;
  kind: string;
  activity_id: string | null;
  qty: number;
  geojson: string | null;
}

/** Distancia aproximada en metros entre dos puntos lon/lat (cercanos). */
const meters = (a: XY, b: XY) => Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110_540);
/** Más de esto, el elemento "se movió". */
const MOVE_TOLERANCE_M = 0.5;

/** Largo en metros de una línea en coordenadas planas (ya en metros). */
const lengthM = (g: DxfGeometry) =>
  g.type === "LineString" ? g.coordinates.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - g.coordinates[i]![0], p[1] - g.coordinates[i]![1]), 0) : 0;

/**
 * Importa los elementos del layout (trackers, pilotes, zanjas…) desde el DXF del diseñador: cada capa
 * se asigna a un tipo y a una actividad, se ven sobre el satélite y se guardan con un código único.
 * Antes de guardar muestra qué es nuevo, qué cambia (posición, tipo, actividad o cantidad) y qué queda
 * igual; los existentes solo se actualizan si el administrador lo autoriza, los duplicados del dibujo
 * se omiten y cada importación queda registrada.
 */
export function DxfImport({ projectId, near, onDone }: { projectId: string; near: LonLat | null; onDone: (msg: string) => void }) {
  const [drawing, setDrawing] = useState<{ name: string; d: DxfDrawing } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crs, setCrs] = useState<CrsCode>("EPSG:9377");
  const [units, setUnits] = useState<keyof typeof SCALE>("m");
  const [map, setMap] = useState<Record<string, LayerMap>>({});
  const [acts, setActs] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingElement[]>([]);
  const [withProgress, setWithProgress] = useState<Set<string>>(new Set());
  const [authorize, setAuthorize] = useState(false);

  useEffect(() => {
    void supabase
      .from("activities")
      .select("id, code, name, unit, front_id")
      .eq("project_id", projectId)
      .order("code")
      .then(({ data }) => setActs((data ?? []) as Activity[]));
    // Lo que ya está en la obra, para mostrar qué cambia antes de guardar
    void supabase
      .from("elements")
      .select("id, code, kind, activity_id, qty, geojson")
      .eq("project_id", projectId)
      .limit(100000)
      .then(({ data }) => setExisting((data ?? []) as ExistingElement[]));
    void supabase
      .from("entry_elements")
      .select("element_id")
      .eq("project_id", projectId)
      .limit(200000)
      .then(({ data }) => setWithProgress(new Set((data ?? []).map((x: { element_id: string }) => x.element_id))));
  }, [projectId]);

  async function onFile(f: File) {
    setError(null);
    try {
      const d = parseDxf(await f.text());
      if (!d.entities.length) throw new Error("El DXF no tiene trackers, pilotes ni líneas en el espacio modelo.");
      const u = d.units ?? "m";
      setUnits(u);
      const s = SCALE[u];
      const c: XY = [((d.bounds![0][0] + d.bounds![1][0]) / 2) * s, ((d.bounds![0][1] + d.bounds![1][1]) / 2) * s];
      const g = guessCrs(c, near);
      if (g) setCrs(g);
      else setError("Las coordenadas del dibujo no corresponden a ningún sistema de Colombia conocido: revisa que el DXF esté georreferenciado (no en coordenadas locales).");
      setMap(Object.fromEntries(d.layers.map((l) => [l.name, { kind: "", activityId: "", prefix: "" }])));
      setDrawing({ name: f.name, d });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const setLayer = (name: string, patch: Partial<LayerMap>) => setMap((m) => ({ ...m, [name]: { ...m[name]!, ...patch } }));

  // Elementos a importar, ya en lon/lat, con código y cantidad
  const { prepared, duplicates, extentM } = useMemo(() => {
    if (!drawing) return { prepared: [], duplicates: 0, extentM: 0 };
    const s = SCALE[units];
    const proj = toLonLat(crs);
    let duplicates = 0;
    const [[bx0, by0], [bx1, by1]] = drawing.d.bounds ?? [[0, 0], [0, 0]];
    const extentM = Math.max(bx1 - bx0, by1 - by0) * s;
    const prepared = drawing.d.layers.flatMap((l) => {
      const m = map[l.name];
      if (!m?.kind) return [];
      const kind = m.kind;
      // Duplicados del dibujo (mismo objeto copiado encima): mismo centro a menos de 5 cm en la misma capa
      const seen = new Set<string>();
      const items = drawing.d.entities
        .filter((e) => e.layer === l.name)
        .map((e) => ({ geometry: mapGeometry(e.geometry, ([x, y]) => [x * s, y * s]) }))
        .filter((it) => {
          const [cx, cy] = centroid(it.geometry);
          const key = `${Math.round(cx / 0.05)}|${Math.round(cy / 0.05)}|${it.geometry.type}`;
          if (seen.has(key)) {
            duplicates++;
            return false;
          }
          seen.add(key);
          return true;
        });
      const prefix = (m.prefix.trim() || KINDS.find((k) => k.value === kind)!.prefix).toUpperCase();
      // Una fila de trackers tiene el mismo norte con tolerancia de unos metros
      return codeElements(items, prefix, 3).map((it) => ({
        code: it.code,
        kind,
        activityId: m.activityId || null,
        // Zanjas y tramos se miden en metros: el elemento vale su largo
        qty: (kind === "trench" || kind === "segment") && it.geometry.type === "LineString" ? Math.round(lengthM(it.geometry) * 10) / 10 : 1,
        geometry: mapGeometry(it.geometry, proj),
      }));
    });
    return { prepared, duplicates, extentM };
  }, [drawing, map, crs, units]);

  // Comparación con lo que ya existe en la obra, por código
  const compared = useMemo(() => {
    const byCode = new Map(existing.map((e) => [e.code.toUpperCase(), e]));
    return prepared.map((p) => {
      const ex = byCode.get(p.code.toUpperCase());
      if (!ex) return { ...p, status: "new" as const, changes: [] as string[], existingId: null as string | null, progress: false };
      const changes: string[] = [];
      let old: DxfGeometry | null = null;
      try {
        old = ex.geojson ? (JSON.parse(ex.geojson) as DxfGeometry) : null;
      } catch {
        old = null;
      }
      const moved = old ? meters(centroid(old), centroid(p.geometry)) : Infinity;
      if (moved > MOVE_TOLERANCE_M) changes.push(Number.isFinite(moved) ? `posición (se mueve ${moved.toLocaleString("es-CO", { maximumFractionDigits: 1 })} m)` : "posición");
      if (ex.kind !== p.kind) changes.push(`tipo (${ex.kind} → ${p.kind})`);
      if ((ex.activity_id ?? null) !== (p.activityId ?? null)) changes.push("actividad");
      if (Math.abs(Number(ex.qty) - p.qty) > 1e-6) changes.push(`cantidad (${ex.qty} → ${p.qty})`);
      return { ...p, status: changes.length ? ("update" as const) : ("same" as const), changes, existingId: ex.id, progress: withProgress.has(ex.id) };
    });
  }, [prepared, existing, withProgress]);
  const counts = {
    nuevos: compared.filter((c) => c.status === "new").length,
    cambian: compared.filter((c) => c.status === "update").length,
    iguales: compared.filter((c) => c.status === "same").length,
    conAvance: compared.filter((c) => c.status === "update" && c.progress).length,
  };
  const toWrite = compared.filter((c) => c.status === "new" || (c.status === "update" && authorize));

  const preview = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: "FeatureCollection", features: prepared.slice(0, 8000).map((p) => ({ type: "Feature", geometry: p.geometry as GeoJSON.Geometry, properties: {} })) }),
    [prepared],
  );
  const focus = useMemo<[LonLat, LonLat] | null>(() => {
    if (!prepared.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of prepared) {
      const pts = p.geometry.type === "Point" ? [p.geometry.coordinates] : p.geometry.type === "LineString" ? p.geometry.coordinates : p.geometry.coordinates[0]!;
      for (const [x, y] of pts) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return [[x0, y0], [x1, y1]];
  }, [prepared]);

  const noActivity = prepared.filter((p) => !p.activityId).length;
  const dupCodes = prepared.length - new Set(prepared.map((p) => p.code)).size;

  async function save() {
    setBusy(true);
    try {
      const rows = toWrite.map((p) => ({
        project_id: projectId,
        activity_id: p.activityId,
        front_id: acts.find((a) => a.id === p.activityId)?.front_id ?? null,
        kind: p.kind,
        code: p.code,
        qty: p.qty,
        geom: toEwkt(p.geometry),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        setProgress(`Guardando ${Math.min(i + 500, rows.length)} de ${rows.length}…`);
        const { error: e } = await supabase.from("elements").upsert(rows.slice(i, i + 500), { onConflict: "project_id,code" });
        if (e) throw e;
      }
      // Constancia de la importación
      const { data: u } = await supabase.auth.getUser();
      const { error: logError } = await supabase.from("import_runs").insert({
        project_id: projectId,
        kind: "dxf",
        file_name: drawing!.name,
        source: `dxf ${crs} ${units}`,
        summary: { creados: counts.nuevos, actualizados: authorize ? counts.cambian : 0, sin_cambio: counts.iguales, no_autorizados: authorize ? 0 : counts.cambian, duplicados_omitidos: duplicates },
        changes: authorize ? compared.filter((c) => c.status === "update").slice(0, 2000).map((c) => ({ codigo: c.code, cambios: c.changes })) : [],
        updated_existing: authorize && counts.cambian > 0,
        created_by: u.user?.id,
      });
      if (logError) throw new Error(`Los elementos se guardaron, pero la importación no quedó registrada: ${logError.message}`);
      onDone(
        `${counts.nuevos} elemento(s) nuevos${authorize && counts.cambian ? ` y ${counts.cambian} actualizado(s)` : ""} desde ${drawing!.name}. Los teléfonos los reciben en la próxima sincronización.`,
      );
      setDrawing(null);
    } catch (e) {
      setError(`No se pudo guardar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Elementos desde el DXF del layout</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Trackers, pilotes y zanjas que se marcan uno a uno en el teléfono. Pide al diseñador el layout en DXF, georreferenciado (MAGNA-SIRGAS o UTM). Antes de guardar se ve qué es
        nuevo y qué cambia; lo existente solo se actualiza si lo autorizas.
      </p>
      {error ? (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-2 font-semibold text-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {!drawing ? (
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 p-6 text-center hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
          <span className="font-bold">Elegir el archivo DXF</span>
          <span className="text-sm text-zinc-500">Desde AutoCAD: Guardar como → AutoCAD DXF.</span>
          <input type="file" accept=".dxf" className="sr-only" aria-label="Archivo DXF" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <p className="mr-auto font-semibold">
              {drawing.name} · {drawing.d.entities.length.toLocaleString("es-CO")} objetos en {drawing.d.layers.length} capas
            </p>
            <Field label="Sistema de coordenadas">
              <Select value={crs} onChange={(e) => setCrs(e.target.value as CrsCode)}>
                {CRS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidades del dibujo">
              <Select value={units} onChange={(e) => setUnits(e.target.value as keyof typeof SCALE)}>
                <option value="m">Metros</option>
                <option value="cm">Centímetros</option>
                <option value="mm">Milímetros</option>
              </Select>
            </Field>
            <Button variant="ghost" onClick={() => setDrawing(null)}>
              Cancelar
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-1.5 pr-2">Capa</th>
                  <th className="pr-2 text-right">Objetos</th>
                  <th className="pr-2">Importar como</th>
                  <th className="pr-2">Actividad</th>
                  <th className="pr-2">Prefijo del código</th>
                </tr>
              </thead>
              <tbody>
                {drawing.d.layers.map((l) => {
                  const m = map[l.name]!;
                  return (
                    <tr key={l.name} className={cx("border-b border-zinc-100 dark:border-zinc-800", !m.kind && "text-zinc-500")}>
                      <td className="py-1.5 pr-2">
                        <div className="font-semibold">{l.name}</div>
                        <div className="text-xs">{Object.entries(l.sources).map(([k, v]) => `${v} ${k}`).join(" · ")}</div>
                      </td>
                      <td className="pr-2 text-right tabular-nums">{l.count.toLocaleString("es-CO")}</td>
                      <td className="pr-2">
                        <Select value={m.kind} onChange={(e) => setLayer(l.name, { kind: e.target.value as Kind | "" })} aria-label={`Tipo de la capa ${l.name}`} className="py-1">
                          <option value="">No importar</option>
                          {KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                              {k.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="pr-2">
                        <Select value={m.activityId} disabled={!m.kind} onChange={(e) => setLayer(l.name, { activityId: e.target.value })} aria-label={`Actividad de la capa ${l.name}`} className="py-1">
                          <option value="">Sin actividad</option>
                          {acts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} · {a.name} ({a.unit})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="pr-2">
                        <Input
                          value={m.prefix}
                          disabled={!m.kind}
                          onChange={(e) => setLayer(l.name, { prefix: e.target.value })}
                          placeholder={m.kind ? KINDS.find((k) => k.value === m.kind)!.prefix : ""}
                          aria-label={`Prefijo de la capa ${l.name}`}
                          className="w-24 py-1"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {prepared.length ? (
            <>
              <AnchorMap points={[]} reference={preview} overlays={[]} focus={focus} onPick={() => undefined} />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                En amarillo, lo que se va a importar. Si queda lejos de la obra o deformado, cambia el sistema de coordenadas o las unidades.
                {prepared.length > 8000 ? " (La vista previa muestra los primeros 8.000.)" : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Elige en qué se convierte cada capa (por ejemplo, la capa de trackers como Tracker). Las demás no se importan.</p>
          )}

          {prepared.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["Nuevos", counts.nuevos, ""],
                  ["Cambian", counts.cambian, counts.cambian ? "text-amber-700 dark:text-amber-400" : ""],
                  ["Sin cambios", counts.iguales, ""],
                  ["Duplicados omitidos", duplicates, duplicates ? "text-amber-700 dark:text-amber-400" : ""],
                ] as const
              ).map(([label, n, cls]) => (
                <div key={label} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</div>
                  <div className={cx("text-xl font-extrabold tabular-nums", cls)}>{n.toLocaleString("es-CO")}</div>
                </div>
              ))}
            </div>
          ) : null}
          {extentM > 50_000 || (extentM > 0 && extentM < 1) ? (
            <p className="font-semibold text-red-700 dark:text-red-400">
              El dibujo mide {extentM.toLocaleString("es-CO", { maximumFractionDigits: 1 })} m de lado a lado: revisa las unidades del dibujo antes de importar.
            </p>
          ) : null}
          {counts.cambian ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <div className="mb-1 font-semibold">
                {counts.cambian.toLocaleString("es-CO")} elemento(s) ya existen y cambian
                {counts.conAvance ? `; ${counts.conAvance} tienen avance marcado en el plano` : ""}:
              </div>
              <ul className="mb-2 max-h-40 overflow-auto text-sm">
                {compared
                  .filter((c) => c.status === "update")
                  .slice(0, 50)
                  .map((c) => (
                    <li key={c.code}>
                      <b>{c.code}</b>: {c.changes.join(", ")}
                      {c.progress ? <span className="text-amber-800 dark:text-amber-300"> · con avance</span> : null}
                    </li>
                  ))}
              </ul>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={authorize} onChange={(e) => setAuthorize(e.target.checked)} className="h-5 w-5 accent-blue-700" />
                Autorizo actualizar estos {counts.cambian.toLocaleString("es-CO")} elementos (queda registrado)
              </label>
              {!authorize ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin autorizar, solo se crean los nuevos y los existentes quedan como están.</p> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={busy || !toWrite.length || dupCodes > 0} onClick={() => void save()}>
              {busy ? (progress ?? "Guardando…") : `Importar ${toWrite.length.toLocaleString("es-CO")} elementos`}
            </Button>
            {dupCodes ? <span className="font-semibold text-red-700 dark:text-red-400">Dos capas usan el mismo prefijo: cambia uno para que los códigos no se repitan.</span> : null}
            {!dupCodes && noActivity ? (
              <span className="text-amber-700 dark:text-amber-400">{noActivity.toLocaleString("es-CO")} sin actividad: se ven en el plano, pero marcarlos no suma avance.</span>
            ) : null}
            {prepared.length > 20000 ? <span className="text-amber-700 dark:text-amber-400">Son muchos elementos: la sincronización inicial en los teléfonos tardará más.</span> : null}
          </div>
        </div>
      )}
    </Card>
  );
}
