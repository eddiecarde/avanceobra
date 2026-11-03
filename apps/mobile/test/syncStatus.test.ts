import { describe, expect, it } from "vitest";
import { entrySync } from "../src/core/syncStatus";

describe("estado de subida de cada registro", () => {
  it("distingue guardado en el teléfono de recibido por el servidor", () => {
    expect(entrySync("e1", new Set(["e1"]), { total: 2, pending: 2, error: null }).state).toBe("telefono");
    expect(entrySync("e1", new Set(), { total: 2, pending: 1, error: null })).toMatchObject({ state: "fotos", label: expect.stringContaining("faltan 1 de 2") });
    expect(entrySync("e1", new Set(), { total: 2, pending: 1, error: "sin espacio" }).state).toBe("error");
    expect(entrySync("e1", new Set(), { total: 2, pending: 0, error: null }).label).toContain("con sus 2 foto(s)");
    expect(entrySync("e1", new Set(), undefined).state).toBe("recibido");
  });
});
