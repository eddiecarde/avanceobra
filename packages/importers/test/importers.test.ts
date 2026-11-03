import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffImport, fromExcelRows, fromMsProjectXml, fromPrimaveraXer, toISODate, toNumber, type ExistingActivity } from "../src/index.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

describe("normalización", () => {
  it("fechas en varios formatos", () => {
    expect(toISODate("2026-09-22T08:00:00")).toBe("2026-09-22");
    expect(toISODate("2026-09-22 08:00")).toBe("2026-09-22");
    expect(toISODate("22/09/2026")).toBe("2026-09-22");
    expect(toISODate("5/1/26")).toBe("2026-01-05");
    expect(toISODate(new Date(Date.UTC(2026, 8, 22)))).toBe("2026-09-22");
    expect(toISODate(46287)).toBe("2026-09-22"); // serie de Excel
    expect(toISODate("31/02/2026")).toBeNull();
    expect(toISODate("mañana")).toBeNull();
  });
  it("números con coma o punto", () => {
    expect(toNumber("1.234,5")).toBe(1234.5);
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(toNumber("2400")).toBe(2400);
    expect(toNumber("12,5")).toBe(12.5);
    expect(toNumber("2.400")).toBe(2400);
    expect(toNumber("1.250.000")).toBe(1250000);
    expect(toNumber("2.5")).toBe(2.5);
    expect(toNumber("abc")).toBeNull();
  });
});

