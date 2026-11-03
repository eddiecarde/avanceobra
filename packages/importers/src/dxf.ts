/**
 * Lector de DXF (texto ASCII de AutoCAD) para el layout de la obra: trackers, pilotes, zanjas.
 * Lee solo lo que sirve para ubicar elementos: bloques insertados, círculos, puntos, polilíneas y
 * líneas, con su capa. Las coordenadas quedan en el sistema del dibujo; la conversión a lon/lat la
 * hace quien llama (el sistema de coordenadas lo elige el usuario).
 */

export type XY = [number, number];

export type DxfGeometry = { type: "Point"; coordinates: XY } | { type: "LineString"; coordinates: XY[] } | { type: "Polygon"; coordinates: XY[][] };

export interface DxfEntity {
  layer: string;
  /** Tipo de entidad en el DXF (INSERT, CIRCLE, LWPOLYLINE…). */
  source: string;
  /** Nombre del bloque, para INSERT. */
  block?: string;
  geometry: DxfGeometry;
}

export interface DxfLayer {
  name: string;
  count: number;
  /** Conteo por tipo de entidad: { INSERT: 1200, LWPOLYLINE: 3 }. */
  sources: Record<string, number>;
  /** Geometría que predomina en la capa (para sugerir tracker, pilote o tramo). */
  shape: "point" | "line" | "polygon";
}

export interface DxfDrawing {
  /** Unidades del dibujo según $INSUNITS (4 = mm, 5 = cm, 6 = m); null si no las declara. */
  units: "mm" | "cm" | "m" | null;
  entities: DxfEntity[];
  layers: DxfLayer[];
  /** Límites del dibujo en sus coordenadas. */
  bounds: [XY, XY] | null;
}

const UNITS: Record<string, DxfDrawing["units"]> = { "4": "mm", "5": "cm", "6": "m" };

/** Pares (código, valor) del DXF. */
function pairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) throw new Error("El archivo no es un DXF de texto (si es binario, guárdalo como DXF ASCII desde AutoCAD)");
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

const shapeOf = (g: DxfGeometry): DxfLayer["shape"] => (g.type === "Point" ? "point" : g.type === "Polygon" ? "polygon" : "line");

function closeRing(pts: XY[]): XY[] {
  const [a, b] = [pts[0]!, pts.at(-1)!];
  return a[0] === b[0] && a[1] === b[1] ? pts : [...pts, a];
}

