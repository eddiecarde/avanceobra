"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { LonLat } from "@avanceobra/engine";
import type { GeoJSONSource, ImageSource, Map as MlMap, Marker, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { SATELLITE_STYLE } from "@/lib/plans";

type FC = GeoJSON.FeatureCollection;
const empty: FC = { type: "FeatureCollection", features: [] };

/** Plano superpuesto sobre el satélite (uno al anclar; dos al comparar). */
export interface PlanOverlay {
  id: string;
  url: string;
  corners: [LonLat, LonLat, LonLat, LonLat];
  opacity: number;
}

interface AnchorMapProps {
  /** Puntos de control marcados en el mapa, numerados. */
  points: { n: number; geo: LonLat; active: boolean }[];
  /** Elementos ya cargados del proyecto, como referencia para ubicarse. */
  reference: FC;
  /** Planos superpuestos, de abajo hacia arriba. */
  overlays: PlanOverlay[];
  /** Hacia dónde mirar al abrir (o al pedir "ir a"). */
  focus: { center: LonLat; zoom: number } | [LonLat, LonLat] | null;
  onPick: (geo: LonLat) => void;
}

/** Mapa satelital donde se marca, para cada punto del plano, el mismo lugar en el terreno, y se superponen planos. */
export function AnchorMap({ points, reference, overlays, focus, onPick }: AnchorMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const pick = useRef(onPick);
  pick.current = onPick;
  const latest = useRef({ points, reference, overlays, focus });
  latest.current = { points, reference, overlays, focus };
  const shown = useRef<string[]>([]);
  const drawn = useRef<Record<string, string>>({});
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);

  const look = () => {
    const m = map.current;
    const f = latest.current.focus;
    if (!m || !f) return;
    if (Array.isArray(f)) m.fitBounds(f, { padding: 40, duration: 0, maxZoom: 18 });
    else m.jumpTo({ center: f.center, zoom: f.zoom });
  };

  const paint = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { points: pts, reference: ref, overlays: ovs } = latest.current;
    (m.getSource("ref") as GeoJSONSource | undefined)?.setData(ref);
    // Puntos de control como marcadores numerados (el estilo satelital no trae fuentes para texto)
    markers.current.forEach((mk) => mk.remove());
    markers.current = pts.map((p) => {
      const el = document.createElement("div");
      el.textContent = String(p.n);
      el.className = "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow";
      el.style.background = p.active ? "#dc2626" : "#1d4ed8";
      el.style.pointerEvents = "none";
      return new lib.current!.Marker({ element: el }).setLngLat(p.geo).addTo(m);
    });
    // Planos: se quitan los que ya no están y se agregan o actualizan los demás, en orden
    const ids = ovs.map((o) => `plano-${o.id}`);
    for (const id of shown.current.filter((x) => !ids.includes(x))) {
      m.removeLayer(id);
      m.removeSource(id);
      delete drawn.current[id];
    }
    for (const o of ovs) {
      const id = `plano-${o.id}`;
      const src = m.getSource(id) as ImageSource | undefined;
      if (!src) {
        m.addSource(id, { type: "image", url: o.url, coordinates: o.corners });
        m.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": o.opacity, "raster-fade-duration": 0 } }, "ref-lineas");
      } else if (drawn.current[id] !== `${o.url}|${o.corners.join(";")}`) src.updateImage({ url: o.url, coordinates: o.corners });
      // Solo se vuelve a cargar la imagen si cambió (al mover la transparencia no)
      drawn.current[id] = `${o.url}|${o.corners.join(";")}`;
      m.setPaintProperty(id, "raster-opacity", o.opacity);
    }
    shown.current = ids;
  };

  useEffect(() => {
    let off = false;
    void import("maplibre-gl").then((mod) => {
      const maplibregl = mod.default;
      if (off || !box.current) return;
      lib.current = maplibregl;
      const m = new maplibregl.Map({ container: box.current, style: SATELLITE_STYLE as unknown as StyleSpecification, center: [-74.3, 4.6], zoom: 5, attributionControl: { compact: true } });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.getCanvas().style.cursor = "crosshair";
      m.on("load", () => {
        m.addSource("ref", { type: "geojson", data: empty });
        m.addLayer({ id: "ref-lineas", type: "line", source: "ref", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#facc15", "line-width": 1.5 } });
        m.addLayer({ id: "ref-puntos", type: "circle", source: "ref", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 2.5, "circle-color": "#facc15" } });
        ready.current = true;
        look();
        paint();
      });
      m.on("click", (e) => pick.current([e.lngLat.lng, e.lngLat.lat]));
    });
    return () => {
      off = true;
      ready.current = false;
      markers.current = [];
      shown.current = [];
      drawn.current = {};
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(paint, [points, reference, overlays]);

  useEffect(look, [focus]);

  return <div ref={box} className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700" aria-label="Mapa satelital para anclar el plano" />;
}
