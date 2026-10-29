import { describe, expect, it } from "vitest";
import { lossesFromLegacy, summarizeLosses } from "../src/core/losses";

describe("varias pérdidas de tiempo en un registro", () => {
  it("suma por causa, une las repetidas y elige la principal", () => {
    const s = summarizeLosses([
      { hours: "2", cause: "weather" },
      { hours: "1,5", cause: "material" },
      { hours: "0,5", cause: "weather" },
      { hours: "", cause: "none" },
    ]);
    expect(s.error).toBeNull();
    expect(s.lines).toEqual([{ cause: "weather", hours: 2.5 }, { cause: "material", hours: 1.5 }]);
    expect(s.total).toBe(4);
    expect(s.main).toBe("weather");
  });
  it("pide la causa y limita las horas", () => {
    expect(summarizeLosses([{ hours: "2", cause: "none" }]).error).toMatch(/indica la causa/);
    expect(summarizeLosses([{ hours: "30", cause: "weather" }]).error).toMatch(/entre 0 y 24/);
    expect(summarizeLosses([{ hours: "20", cause: "weather" }, { hours: "5", cause: "labor" }]).error).toMatch(/más de 24/);
  });
  it("sin pérdidas y borradores anteriores", () => {
    expect(summarizeLosses([])).toEqual({ lines: [], total: 0, main: "none", error: null });
    expect(lossesFromLegacy("3", "permits")).toEqual([{ hours: "3", cause: "permits" }]);
    expect(lossesFromLegacy("0", "none")).toEqual([]);
  });
});
