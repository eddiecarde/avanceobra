import { closeRing } from "./drawing";

/**
 * Selección masiva en el plano: con un rectángulo o un polígono se marcan de una vez
 * todos los elementos que caen dentro (p. ej. 1.000 hincas), en vez de tocarlos uno a uno.
 */

export type LonLat = [number, number];

export interface SelectableElement {
  id: string;
  qty: number;
  geojson: string | null;
  /** Cantidad ya ejecutada en registros anteriores (para no contarla dos veces). */
  executed: number;
}

/** Punto dentro de un anillo (algoritmo de rayos; el anillo puede venir cerrado o no). */
export function pointInRing([x, y]: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Punto representativo de un elemento: el punto mismo o el centroide de sus vértices. */
export function anchorOf(geojson: string | null): LonLat | null {
  if (!geojson) return null;
  let g: GeoJSON.Geometry;
  try {
    g = JSON.parse(geojson) as GeoJSON.Geometry;
  } catch {
    return null;
  }
  const avg = (pts: number[][]): LonLat => {
    const n = pts.length;
    return [pts.reduce((a, p) => a + p[0]!, 0) / n, pts.reduce((a, p) => a + p[1]!, 0) / n];
  };
  switch (g.type) {
    case "Point":
      return g.coordinates as LonLat;
    case "LineString":
      return avg(g.coordinates);
    case "Polygon": {
      const ring = g.coordinates[0] ?? [];
      const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
      return open.length ? avg(open) : null;
    }
    default:
      return null;
  }
}

export function rectangleRing(a: LonLat, b: LonLat): LonLat[] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
}

export interface AreaSelectionResult {
  /** Elementos que quedan seleccionados tras la operación. */
  ids: string[];
  /** Cuántos cambiaron (agregados o quitados). */
  changed: number;
  /** Elementos dentro del área que ya estaban ejecutados y no se agregaron. */
  skippedExecuted: number;
}

/**
 * Agrega (o quita) todos los elementos cuyo punto representativo cae dentro del área.
 * Al agregar se omiten los ya ejecutados por completo, para no reportarlos dos veces.
 */
export function selectInArea(
  elements: SelectableElement[],
  current: string[],
  area: LonLat[],
  mode: "add" | "remove",
  includeExecuted = false,
): AreaSelectionResult {
  const ring = closeRing(area);
  const selected = new Set(current);
  let changed = 0;
  let skippedExecuted = 0;
  for (const el of elements) {
    const p = anchorOf(el.geojson);
    if (!p || !pointInRing(p, ring)) continue;
    if (mode === "remove") {
      if (selected.delete(el.id)) changed++;
      continue;
    }
    if (selected.has(el.id)) continue;
    if (!includeExecuted && el.executed >= (el.qty || 1)) {
      skippedExecuted++;
      continue;
    }
    selected.add(el.id);
    changed++;
  }
  return { ids: [...selected], changed, skippedExecuted };
}
