import { describe, expect, it } from "vitest";
import { companyCompliance, docState, workerCompliance } from "../src/index.js";

const today = "2026-10-27";

describe("seguridad social y SST al día", () => {
  it("estado de un documento: vigente, por vencer (15 días) o vencido", () => {
    expect(docState(null, today)).toBe("ok");
    expect(docState("2026-12-31", today)).toBe("ok");
    expect(docState("2026-11-10", today)).toBe("soon");
    expect(docState("2026-10-26", today)).toBe("expired");
  });

  it("trabajador: bloqueado si falta o venció un obligatorio; vale el documento más reciente", () => {
    const docs = [
      { docType: "arl", expiresOn: null },
      { docType: "eps", expiresOn: null },
      { docType: "examen_medico", expiresOn: "2026-01-01" },
      { docType: "examen_medico", expiresOn: "2027-01-01" },
      { docType: "induccion", expiresOn: "2026-11-05" },
    ];
    expect(workerCompliance({ worksAtHeight: false }, docs, today)).toEqual({
      status: "soon",
      missing: [],
      expired: [],
      soon: [{ docType: "induccion", expiresOn: "2026-11-05" }],
    });
    // Si trabaja en alturas le falta el curso
    expect(workerCompliance({ worksAtHeight: true }, docs, today)).toMatchObject({ status: "blocked", missing: ["alturas"] });
    expect(workerCompliance({ worksAtHeight: false }, [{ docType: "arl", expiresOn: "2026-10-01" }], today)).toMatchObject({
      status: "blocked",
      missing: ["eps", "examen_medico", "induccion"],
      expired: ["arl"],
    });
  });

  it("empresa: la planilla del mes vigente", () => {
    expect(companyCompliance([{ docType: "pila", expiresOn: "2026-10-31" }], today).status).toBe("soon");
    expect(companyCompliance([{ docType: "pila", expiresOn: "2026-09-30" }], today)).toMatchObject({ status: "blocked", expired: ["pila"] });
    expect(companyCompliance([], today)).toMatchObject({ status: "blocked", missing: ["pila"] });
  });
});
