/**
 * Cuadre entre la cantidad reportada y lo marcado en el plano:
 * "Reportaste 20 y marcaste 15: faltan 5 por marcar".
 */

export type ReconcileState = "nothing_marked" | "no_quantity" | "match" | "missing" | "extra";

export interface Reconciliation {
  state: ReconcileState;
  /** marcado − reportado (negativo = faltan por marcar). */
  diff: number;
  message: string;
}

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

export function reconcile(reported: number | null, marked: number, unit: string): Reconciliation {
  if (marked <= 0) return { state: "nothing_marked", diff: 0, message: "" };
  if (reported === null || !Number.isFinite(reported))
    return { state: "no_quantity", diff: 0, message: `Marcaste ${fmt(marked)} ${unit}. Escribe la cantidad o usa la marcada.` };
  const diff = Math.round((marked - reported) * 1000) / 1000;
  if (diff === 0) return { state: "match", diff, message: `✓ Lo marcado coincide con lo reportado (${fmt(marked)} ${unit}).` };
  if (diff < 0)
    return {
      state: "missing",
      diff,
      message: `Reportaste ${fmt(reported)} y marcaste ${fmt(marked)}: faltan ${fmt(-diff)} ${unit} por marcar en el plano.`,
    };
  return {
    state: "extra",
    diff,
    message: `Reportaste ${fmt(reported)} y marcaste ${fmt(marked)}: marcaste ${fmt(diff)} ${unit} de más.`,
  };
}

/** Advertencias antes de guardar (no bloquean: el supervisor decide). */
export function saveWarnings(input: {
  quantity: number;
  unit: string;
  contractQty: number;
  executedBefore: number;
  marked: number;
  /** Registros del mismo usuario, actividad y fecha en los últimos minutos. */
  recentSame: { quantity: number; minutesAgo: number }[];
}): string[] {
  const w: string[] = [];
  const { quantity, unit, contractQty, executedBefore } = input;
  if (contractQty > 0 && executedBefore + quantity > contractQty)
    w.push(
      `Con este registro el acumulado sería ${fmt(executedBefore + quantity)} ${unit}, más que lo contratado (${fmt(contractQty)} ${unit}).`,
    );
  const r = reconcile(quantity, input.marked, unit);
  if (r.state === "missing" || r.state === "extra") w.push(r.message);
  const dup = input.recentSame.find((e) => e.quantity === quantity && e.minutesAgo <= 15);
  if (dup) w.push(`Hace ${Math.max(1, Math.round(dup.minutesAgo))} min ya guardaste ${fmt(quantity)} ${unit} en esta actividad. ¿Es un registro repetido?`);
  return w;
}
