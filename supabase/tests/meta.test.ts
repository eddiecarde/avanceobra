import { describe, expect, it } from "vitest";
import {
  collectSse,
  confidentBoxes,
  normalizeDefect,
  normalizeReport,
  numbersIn,
  parseSamOutput,
  samConcept,
  stripFences,
  transcriptText,
  ungroundedNumbers,
  verifyStatus,
  type ReportContext,
} from "../functions/_shared/meta.ts";

const ctx: ReportContext = {
  fronts: [{ code: "SC3", name: "Subcampo 3" }],
  activities: [
    { code: "FV-03", name: "Hincado de pilotes", unit: "und", front_code: "SC3" },
    { code: "FV-05", name: "Montaje de módulos", unit: "und", front_code: "SC3" },
  ],
  roles: ["Oficial", "Ayudante"],
  equipment: ["Hincadora"],
};

describe("SAM 3.1", () => {
  it("lee las cajas, el tamaño y la confianza de la salida", () => {
    const text =
      "<0f>0<|box;x1=181;y1=365;x2=556;y2=486;w=1516;h=1600;c=0.91|><|mask;x=0;y=0;c=0.9;data=12,30,!abc|>," +
      "1<|box;x1=10;y1=20;x2=40;y2=60;w=1516;h=1600;c=0.3|><|mask;x=0;y=0;data=1,1,!a|>";
    const r = parseSamOutput(text);
    expect(r.boxes).toHaveLength(2);
    expect(r.boxes[0]).toEqual({ x1: 181, y1: 365, x2: 556, y2: 486, c: 0.91 });
    expect(r.width).toBe(1516);
    expect(r.height).toBe(1600);
    expect(confidentBoxes(r)).toHaveLength(1);
  });

  it("sin coincidencias no es un error", () => {
    expect(parseSamOutput("")).toEqual({ boxes: [], width: null, height: null });
  });

  it("junta los deltas del stream SSE", () => {
    const raw = [
      'data: {"type":"response.created"}',
      'data: {"type":"response.output_text.delta","delta":"<0f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10|>"}',
      "data: no-json",
      'data: {"type":"response.completed"}',
      "data: [DONE]",
    ].join("\n");
    expect(parseSamOutput(collectSse(raw)).boxes).toHaveLength(1);
  });

  it("elige el concepto según la actividad", () => {
    expect(samConcept({ name: "Hincado de pilotes" })).toBe("metal post");
    expect(samConcept({ name: "Montaje de módulos FV" })).toBe("solar panel");
    expect(samConcept({ name: "Montaje de trackers" })).toBe("triangular steel bracket");
    expect(samConcept({ name: "Excavación de zanjas" })).toBeNull();
    expect(samConcept({ name: "Lo que sea", ai_count_prompt: "fence post" })).toBe("fence post");
  });
});

describe("dictamen de la foto", () => {
  it("sin fotos o sin elementos visibles = sin evidencia", () => {
    expect(verifyStatus({ count: null, reported: 10, matchesActivity: true, photos: 0 })).toBe("sin_evidencia");
    expect(verifyStatus({ count: 0, reported: 10, matchesActivity: true, photos: 2 })).toBe("sin_evidencia");
  });
  it("revisar cuando lo reportado cabe en la foto y se ve menos de la mitad", () => {
    expect(verifyStatus({ count: 4, reported: 12, matchesActivity: true, photos: 1 })).toBe("revisar");
    expect(verifyStatus({ count: 8, reported: 12, matchesActivity: true, photos: 1 })).toBe("consistente");
  });
  it("mucho reportado no se castiga por una foto parcial", () => {
    expect(verifyStatus({ count: 30, reported: 120, matchesActivity: true, photos: 1 })).toBe("consistente");
  });
  it("foto de otra cosa = revisar", () => {
    expect(verifyStatus({ count: 30, reported: 30, matchesActivity: false, photos: 1 })).toBe("revisar");
  });
});

describe("parte por voz", () => {
  it("deja solo códigos que existen y manda lo demás a revisar", () => {
    const r = normalizeReport(
      {
        front_code: "sc3",
        progress: [
          { activity_code: "fv-03", quantity: 120, note: "" },
          { activity_code: "XX-99", quantity: 5, note: "" },
          { activity_code: "FV-05", quantity: -3, note: "" },
        ],
        personnel: [{ role: "Oficial", qty: 4 }, { role: "", qty: 2 }, { role: "Ayudante", qty: 0 }],
        equipment: [{ name: "Hincadora", qty: 2 }],
        rain: [{ start: "10:00", end: "11:00" }, { start: "9:5", end: "x" }, { start: "15:00", end: "14:00" }],
        findings: [{ description: "Pilote torcido en la fila 4", type: "quality", severity: "rarísima" }],
        observations: " Llegó material tarde ",
        unmatched: [],
      },
      ctx,
    );
    expect(r.front_code).toBe("SC3");
    expect(r.progress).toEqual([{ activity_code: "FV-03", quantity: 120, note: "" }]);
    expect(r.unmatched[0]).toContain("XX-99");
    expect(r.personnel).toEqual([{ role: "Oficial", qty: 4 }]);
    expect(r.rain).toEqual([{ start: "10:00", end: "11:00" }]);
    expect(r.findings[0].severity).toBe("medium");
    expect(r.observations).toBe("Llegó material tarde");
  });

  it("aguanta una respuesta vacía o rota", () => {
    const r = normalizeReport(null, ctx);
    expect(r.progress).toEqual([]);
    expect(r.front_code).toBeNull();
  });

  it("une la transcripción por turnos", () => {
    expect(transcriptText("A:hoy hincamos\nB: ciento veinte pilotes\n")).toBe("hoy hincamos ciento veinte pilotes");
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe("defectos", () => {
  it("normaliza tipo y severidad", () => {
    const d = normalizeDefect({ is_defect: true, type: "x", severity: "high", title: "Óxido en pilote", description: "d", corrective_action: "c", sam_concept: "rust" });
    expect(d.type).toBe("quality");
    expect(d.severity).toBe("high");
    expect(d.sam_concept).toBe("rust");
  });
});

describe("resumen con datos reales", () => {
  it("lee cifras con formato colombiano", () => {
    expect(numbersIn("Multa de $ 100.000.000 y avance de 62,3 % en 14 días")).toEqual([100000000, 62.3, 14]);
  });
  it("detecta una cifra que no está en los datos", () => {
    const facts = { avance: "62,3 %", atraso_dias: 14, multa: "$ 100.000.000" };
    expect(ungroundedNumbers("La obra va en 62,3 % con 14 días de atraso; multa $ 100.000.000. Tres acciones: 1, 2 y 3.", facts)).toEqual([]);
    expect(ungroundedNumbers("La obra va en 65 % y la multa sería $ 120.000.000", facts)).toEqual([65, 120000000]);
  });
});
