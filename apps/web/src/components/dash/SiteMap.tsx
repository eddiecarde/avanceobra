"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { ZONE_COLORS, zoneStatus, type ZoneStatus } from "@avanceobra/engine";
import type { GeoJSONSource, LngLatLike, Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { SEVERITY_LABEL, type DashData } from "@/lib/dashboard";

const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

export const ZONE_LABEL: Record<ZoneStatus, string> = { not_started: "Sin iniciar", in_progress: "En proceso", done: "Terminado" };

type FC = GeoJSON.FeatureCollection;

/** Capas del plano a una fecha: elementos coloreados por estado, áreas trabajadas y hallazgos abiertos. */
export function buildLayers(data: DashData, until: string, activityId: string | null) {
  const executed = new Map<string, number>();
  for (const l of data.elementLinks) {
    if (l.date > until || (activityId && l.activityId !== activityId)) continue;
    executed.set(l.elementId, (executed.get(l.elementId) ?? 0) + 1);
  }
  const counts: Record<ZoneStatus, number> = { not_started: 0, in_progress: 0, done: 0 };
  const elements: FC = {
    type: "FeatureCollection",
    features: data.elements
      .filter((e) => !activityId || e.activityId === activityId || data.elementLinks.some((l) => l.elementId === e.id && l.activityId === activityId))
      .map((e) => {
        const status = zoneStatus((executed.get(e.id) ?? 0) * e.qty, e.qty);
        counts[status]++;
        return { type: "Feature", id: e.id, geometry: e.geometry, properties: { code: e.code, kind: e.kind, status, color: ZONE_COLORS[status] } };
      }),
  };
  const areas: FC = {
    type: "FeatureCollection",
    features: data.areas
      .filter((a) => a.date <= until && (!activityId || a.activityId === activityId))
      .map((a) => ({ type: "Feature", geometry: a.geometry, properties: { approved: a.approved, date: a.date, area: Math.round(a.areaM2) } })),
  };
  const findings: FC = {
    type: "FeatureCollection",
    features: data.findings
      .filter((f) => f.lat != null && f.lon != null && f.createdAt.slice(0, 10) <= until && (!f.closedAt || f.closedAt.slice(0, 10) > until))
      .map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: [f.lon!, f.lat!] }, properties: { description: f.description, severity: SEVERITY_LABEL[f.severity] ?? f.severity } })),
  };
  return { elements, areas, findings, counts };
}

function bounds(data: DashData): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      minX = Math.min(minX, c[0] as number); maxX = Math.max(maxX, c[0] as number);
      minY = Math.min(minY, c[1] as number); maxY = Math.max(maxY, c[1] as number);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const e of data.elements) if ("coordinates" in e.geometry) visit(e.geometry.coordinates);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

export function SiteMap({ data, until, activityId, onCounts, compact }: { data: DashData; until: string; activityId: string | null; onCounts?: (c: Record<ZoneStatus, number>) => void; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layers = useMemo(() => buildLayers(data, until, activityId), [data, until, activityId]);

  // Crear el mapa una vez por proyecto
  useEffect(() => {
    let cancelled = false;
    let instance: MlMap | null = null;
    void (async () => {
      const ml = (await import("maplibre-gl")).default;
      if (cancelled || !box.current) return;
      const b = bounds(data);
      instance = new ml.Map({
        container: box.current,
        style: MAP_STYLE,
        bounds: b ?? undefined,
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
        canvasContextAttributes: { preserveDrawingBuffer: true }, // para que salga al imprimir
      });
      instance.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      instance.on("error", (e) => {
        if (String(e.error?.message ?? "").includes("Failed to fetch")) setError("Sin conexión al mapa base: se muestran solo los elementos.");
      });
      instance.on("load", () => {
        const m = instance!;
        if (data.plan) {
          m.addSource("plan", { type: "image", url: data.plan.url, coordinates: data.plan.corners as [[number, number], [number, number], [number, number], [number, number]] });
          m.addLayer({ id: "plan", type: "raster", source: "plan", paint: { "raster-opacity": 0.85 } });
        }
        const empty: FC = { type: "FeatureCollection", features: [] };
        m.addSource("areas", { type: "geojson", data: empty });
        m.addSource("elements", { type: "geojson", data: empty });
        m.addSource("findings", { type: "geojson", data: empty });
        m.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": ["case", ["get", "approved"], "#16A34A", "#F59E0B"], "fill-opacity": 0.25 } });
        m.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": "#111827", "line-width": 1.5, "line-dasharray": [2, 1] } });
        m.addLayer({ id: "el-fill", type: "fill", source: "elements", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.75 } });
        m.addLayer({ id: "el-line", type: "line", source: "elements", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#111827", "line-width": 0.8 } });
        m.addLayer({
          id: "el-pt",
          type: "circle",
          source: "elements",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2, 19, 6], "circle-stroke-color": "#111827", "circle-stroke-width": 0.5 },
        });
        m.addLayer({ id: "findings", type: "circle", source: "findings", paint: { "circle-color": "#DC2626", "circle-radius": 8, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });

        const popup = new ml.Popup({ closeButton: false, closeOnClick: true });
        const show = (html: string, lngLat: LngLatLike) => popup.setLngLat(lngLat).setHTML(html).addTo(m);
        const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
        m.on("click", ["el-fill", "el-pt"], (e) => {
          const p = e.features?.[0]?.properties;
          if (p) show(`<b>${esc(p.code)}</b><br/>${esc(ZONE_LABEL[p.status as ZoneStatus])}`, e.lngLat);
        });
        m.on("click", "findings", (e) => {
          const p = e.features?.[0]?.properties;
          if (p) show(`<b>Hallazgo ${esc(p.severity)}</b><br/>${esc(p.description)}`, e.lngLat);
        });
        m.on("click", "areas-fill", (e) => {
          const p = e.features?.[0]?.properties;
          if (p) show(`<b>Área trabajada</b><br/>${esc(p.date)} · ${Number(p.area).toLocaleString("es-CO")} m²<br/>${p.approved ? "Aprobada" : "Enviada"}`, e.lngLat);
        });
        for (const id of ["el-fill", "el-pt", "findings", "areas-fill"]) {
          m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
        }
        if (!cancelled) setReady(true);
      });
      map.current = instance;
    })();
    return () => {
      cancelled = true;
      setReady(false);
      instance?.remove();
      map.current = null;
    };
  }, [data]);

  useEffect(() => {
    const m = map.current;
    onCounts?.(layers.counts);
    if (!m || !ready) return;
    (m.getSource("elements") as GeoJSONSource).setData(layers.elements);
    (m.getSource("areas") as GeoJSONSource).setData(layers.areas);
    (m.getSource("findings") as GeoJSONSource).setData(layers.findings);
  }, [layers, ready, onCounts]);

  return (
    <div className="relative">
      <div ref={box} className={`${compact ? "h-[260px]" : "h-[460px]"} w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800`} role="region" aria-label="Plano de la obra coloreado por avance" />
      {error ? <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}
    </div>
  );
}
