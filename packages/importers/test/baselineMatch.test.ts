import { describe, expect, it } from "vitest";
import { matchBaselines, suggestGroup, type ImportActivity } from "../src/index.js";

const sched = (code: string, workGroup: string, subfield: string | null, start: string): ImportActivity => ({
  frontCode: "F1",
  code,
  name: code,
  unit: null,
  quantity: null,
  start: null,
  finish: null,
  predecessors: [],
  externalRef: null,
  workGroup,
  subfield,
  baselines: [{ name: "Línea base", start, finish: start }],
});

describe("línea base del cronograma sobre una obra existente", () => {
  const groups = ["Ramming of Poles (Direct Ramming)", "Assembly of Racks", "DC Trenches › Excavation", "DC Trenches › Backfilling", "LV cable"];
  it("sugiere el grupo del cronograma para cada grupo del informe", () => {
    expect(suggestGroup("Hincas", groups)).toBe("Ramming of Poles (Direct Ramming)");
    expect(suggestGroup("Trackers (omegas)", groups)).toBe("Assembly of Racks");
    expect(suggestGroup("Cableado BT (excavación)", groups)).toBe("DC Trenches › Excavation");
    expect(suggestGroup("Cableado BT (relleno)", groups)).toBe("DC Trenches › Backfilling");
    expect(suggestGroup("Cableado BT (tendido)", groups)).toBe("LV cable");
    expect(suggestGroup("CCTV", groups)).toBeNull();
  });
  it("asigna a cada actividad la línea base de su grupo y su subcampo", () => {
    const schedule = [sched("1", "Ramming of Poles (Direct Ramming)", "SC01", "2025-01-01"), sched("2", "Ramming of Poles (Direct Ramming)", "SC02", "2025-02-01")];
    const rows = matchBaselines(
      schedule,
      [
        { id: "h1", workGroup: "Hincas", subfield: "SC01" },
        { id: "h2", workGroup: "Hincas", subfield: "SC02" },
        { id: "h3", workGroup: "Hincas", subfield: "SC03" },
        { id: "x", workGroup: "CCTV", subfield: "SC01" },
      ],
      { Hincas: "Ramming of Poles (Direct Ramming)" },
    );
    expect(rows).toEqual([
      { activityId: "h1", baseline: "Línea base", start: "2025-01-01", finish: "2025-01-01" },
      { activityId: "h2", baseline: "Línea base", start: "2025-02-01", finish: "2025-02-01" },
    ]);
  });
});
