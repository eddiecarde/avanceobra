import { useSyncExternalStore } from "react";

/**
 * Selección compartida entre la pantalla de captura y el plano: el supervisor marca en el
 * plano los elementos o el área trabajada y vuelve a la captura con la selección hecha.
 * `reportedQty` viaja al plano para mostrar el cuadre "faltan 5 por marcar".
 * La persistencia en disco la hace el borrador de la captura (captureDraft).
 */
export interface PlanSelection {
  activityId: string | null;
  elementIds: string[];
  area: { geojson: string; areaM2: number } | null;
  reportedQty: number | null;
  unit: string;
}

const EMPTY: PlanSelection = { activityId: null, elementIds: [], area: null, reportedQty: null, unit: "" };
let state: PlanSelection = EMPTY;
const listeners = new Set<() => void>();

function set(next: Partial<PlanSelection>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const planSelection = {
  get: () => state,
  start(activityId: string, unit = "") {
    if (state.activityId !== activityId) state = { ...EMPTY, activityId, unit };
    else state = { ...state, unit: unit || state.unit };
    listeners.forEach((l) => l());
  },
  /** Restaura lo guardado en un borrador. */
  restore(activityId: string, elementIds: string[], area: PlanSelection["area"]) {
    set({ activityId, elementIds, area });
  },
  toggleElement(id: string) {
    const has = state.elementIds.includes(id);
    set({ elementIds: has ? state.elementIds.filter((x) => x !== id) : [...state.elementIds, id] });
  },
  addElements(ids: string[]) {
    set({ elementIds: [...new Set([...state.elementIds, ...ids])] });
  },
  setElements(ids: string[]) {
    set({ elementIds: ids });
  },
  setArea(area: PlanSelection["area"]) {
    set({ area });
  },
  setReported(q: number | null) {
    if (q !== state.reportedQty) set({ reportedQty: q });
  },
  clear() {
    state = EMPTY;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function usePlanSelection(): PlanSelection {
  return useSyncExternalStore(planSelection.subscribe, planSelection.get, planSelection.get);
}