describe("Excel", () => {
  const header = ["Frente", "Código", "Nombre", "Unidad", "Cantidad", "Inicio", "Fin", "Predecesoras"];
  it("lee actividades, frentes y predecesoras con encabezados con tildes", () => {
    const plan = fromExcelRows({
      frentes: [
        ["Código", "Nombre", "Máx recursos"],
        ["BA", "Bloque A", 4],
      ],
      actividades: [
        header,
        ["BA", "BA-HIN", "Hincado de pilotes", "pilotes", 192, "22/09/2026", new Date(Date.UTC(2026, 9, 24)), ""],
        ["BA", "ba-mon", "Montaje de trackers", "trackers", "24", "2026-09-29", "2026-11-03", "BA-HIN"],
        [null, null, null],
        ["CS", "CS-TMT", "Tendido MT", "m", "2.400", "", "", "BA-MON; XX-1"],
      ],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.fronts).toEqual([
      { code: "BA", name: "Bloque A", maxParallel: 4 },
      { code: "CS", name: "CS" },
    ]);
    expect(plan.activities.map((a) => [a.code, a.quantity, a.start, a.predecessors])).toEqual([
      ["BA-HIN", 192, "2026-09-22", []],
      ["BA-MON", 24, "2026-09-29", ["BA-HIN"]],
      ["CS-TMT", 2400, null, ["BA-MON"]],
    ]);
    expect(plan.warnings.some((w) => w.message.includes("XX-1"))).toBe(true);
  });
  it("informa columnas faltantes, cantidades inválidas, duplicados y ciclos", () => {
    expect(fromExcelRows({ actividades: [["Código", "Nombre"]] }).errors.map((e) => e.message)).toContain('Falta la columna "frente" en la hoja Actividades.');
    const plan = fromExcelRows({
      actividades: [
        header,
        ["BA", "A", "Uno", "m", "diez", "", "", "B"],
        ["BA", "B", "Dos", "m", 5, "2026-10-10", "2026-10-01", "A"],
      ],
    });
    const msgs = plan.errors.map((e) => e.message).join(" | ");
    expect(msgs).toContain('la cantidad "diez" no es un número');
    expect(msgs).toContain("Termina (2026-10-01) antes de empezar (2026-10-10)");
    expect(msgs).toContain("Las predecesoras forman un ciclo: A → B → A");
    const dup = fromExcelRows({ actividades: [header, ["BA", "B", "Dos", "m", 5], ["BA", "B", "Tres", "m", 5]] });
    expect(dup.errors.map((e) => e.message)).toEqual(["El código B está repetido 2 veces."]);
  });
});

describe("MS Project XML", () => {
  const plan = fromMsProjectXml(fixture("proyecto.xml"));
  it("resumen de primer nivel = frente; hojas = actividades; omite hitos e inactivas", () => {
    expect(plan.errors).toEqual([]);
    expect(plan.projectName).toBe("Parque Solar Demo & Subestación");
    expect(plan.fronts).toEqual([
      { code: "F1", name: "Bloque A" },
      { code: "F2", name: "Subestación" },
    ]);
    expect(plan.activities.map((a) => [a.frontCode, a.code, a.name, a.start, a.finish, a.predecessors, a.quantity, a.unit])).toEqual([
      ["F1", "1.1", "Hincado de pilotes", "2026-09-22", "2026-10-24", [], null, null],
      ["F1", "1.2", "Montaje de trackers", "2026-09-29", "2026-11-03", ["1.1"], null, null],
      ["F2", "2.1.1", "Concreto de bases", "2026-10-19", "2026-11-11", [], null, null],
    ]);
    expect(plan.activities[0]!.externalRef).toBe("msp:2");
    expect(plan.warnings.map((w) => w.message).join(" ")).toContain("Hito omitido");
  });
  it("rechaza archivos que no son de MS Project", () => {
    expect(fromMsProjectXml("<html></html>").errors).toHaveLength(1);
  });
});

describe("Primavera XER", () => {
  const plan = fromPrimaveraXer(fixture("proyecto.xer"));
  it("WBS de primer nivel = frente, toma el proyecto con más actividades", () => {
    expect(plan.errors).toEqual([]);
    expect(plan.projectName).toBe("PSD-01");
    expect(plan.fronts).toEqual([
      { code: "BA", name: "Bloque A" },
      { code: "CS", name: "Cableado MT y subestación" },
    ]);
    expect(plan.activities.map((a) => [a.frontCode, a.code, a.start, a.finish, a.predecessors])).toEqual([
      ["BA", "BA-HIN", "2026-09-22", "2026-10-24", []],
      ["BA", "BA-MON", "2026-09-29", "2026-11-03", ["BA-HIN"]],
      ["CS", "CS-TMT", "2026-10-04", "2026-11-11", []],
    ]);
    const w = plan.warnings.map((x) => x.message).join(" | ");
    expect(w).toContain("2 proyectos");
    expect(w).toContain("Hito omitido");
  });
  it("rechaza archivos que no son XER", () => {
    expect(fromPrimaveraXer("hola").errors).toHaveLength(1);
  });
});

describe("comparación con la obra existente", () => {
  const fronts = [
    { id: "f1", code: "BA", name: "Bloque A" },
    { id: "f2", code: "CS", name: "Cableado MT y subestación" },
  ];
  const act = (id: string, frontId: string, code: string, extra: Partial<ExistingActivity> = {}): ExistingActivity => ({
    id,
    frontId,
    code,
    name: code,
    unit: "und",
    contractQty: 10,
    plannedStart: null,
    plannedFinish: null,
    predecessorIds: [],
    externalRef: null,
    ...extra,
  });

  it("Primavera actualiza fechas y predecesoras sin tocar unidad ni cantidad", () => {
    const existing = {
      fronts,
      activities: [
        act("a1", "f1", "BA-HIN", { name: "Hincado de pilotes", unit: "pilotes", contractQty: 192, plannedStart: "2026-09-22", plannedFinish: "2026-10-24" }),
        act("a2", "f1", "BA-MON", { name: "Montaje de trackers", unit: "trackers", contractQty: 24, plannedStart: "2026-09-30", plannedFinish: "2026-11-03" }),
        act("a3", "f1", "BA-MOD"),
      ],
    };
    const d = diffImport(existing, fromPrimaveraXer(fixture("proyecto.xer")));
    expect(d.fronts.map((f) => [f.code, f.existingId, f.matchedBy])).toEqual([
      ["BA", "f1", "code"],
      ["CS", "f2", "code"],
    ]);
    const byCode = Object.fromEntries(d.activities.map((a) => [a.activity.code, a]));
    expect(byCode["BA-HIN"]!.status).toBe("same");
    expect(byCode["BA-MON"]!.changes).toEqual([
      { field: "inicio", from: "2026-09-30", to: "2026-09-29" },
      { field: "predecesoras", from: "ninguna", to: "BA-HIN" },
    ]);
    // Nueva sin cantidad ni unidad: no se puede crear hasta completarlas
    expect(byCode["CS-TMT"]!.status).toBe("blocked");
    expect(byCode["CS-TMT"]!.problems).toEqual(["Falta la cantidad contractual.", "Falta la unidad."]);
    expect(d.untouched.map((a) => a.code)).toEqual(["BA-MOD"]);
    expect(d.summary).toEqual({ newFronts: 0, newActivities: 0, updated: 1, same: 1, blocked: 1 });
  });

  it("MS Project empareja frentes por nombre y actividades por UID", () => {
    const existing = { fronts, activities: [act("a1", "f1", "BA-HIN", { externalRef: "msp:2", name: "Hincado de pilotes" })] };
    const d = diffImport(existing, fromMsProjectXml(fixture("proyecto.xml")));
    expect(d.fronts.map((f) => [f.fileCode, f.code, f.matchedBy])).toEqual([
      ["F1", "BA", "name"],
      ["F2", "F2", null],
    ]);
    const hin = d.activities.find((a) => a.activity.code === "1.1")!;
    expect(hin.existingId).toBe("a1");
    expect(hin.frontCode).toBe("BA");
    expect(hin.changes.map((c) => c.field)).toEqual(["inicio", "fin"]);
    expect(d.summary.newFronts).toBe(1);
  });
});

describe("MS Project XML: línea base, avance, grupo y zona", () => {
  const xml = `<?xml version="1.0"?><Project><Title>Planta</Title><StatusDate>2026-02-15T17:00:00</StatusDate><Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Planta</Name><WBS>1</WBS><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>2</UID><ID>2</ID><Name>DC Trenches</Name><WBS>1.1</WBS><OutlineLevel>2</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Excavation</Name><WBS>1.1.1</WBS><OutlineLevel>3</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>4</UID><ID>4</ID><Name>Subcampo 01</Name><WBS>1.1.1.1</WBS><OutlineLevel>4</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-05T08:00:00</Start><Finish>2026-01-20T17:00:00</Finish><PercentComplete>40</PercentComplete><ActualStart>2026-01-08T08:00:00</ActualStart>
      <Baseline><Number>0</Number><Start>2025-12-01T08:00:00</Start><Finish>2025-12-15T17:00:00</Finish></Baseline>
      <Baseline><Number>1</Number><Start>2025-12-10T08:00:00</Start><Finish>2025-12-24T17:00:00</Finish></Baseline></Task>
    <Task><UID>5</UID><ID>5</ID><Name>MV Trenches</Name><WBS>1.2</WBS><OutlineLevel>2</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>6</UID><ID>6</ID><Name>Excavation</Name><WBS>1.2.1</WBS><OutlineLevel>3</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>7</UID><ID>7</ID><Name>Subcampo 05 (Antes Subcampo 15)</Name><WBS>1.2.1.1</WBS><OutlineLevel>4</OutlineLevel><Summary>0</Summary>
      <Start>2026-02-01T08:00:00</Start><Finish>2026-02-10T17:00:00</Finish></Task>
    <Task><UID>8</UID><ID>8</ID><Name>Vía de acceso</Name><WBS>1.3</WBS><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-01T08:00:00</Start><Finish>2026-03-01T17:00:00</Finish></Task>
  </Tasks></Project>`;
  const plan = fromMsProjectXml(xml);
  const [a, b, c] = plan.activities;
  it("lee la fecha de estado, las líneas base y el avance (sin confundir sus fechas con las del plan)", () => {
    expect(plan.statusDate).toBe("2026-02-15");
    expect(a).toMatchObject({ start: "2026-01-05", finish: "2026-01-20", progress: { pct: 40, actualStart: "2026-01-08", actualFinish: null } });
    expect(a!.baselines).toEqual([
      { name: "Línea base", start: "2025-12-01", finish: "2025-12-15" },
      { name: "Línea base 1", start: "2025-12-10", finish: "2025-12-24" },
    ]);
    expect(b!.progress).toBeNull();
  });
  it("toma el grupo del resumen (aclarado si se repite) y la zona del nombre", () => {
    expect(a).toMatchObject({ name: "Excavation › Subcampo 01", subfield: "SC01", workGroup: "DC Trenches › Excavation" });
    expect(b).toMatchObject({ subfield: "SC15", workGroup: "MV Trenches › Excavation" });
    // Sin resumen de grupo ni zona: su propio nombre
    expect(c).toMatchObject({ workGroup: "Vía de acceso", subfield: null });
  });
});

describe("Excel con grupo y zona", () => {
  it("lee las columnas opcionales Grupo y Tramo", () => {
    const plan = fromExcelRows({
      actividades: [
        ["Frente", "Código", "Nombre", "Unidad", "Cantidad", "Grupo", "Tramo"],
        ["VIA", "V-1", "Base granular K0-K1", "m3", 500, "Base granular", "K0-K1"],
      ],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.activities[0]).toMatchObject({ workGroup: "Base granular", subfield: "K0-K1" });
  });
});
