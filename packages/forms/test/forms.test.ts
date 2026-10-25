import { describe, expect, it } from "vitest";
import {
  computeFormulas,
  evaluateFormula,
  formulaRefs,
  fromSheetRows,
  isVisible,
  newField,
  parseFormula,
  pruneHidden,
  sameDefinition,
  slugId,
  TEMPLATES,
  toSheetRows,
  validateAnswers,
  validateDefinition,
  type FormDefinition,
} from "../src/index.js";

const tpl = (key: string) => TEMPLATES.find((t) => t.key === key)!.definition;

describe("plantillas precargadas", () => {
  it.each(TEMPLATES.map((t) => [t.key, t.definition] as const))("%s es un formato válido", (_k, def) => {
    const r = validateDefinition(def);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("cubren solar y los demás tipos de obra", () => {
    const types = new Set(TEMPLATES.map((t) => t.definition.workType));
    for (const w of ["solar", "civil", "vial", "redes", "edificacion", "general"]) expect(types.has(w)).toBe(true);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(12);
  });
});

describe("fórmulas", () => {
  it("aritmética, precedencia, potencias y funciones", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("2 ^ 3 ^ 2", {})).toBe(512);
    expect(evaluateFormula("-3 + abs(-5)", {})).toBe(2);
    expect(evaluateFormula("round(10 / 3, 2)", {})).toBe(3.33);
    expect(evaluateFormula("if(a > 5, 1, 2)", { a: 7 })).toBe(1);
    expect(evaluateFormula("max(a, b, 3)", { a: 1, b: "4,5" })).toBe(4.5);
  });
  it("campos faltantes o división por cero dan vacío, no error", () => {
    expect(evaluateFormula("a * b", { a: 2 })).toBeNaN();
    expect(evaluateFormula("a / b", { a: 2, b: 0 })).toBeNaN();
  });
  it("agregados sobre tablas", () => {
    const v = { cil: [{ r: 20 }, { r: 22 }, { r: "" }, { r: 24 }] };
    expect(evaluateFormula("sum(cil.r)", v)).toBe(66);
    expect(evaluateFormula("avg(cil.r)", v)).toBe(22);
    expect(evaluateFormula("count(cil)", v)).toBe(4);
    expect(evaluateFormula("minof(cil.r) + maxof(cil.r)", v)).toBe(44);
  });
  it("no ejecuta código: solo números, campos y funciones permitidas", () => {
    expect(() => parseFormula("process.exit()")).toThrow(/Función desconocida/);
    expect(() => parseFormula("a; b")).toThrow(/no permitido/);
    expect(() => parseFormula("constructor('x')")).toThrow(/no permitido/);
    expect(() => parseFormula("constructor(1)")).toThrow(/Función desconocida/);
    expect(() => parseFormula("(1 + 2")).toThrow(/paréntesis/);
    expect(() => parseFormula("")).toThrow(/vacía/);
    expect(formulaRefs("round(avg(cilindros.carga) / resistencia, 1)").sort()).toEqual(["cilindros", "resistencia"]);
  });
});

describe("lógica condicional y cálculo", () => {
  const def = tpl("tierras");
  it("muestra la compactación solo si es relleno", () => {
    const comp = def.fields.find((f) => f.id === "compactacion")!;
    expect(isVisible(comp, { tipo: "excavacion" })).toBe(false);
    expect(isVisible(comp, { tipo: "relleno" })).toBe(true);
  });
  it("calcula el volumen en banco", () => {
    expect(computeFormulas(def, { viajes: 40, capacidad: 14, esponjamiento: 1.25 }).volumen_banco).toBe(448);
  });
  it("concreto: % de f'c con promedio de cilindros", () => {
    const v = computeFormulas(tpl("concreto"), { resistencia: 21, cilindros: [{ carga: 20 }, { carga: 23 }] });
    expect(v.cumplimiento).toBe(102.4);
  });
  it("QA/QC: cuenta los ítems no conformes", () => {
    const v = computeFormulas(tpl("qaqc"), { items: [{ conforme: true }, { conforme: false }, {}] });
    expect(v.no_conformes).toBe(2);
  });
});

