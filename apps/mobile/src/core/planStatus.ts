import { ZONE_COLORS, zoneStatus, type ZoneStatus } from "@avanceobra/engine";

/**
 * Construye el GeoJSON coloreado del plano: cada elemento (tracker, pilote, mesa…)
 * con su estado según lo ejecutado, y borde rojo si tiene un hallazgo abierto cerca.
 */

export interface ElementInput {
  id: string;
  code: string;
  kind: string;
  qty: number;
  geojson: string | null;
}

export interface PlanFeatureProps {
  id: string;
  code: string;
  kind: string;
  status: ZoneStatus;
  color: string;
  executed: number;
  selected: boolean;
  hasFinding: boolean;
}

export function buildElementsGeoJSON(
  elements: ElementInput[],
  executedByElement: Map<string, number>,
  selected: Set<string>,
  elementsWithFinding: Set<string> = new Set(),
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const el of elements) {
    if (!el.geojson) continue;
    let geometry: GeoJSON.Geometry;
    try {
      geometry = JSON.parse(el.geojson) as GeoJSON.Geometry;
    } catch {
      continue;
    }
    const executed = executedByElement.get(el.id) ?? 0;
    const status = zoneStatus(executed, el.qty || 1);
    const props: PlanFeatureProps = {
      id: el.id,
      code: el.code,
      kind: el.kind,
      status,
      color: ZONE_COLORS[status],
      executed,
      selected: selected.has(el.id),
      hasFinding: elementsWithFinding.has(el.id),
    };
    features.push({ type: "Feature", id: el.id, geometry, properties: props as unknown as GeoJSON.GeoJsonProperties });
  }
  return { type: "FeatureCollection", features };
}

/** Resumen para la barra del plano: cuántos elementos en cada estado. */
export function summarize(fc: GeoJSON.FeatureCollection): Record<ZoneStatus, number> {
  const out: Record<ZoneStatus, number> = { not_started: 0, in_progress: 0, done: 0 };
  for (const f of fc.features) out[(f.properties as unknown as PlanFeatureProps).status]++;
  return out;
}

/** Bounding box [oeste, sur, este, norte] de un conjunto de coordenadas (para encuadre y caché offline). */
export function bboxOf(coords: [number, number][]): [number, number, number, number] | null {
  if (coords.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

export function collectCoords(g: GeoJSON.Geometry): [number, number][] {
  switch (g.type) {
    case "Point":
      return [g.coordinates as [number, number]];
    case "LineString":
    case "MultiPoint":
      return g.coordinates as [number, number][];
    case "Polygon":
    case "MultiLineString":
      return g.coordinates.flat() as [number, number][];
    case "MultiPolygon":
      return g.coordinates.flat(2) as [number, number][];
    case "GeometryCollection":
      return g.geometries.flatMap(collectCoords);
  }
}

export interface PlanRow {
  id: string;
  name: string | null;
  version: number | null;
}

/**
 * Solo la última versión de cada plano (mismo nombre, sin distinguir mayúsculas ni espacios):
 * al subir la versión 2 de "Layout general", la 1 deja de dibujarse en el teléfono.
 */
export function latestPlans<T extends PlanRow>(rows: T[]): T[] {
  const best = new globalThis.Map<string, T>();
  for (const r of rows) {
    const key = (r.name ?? r.id).trim().toLowerCase();
    const cur = best.get(key);
    if (!cur || (r.version ?? 0) > (cur.version ?? 0)) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => (a.name ?? "").trim().localeCompare((b.name ?? "").trim(), "es", { sensitivity: "base" }));
}