/** Lee un DXF ASCII. Lanza un error con mensaje en español si no se puede leer. */
export function parseDxf(text: string): DxfDrawing {
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error("El DXF es binario: guárdalo como DXF ASCII desde AutoCAD");
  if (/^AC10\d\d/.test(text)) throw new Error("Es un DWG: guárdalo como DXF desde AutoCAD (Guardar como → DXF)");
  const p = pairs(text);
  let units: DxfDrawing["units"] = null;
  const entities: DxfEntity[] = [];

  // Encabezado: unidades
  for (let i = 0; i < p.length; i++) {
    if (p[i]![0] === 9 && p[i]![1] === "$INSUNITS" && p[i + 1]?.[0] === 70) units = UNITS[p[i + 1]![1]] ?? null;
    if (p[i]![0] === 0 && p[i]![1] === "ENDSEC" && units !== null) break;
  }

  // Sección ENTITIES
  let i = p.findIndex(([c, v], k) => c === 2 && v === "ENTITIES" && p[k - 1]?.[1] === "SECTION");
  if (i < 0) throw new Error("El DXF no tiene sección de entidades");
  i++;
  while (i < p.length) {
    const [code, value] = p[i]!;
    if (code !== 0) {
      i++;
      continue;
    }
    if (value === "ENDSEC") break;
    const type = value;
    // Atributos de esta entidad hasta el siguiente código 0
    const attrs: [number, string][] = [];
    i++;
    while (i < p.length && p[i]![0] !== 0) attrs.push(p[i++]!);
    const get = (c: number) => attrs.find(([k]) => k === c)?.[1];
    const num = (c: number) => Number(get(c));
    const layer = get(8) ?? "0";

    if (type === "INSERT" || type === "CIRCLE" || type === "POINT") {
      const x = num(10);
      const y = num(20);
      if (Number.isFinite(x) && Number.isFinite(y)) entities.push({ layer, source: type, block: type === "INSERT" ? get(2) : undefined, geometry: { type: "Point", coordinates: [x, y] } });
    } else if (type === "LINE") {
      const a: XY = [num(10), num(20)];
      const b: XY = [num(11), num(21)];
      if ([...a, ...b].every(Number.isFinite)) entities.push({ layer, source: type, geometry: { type: "LineString", coordinates: [a, b] } });
    } else if (type === "LWPOLYLINE") {
      const xs = attrs.filter(([k]) => k === 10).map(([, v]) => Number(v));
      const ys = attrs.filter(([k]) => k === 20).map(([, v]) => Number(v));
      const pts = xs.map((x, k) => [x, ys[k]!] as XY).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      const closed = (Number(get(70)) & 1) === 1;
      if (pts.length >= 2) entities.push(polyEntity(layer, type, pts, closed));
    } else if (type === "POLYLINE") {
      // Polilínea antigua: los vértices vienen como entidades VERTEX hasta SEQEND
      const closed = (Number(get(70)) & 1) === 1;
      const pts: XY[] = [];
      while (i < p.length && p[i]![1] !== "SEQEND") {
        if (p[i]![0] === 0 && p[i]![1] === "VERTEX") {
          i++;
          const v: [number, string][] = [];
          while (i < p.length && p[i]![0] !== 0) v.push(p[i++]!);
          const x = Number(v.find(([k]) => k === 10)?.[1]);
          const y = Number(v.find(([k]) => k === 20)?.[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
        } else i++;
      }
      if (pts.length >= 2) entities.push(polyEntity(layer, type, pts, closed));
    }
  }

  // Resumen por capa
  const byLayer = new Map<string, DxfEntity[]>();
  for (const e of entities) byLayer.set(e.layer, [...(byLayer.get(e.layer) ?? []), e]);
  const layers: DxfLayer[] = [...byLayer.entries()]
    .map(([name, es]) => {
      const sources: Record<string, number> = {};
      const shapes: Record<string, number> = {};
      for (const e of es) {
        sources[e.source] = (sources[e.source] ?? 0) + 1;
        shapes[shapeOf(e.geometry)] = (shapes[shapeOf(e.geometry)] ?? 0) + 1;
      }
      const shape = (Object.entries(shapes).sort((a, b) => b[1] - a[1])[0]![0] as DxfLayer["shape"]) ?? "point";
      return { name, count: es.length, sources, shape };
    })
    .sort((a, b) => b.count - a.count);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      x0 = Math.min(x0, c[0] as number); x1 = Math.max(x1, c[0] as number);
      y0 = Math.min(y0, c[1] as number); y1 = Math.max(y1, c[1] as number);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  entities.forEach((e) => visit(e.geometry.coordinates));
  return { units, entities, layers, bounds: Number.isFinite(x0) ? [[x0, y0], [x1, y1]] : null };
}

function polyEntity(layer: string, source: string, pts: XY[], closed: boolean): DxfEntity {
  return closed && pts.length >= 3
    ? { layer, source, geometry: { type: "Polygon", coordinates: [closeRing(pts)] } }
    : { layer, source, geometry: { type: "LineString", coordinates: pts } };
}

/** Centro de una geometría (promedio de vértices): sirve para ordenar y para el punto del elemento. */
export function centroid(g: DxfGeometry): XY {
  const pts = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates[0]!.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/**
 * Códigos para los elementos de una capa: prefijo + número, en orden de lectura del plano
 * (filas de norte a sur y, dentro de cada fila, de oeste a este). La tolerancia de fila es la
 * distancia en que dos elementos se consideran "a la misma altura".
 */
export function codeElements<T extends { geometry: DxfGeometry }>(items: T[], prefix: string, rowTolerance: number): (T & { code: string })[] {
  const withC = items.map((it) => ({ it, c: centroid(it.geometry) }));
  withC.sort((a, b) => b.c[1] - a.c[1]);
  const rows: (typeof withC)[] = [];
  for (const x of withC) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.c[1] - x.c[1]) <= rowTolerance) row.push(x);
    else rows.push([x]);
  }
  const width = String(items.length).length < 3 ? 3 : String(items.length).length;
  return rows
    .flatMap((r) => r.sort((a, b) => a.c[0] - b.c[0]))
    .map((x, k) => ({ ...x.it, code: `${prefix}-${String(k + 1).padStart(width, "0")}` }));
}

/** WKT con SRID para PostGIS a partir de una geometría ya en lon/lat. */
export function toEwkt(g: DxfGeometry): string {
  const xy = (p: XY) => `${p[0].toFixed(8)} ${p[1].toFixed(8)}`;
  if (g.type === "Point") return `SRID=4326;POINT(${xy(g.coordinates)})`;
  if (g.type === "LineString") return `SRID=4326;LINESTRING(${g.coordinates.map(xy).join(",")})`;
  return `SRID=4326;POLYGON(${g.coordinates.map((r) => `(${r.map(xy).join(",")})`).join(",")})`;
}

/** Aplica una función de coordenadas (p. ej. proyección a lon/lat, o escala de mm a m) a una geometría. */
export function mapGeometry(g: DxfGeometry, f: (p: XY) => XY): DxfGeometry {
  if (g.type === "Point") return { type: "Point", coordinates: f(g.coordinates) };
  if (g.type === "LineString") return { type: "LineString", coordinates: g.coordinates.map(f) };
  return { type: "Polygon", coordinates: g.coordinates.map((r) => r.map(f)) };
}
