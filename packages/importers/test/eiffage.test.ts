import { describe, expect, it } from "vitest";
import { eiffageToPlan, parseEiffageMemoria, subfieldOf, type MemoriaRow } from "../src/eiffage.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const row = (n: number, outline: number, cells: unknown[], days: number[] = []): MemoriaRow => {
  const values = [...cells];
  days.forEach((q, i) => (values[26 + i] = q));
  return { row: n, outline, values };
};
// Encabezado: columnas 26-27 diarias, 28 semanal (no cuenta)
const header: unknown[] = [];
const kinds: unknown[] = [];
header[26] = d("2025-05-01");
header[27] = d("2025-05-02");
header[28] = "W18-2025";
kinds[26] = "Daily";
kinds[27] = "Daily";
kinds[28] = "Week";

describe("informe Eiffage (hoja Memoria)", () => {
  it("usa la numeración original del cronograma para los subcampos renombrados", () => {
    expect(subfieldOf("Subcampo 05 (Antes Subcampo 15)")).toBe("SC15");
    expect(subfieldOf("Subcampo 7")).toBe("SC07");
    expect(subfieldOf("IR_03")).toBeNull();
  });

  it("arma hojas con peso global, subcampo, fechas e historial diario", () => {
    const rows = [
      row(9, 0, [null, "Mechanical Works"]),
      row(10, 0, ["AO.ME.1.1", "Hincas", "Ud", 0.6, 300, d("2025-04-14"), d("2025-06-01")]),
      row(11, 1, [null, "Subcampo 01 (Antes Subcampo 19)", "Ud", 0.02, 100, d("2025-04-14"), d("2025-05-01"), null, null, null, null, null, 100], [40, 60]),
      row(12, 1, [null, "Subcampo 02 (Antes Subcampo 18)", "Ud", 0.04, 200, d("2025-05-01"), d("2025-06-01"), null, null, null, null, null, 0]),
      row(13, 0, [null, "Módulos", "Ud", 0.4, 50, d("2025-05-01"), d("2025-07-01"), null, null, null, null, null, 0], [0, 5]),
      row(14, 0, [null, "Suministro"]),
      row(15, 0, [null, "CABLE MT"]),
      row(16, 0, [null, "CABLE MT (1x300mm2)", "ML", null, 17231, d("2025-05-13")]),
    ];
    header[28] = "W18-2025";
    const rep = parseEiffageMemoria(rows, header, kinds, { sectionWeights: { "mechanical works": 1 } });
    expect(rep.sections).toEqual([{ name: "Mechanical Works", weight: 1, leaves: 3 }]);
    const [a, b, m] = rep.leaves;
    // Los pesos de los hijos se normalizan dentro del padre: 0,6 × 1/3 y 0,6 × 2/3
    expect(a!.weight).toBeCloseTo(0.2);
    expect(b!.weight).toBeCloseTo(0.4);
    expect(m!.weight).toBeCloseTo(0.4);
    expect(a).toMatchObject({ code: "AO.ME.1.1-SC19", subfield: "SC19", name: "Hincas › Subcampo 19", start: "2025-04-14", executed: 100, groupCode: "AO.ME.1.1" });
    expect(a!.daily).toEqual([
      { date: "2025-05-01", quantity: 40 },
      { date: "2025-05-02", quantity: 60 },
    ]);
    expect(m!.subfield).toBeNull();
    expect(m!.daily).toEqual([{ date: "2025-05-02", quantity: 5 }]);
    // Programación importable: frente por subcampo y GEN, con peso, subcampo y grupo
    const plan = eiffageToPlan(rep);
    expect(plan.errors).toEqual([]);
    expect(plan.fronts.map((f) => f.code)).toEqual(["SC18", "SC19", "GEN"]);
    expect(plan.activities[0]).toMatchObject({ frontCode: "SC19", code: "AO.ME.1.1-SC19", weight: a!.weight, subfield: "SC19", workGroup: "Hincas", externalRef: "Memoria!11" });
    expect(plan.activities[0]!.history).toEqual([
      { date: "2025-05-01", quantity: 40 },
      { date: "2025-05-02", quantity: 60 },
    ]);
    // Suministros aparte, con sus subtítulos sin abrir secciones nuevas
    expect(rep.supplies).toEqual([{ name: "CABLE MT (1x300mm2)", unit: "ML", quantity: 17231, date: "2025-05-13" }]);
  });

  it("divide en grupos las partes de un grupo que no van por subcampo", () => {
    const rows = [
      row(9, 0, [null, "Civil Works"]),
      row(10, 0, ["AO.OC.1.4", "Drainages", "ml", 1, 1]),
      row(11, 1, [null, "Cunetas", "ml", 0.6, 9578]),
      row(12, 2, [null, "Excavacion y perfilado", "ml", 1, 9578]),
      row(13, 1, [null, "ODT´s (Internas)", "Ud", 0.4, 10]),
      row(14, 2, [null, "ODT_01", "Ud", 1, 10]),
      row(15, 0, ["AO.OC.1.6", "Internal Road (m)", "ml", 1, 8862]),
      row(16, 1, [null, "Internal Roads (Subrasante)(m)", "ml", 0.5, 8862]),
      row(17, 2, [null, "IR_01", "ml", 1, 8862]),
      row(18, 1, [null, "Internal Roads (Base)(m)", "ml", 0.5, 8862]),
      row(19, 2, [null, "IR_01", "ml", 1, 8862]),
      // Partes que son hojas (tipos de zanja): el grupo no se divide
      row(20, 0, [null, "Cableado MV (Excavación)", "ml", 1, 300]),
      row(21, 1, [null, "ZANJA Z2.5", "ml", 0.5, 100]),
      row(22, 1, [null, "ZANJA Z2.6", "ml", 0.5, 200]),
    ];
    const rep = parseEiffageMemoria(rows, header, kinds, { sectionWeights: { "civil works": 1 } });
    expect(rep.leaves.map((l) => l.group)).toEqual([
      "Drainages › Cunetas",
      "Drainages › ODT´s (Internas)",
      "Internal Roads (Subrasante)(m)",
      "Internal Roads (Base)(m)",
      "Cableado MV (Excavación)",
      "Cableado MV (Excavación)",
    ]);
    // El código sigue saliendo de la partida principal (no cambia al dividir)
    expect(rep.leaves[0]!.code.startsWith("AO.OC.1.4")).toBe(true);
  });
});