describe("validación de respuestas", () => {
  it("obligatorios solo si el campo está visible", () => {
    const sst = tpl("sst_charla");
    const base = { tema: "Alturas", asistentes: 12, epp: "si", firma: "file://f.png" };
    expect(validateAnswers(sst, base).ok).toBe(true);
    const r = validateAnswers(sst, { ...base, trabajo_alturas: true });
    expect(r.errors).toEqual({ permiso_alturas: "Obligatorio" });
  });
  it("rangos bloquean y tolerancias solo advierten", () => {
    const c = tpl("concreto");
    const base = { elemento: "Zapata Z-1", resistencia: 21, volumen: 8, slump: 6.5, temperatura: 45 };
    const r = validateAnswers(c, base);
    expect(r.errors.temperatura).toBe("Máximo 40 °C");
    expect(r.warnings.slump).toBe("Fuera de tolerancia: 6,5 pulg (admisible 3 a 5)");
    expect(r.ok).toBe(false);
  });
  it("valida cada fila de una tabla y las tolerancias de sus columnas", () => {
    const h = tpl("solar_hincado");
    const r = validateAnswers(h, { pilotes: [{ codigo: "A-T01-P1", profundidad: 1.85, verticalidad: 0.5 }, { profundidad: 1.5, verticalidad: 2.2 }] });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.warnings).sort()).toEqual(["pilotes[1].profundidad", "pilotes[1].verticalidad"]);
    expect(validateAnswers(h, {}).errors.pilotes).toBe("Agrega al menos una fila");
  });
  it("elimina respuestas de campos que quedaron ocultos", () => {
    expect(pruneHidden(tpl("tierras"), { tipo: "excavacion", compactacion: 95, viajes: 3 })).toEqual({ tipo: "excavacion", viajes: 3 });
  });
});

describe("validación del formato (constructor)", () => {
  const base: FormDefinition = { schemaVersion: 1, name: "Prueba", category: "avance", workType: "solar", fields: [{ id: "a", label: "A", type: "number" }] };
  it("detecta ids repetidos, fórmulas rotas, ciclos y condiciones hacia adelante", () => {
    const bad = {
      ...base,
      fields: [
        { id: "a", label: "A", type: "number" },
        { id: "a", label: "A2", type: "number" },
        { id: "x", label: "X", type: "formula", expression: "y + 1" },
        { id: "y", label: "Y", type: "formula", expression: "x + 1" },
        { id: "z", label: "Z", type: "formula", expression: "noexiste * 2" },
        { id: "w", label: "W", type: "text", showIf: { field: "v", op: "truthy" } },
        { id: "v", label: "V", type: "checkbox" },
      ],
    };
    const msgs = validateDefinition(bad).issues.map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"a" está repetido'),
        expect.stringContaining('usa "noexiste"'),
        expect.stringContaining("ciclo"),
        expect.stringContaining("campo anterior"),
      ]),
    );
  });
  it("rechaza estructura inválida con mensajes legibles", () => {
    const r = validateDefinition({ ...base, fields: [{ id: "Mal Id", label: "", type: "number" }] });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toMatch(/fields\.0\.id/);
  });
  it("campos nuevos con id único y versiones idénticas detectadas", () => {
    expect(slugId("Profundidad final (m)", [])).toBe("profundidad_final_m");
    expect(slugId("Ñandú", ["nandu"])).toBe("nandu_2");
    expect(newField("select", ["lista"]).id).toBe("lista_2");
    expect(sameDefinition(base, JSON.parse(JSON.stringify(base)))).toBe(true);
    expect(sameDefinition(base, { ...base, name: "Otro" })).toBe(false);
  });
});

describe("Excel ida y vuelta", () => {
  it.each(["concreto", "solar_hincado", "sst_charla", "informe_diario"])("%s se conserva al exportar e importar", (key) => {
    const def = tpl(key);
    const rows = toSheetRows(def);
    expect(rows[0]![0]).toBe("id");
    const back = fromSheetRows(JSON.parse(JSON.stringify(rows)), { name: def.name, category: def.category, workType: def.workType });
    const r = validateDefinition(back);
    expect(r.issues).toEqual([]);
    expect(r.definition!.fields.map((f) => f.id)).toEqual(def.fields.map((f) => f.id));
    // misma lógica: la fórmula da lo mismo
    expect(computeFormulas(r.definition!, { resistencia: 21, cilindros: [{ carga: 21 }] })).toEqual(
      computeFormulas(def, { resistencia: 21, cilindros: [{ carga: 21 }] }),
    );
  });
  it("opciones escritas a mano en Excel", () => {
    const rows = [
      ["id", "etiqueta", "tipo", "opciones", "obligatorio"],
      ["", "Estado del equipo", "select", "Operando; Varado; En espera", "sí"],
    ];
    const r = validateDefinition(fromSheetRows(rows, { name: "Equipos", category: "checklist", workType: "general" }));
    expect(r.ok).toBe(true);
    const f = r.definition!.fields[0]!;
    expect(f).toMatchObject({ id: "estado_del_equipo", required: true, options: [{ value: "operando", label: "Operando" }, { value: "varado", label: "Varado" }, { value: "en_espera", label: "En espera" }] });
  });
});
