import { describe, expect, it } from "vitest";
import { codeElements, mapGeometry, parseDxf, toEwkt } from "../src/index.js";

/** DXF mínimo como lo escribe AutoCAD: encabezado con unidades y sección de entidades. */
function dxf(entities: string[], insunits = 6) {
  return [
    "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(insunits), "0", "ENDSEC",
    "0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "8", "0", "2", "TRK", "0", "INSERT", "8", "NO-CUENTA", "2", "X", "10", "1", "20", "1", "0", "ENDBLK", "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF",
  ].join("\r\n");
}
const insert = (layer: string, x: number, y: number) => ["0", "INSERT", "8", layer, "2", "TRK", "10", String(x), "20", String(y), "30", "0"].join("\r\n");
const circle = (layer: string, x: number, y: number) => ["0", "CIRCLE", "8", layer, "10", String(x), "20", String(y), "40", "0.15"].join("\r\n");

describe("DXF del layout", () => {
  it("lee bloques, círculos, polilíneas y líneas por capa, sin contar los de las definiciones de bloque", () => {
    const d = parseDxf(
      dxf([
        insert("TRACKERS", 5000100, 2700050),
        insert("TRACKERS", 5000110, 2700050),
        circle("HINCAS", 5000100, 2700040),
        ["0", "LWPOLYLINE", "8", "ZANJAS", "90", "3", "70", "0", "10", "0", "20", "0", "10", "10", "20", "0", "10", "10", "20", "5"].join("\r\n"),
        ["0", "LWPOLYLINE", "8", "CERRAMIENTO", "90", "4", "70", "1", "10", "0", "20", "0", "10", "10", "20", "0", "10", "10", "20", "10", "10", "0", "20", "10"].join("\r\n"),
        ["0", "LINE", "8", "ZANJAS", "10", "0", "20", "0", "11", "3", "21", "4"].join("\r\n"),
      ]),
    );
    expect(d.units).toBe("m");
    expect(d.entities).toHaveLength(6);
    expect(d.layers.map((l) => [l.name, l.count, l.shape])).toEqual([
      ["TRACKERS", 2, "point"],
      ["ZANJAS", 2, "line"],
      ["HINCAS", 1, "point"],
      ["CERRAMIENTO", 1, "polygon"],
    ]);
    const fence = d.entities.find((e) => e.layer === "CERRAMIENTO")!.geometry;
    expect(fence.type === "Polygon" && fence.coordinates[0]).toHaveLength(5);
    expect(d.bounds).toEqual([[0, 0], [5000110, 2700050]]);
  });

  it("lee polilíneas antiguas (POLYLINE con VERTEX) y unidades en milímetros", () => {
    const d = parseDxf(
      dxf(
        [
          ["0", "POLYLINE", "8", "VIAS", "66", "1", "70", "0"].join("\r\n"),
          ["0", "VERTEX", "8", "VIAS", "10", "1000", "20", "2000"].join("\r\n"),
          ["0", "VERTEX", "8", "VIAS", "10", "3000", "20", "2000"].join("\r\n"),
          ["0", "SEQEND", "8", "VIAS"].join("\r\n"),
          circle("HINCAS", 1500, 2500),
        ],
        4,
      ),
    );
    expect(d.units).toBe("mm");
    expect(d.entities.map((e) => e.geometry.type)).toEqual(["LineString", "Point"]);
  });

  it("explica qué hacer con un DWG o un archivo que no es DXF de texto", () => {
    expect(() => parseDxf("AC1032 contenido binario")).toThrow(/DWG/);
    expect(() => parseDxf("hola\nmundo\notra")).toThrow(/no es un DXF de texto/);
  });

  it("numera en orden de lectura: filas de norte a sur, de oeste a este", () => {
    const pts = [
      [10, 0],
      [0, 0.2],
      [0, 10],
      [10, 10.3],
      [5, 10],
    ].map(([x, y]) => ({ geometry: { type: "Point" as const, coordinates: [x!, y!] as [number, number] } }));
    const coded = codeElements(pts, "T", 1);
    expect(coded.map((c) => [c.code, ...c.geometry.coordinates])).toEqual([
      ["T-001", 0, 10],
      ["T-002", 5, 10],
      ["T-003", 10, 10.3],
      ["T-004", 0, 0.2],
      ["T-005", 10, 0],
    ]);
  });

  it("convierte a WKT para PostGIS tras proyectar", () => {
    const g = mapGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, ([x, y]) => [-74 + x / 1000, 10 + y / 1000]);
    expect(toEwkt(g)).toBe("SRID=4326;POLYGON((-74.00000000 10.00000000,-73.99900000 10.00000000,-73.99900000 10.00100000,-74.00000000 10.00000000))");
  });
});
