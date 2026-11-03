/**
 * Compara la programación importada con la obra existente: qué frentes y actividades se crean,
 * cuáles se actualizan (y qué campos cambian) y cuáles quedan igual. Nunca borra: lo que no
 * viene en el archivo se conserva, porque puede tener avance registrado.
 */
import type { ImportActivity, ImportPlan } from "./model.js";

export interface ExistingFront {
  id: string;
  code: string;
  name: string;
}

export interface ExistingActivity {
  id: string;
  frontId: string;
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  predecessorIds: string[];
  externalRef: string | null;
  /** Cantidad ya registrada en campo (enviada o aprobada): protege la unidad y la cantidad. */
  executedQty?: number;
  /** Costo directo presupuestado por unidad. */
  budgetUnitCost?: number | null;
}

export interface FieldChange {
  field: "frente" | "nombre" | "unidad" | "cantidad" | "inicio" | "fin" | "predecesoras" | "costo unitario";
  from: string;
  to: string;
}

export interface FrontOp {
  /** Código final (el existente si se emparejó por nombre). */
  code: string;
  fileCode: string;
  name: string;
  maxParallel: number | null;
  existingId: string | null;
  matchedBy: "code" | "name" | null;
}

export interface ActivityOp {
  activity: ImportActivity;
  /** Código del frente destino (ya traducido al existente). */
  frontCode: string;
  status: "new" | "update" | "same" | "blocked";
  existingId: string | null;
  changes: FieldChange[];
  problems: string[];
}

export interface ImportDiff {
  fronts: FrontOp[];
  activities: ActivityOp[];
  /** Actividades de la obra que no vienen en el archivo (se conservan). */
  untouched: ExistingActivity[];
  summary: { newFronts: number; newActivities: number; updated: number; same: number; blocked: number };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const fmtQty = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 3 });

export function diffImport(existing: { fronts: ExistingFront[]; activities: ExistingActivity[] }, plan: ImportPlan): ImportDiff {
  // Frentes: por código y, si no, por nombre (MS Project y Primavera no usan los mismos códigos)
  const fronts: FrontOp[] = plan.fronts.map((f) => {
    const byCode = existing.fronts.find((e) => e.code.toUpperCase() === f.code.toUpperCase());
    const byName = byCode ? null : existing.fronts.find((e) => norm(e.name) === norm(f.name));
    const ex = byCode ?? byName;
    return { code: ex?.code ?? f.code, fileCode: f.code, name: f.name, maxParallel: f.maxParallel ?? null, existingId: ex?.id ?? null, matchedBy: byCode ? "code" : byName ? "name" : null };
  });
  const frontCodeMap = new Map(fronts.map((f) => [f.fileCode, f.code]));
  const frontById = new Map(existing.fronts.map((f) => [f.id, f]));
  const actById = new Map(existing.activities.map((a) => [a.id, a]));
  // Las de la obra se emparejan por referencia externa (UID / task_id) y, si no, por código
  const byRef = new Map(existing.activities.filter((a) => a.externalRef).map((a) => [a.externalRef!, a]));
  const byCode = new Map(existing.activities.map((a) => [a.code.toUpperCase(), a]));
  const matched = new Set<string>();

  const activities: ActivityOp[] = plan.activities.map((a) => {
    const frontCode = frontCodeMap.get(a.frontCode) ?? a.frontCode;
    const ex = (a.externalRef ? byRef.get(a.externalRef) : undefined) ?? byCode.get(a.code.toUpperCase());
    const problems: string[] = [];
    if (!ex) {
      if (a.quantity == null) problems.push("Falta la cantidad contractual.");
      if (!a.unit) problems.push("Falta la unidad.");
      return { activity: a, frontCode, status: problems.length ? "blocked" : "new", existingId: null, changes: [], problems };
    }
    matched.add(ex.id);
    const changes: FieldChange[] = [];
    const exFront = frontById.get(ex.frontId)?.code ?? "";
    if (exFront && exFront.toUpperCase() !== frontCode.toUpperCase()) changes.push({ field: "frente", from: exFront, to: frontCode });
    if (a.name && a.name !== ex.name) changes.push({ field: "nombre", from: ex.name, to: a.name });
    if (a.unit && a.unit !== ex.unit) changes.push({ field: "unidad", from: ex.unit, to: a.unit });
    if (a.quantity != null && Math.abs(a.quantity - ex.contractQty) > 1e-9) changes.push({ field: "cantidad", from: fmtQty(ex.contractQty), to: fmtQty(a.quantity) });
    if (a.start && a.start !== ex.plannedStart) changes.push({ field: "inicio", from: ex.plannedStart ?? "—", to: a.start });
    if (a.finish && a.finish !== ex.plannedFinish) changes.push({ field: "fin", from: ex.plannedFinish ?? "—", to: a.finish });
    if (a.budgetUnitCost != null && Math.abs(a.budgetUnitCost - (ex.budgetUnitCost ?? -1)) > 1e-6)
      changes.push({ field: "costo unitario", from: ex.budgetUnitCost == null ? "—" : fmtQty(ex.budgetUnitCost), to: fmtQty(a.budgetUnitCost) });
    // Lo que ya tiene avance no se puede deformar por importación
    const executed = ex.executedQty ?? 0;
    if (executed > 0 && a.unit && a.unit !== ex.unit)
      problems.push(`Cambia la unidad (${ex.unit} → ${a.unit}) y ya tiene ${fmtQty(executed)} ${ex.unit} registrados: corrígela en el archivo o en la obra, no por importación.`);
    if (a.quantity != null && a.quantity < executed - 1e-9)
      problems.push(`La cantidad nueva (${fmtQty(a.quantity)}) es menor que lo ya ejecutado (${fmtQty(executed)} ${ex.unit}).`);
    const exPreds = ex.predecessorIds.map((id) => actById.get(id)?.code ?? "?").sort();
    const newPreds = [...a.predecessors].sort();
    if (exPreds.join(",") !== newPreds.join(",")) changes.push({ field: "predecesoras", from: exPreds.join(", ") || "ninguna", to: newPreds.join(", ") || "ninguna" });
    return { activity: a, frontCode, status: problems.length ? "blocked" : changes.length ? "update" : "same", existingId: ex.id, changes, problems };
  });

  const untouched = existing.activities.filter((a) => !matched.has(a.id));
  return {
    fronts,
    activities,
    untouched,
    summary: {
      newFronts: fronts.filter((f) => !f.existingId).length,
      newActivities: activities.filter((a) => a.status === "new").length,
      updated: activities.filter((a) => a.status === "update").length,
      same: activities.filter((a) => a.status === "same").length,
      blocked: activities.filter((a) => a.status === "blocked").length,
    },
  };
}
