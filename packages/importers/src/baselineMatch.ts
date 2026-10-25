/**
 * Línea base de un cronograma (MS Project) para una obra que ya existe con otros códigos (p. ej. la
 * creada desde el informe Eiffage): se emparejan los grupos de trabajo de la obra con los del
 * cronograma y, dentro de cada grupo, cada zona (subcampo) con la suya.
 */
import type { ImportActivity } from "./model.js";

export interface ZonedActivity {
  id: string;
  workGroup: string | null;
  subfield: string | null;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Palabras equivalentes entre el informe (español) y el cronograma (inglés) de una planta solar
const SYNONYMS: [RegExp, RegExp][] = [
  [/hinca|hincado|pilote/, /ramming|pile|poles/],
  [/tracker|estructura|rack/, /rack|tracker|structure/],
  [/modulo|panel/, /module|pv modules/],
  [/movimiento de tierras|explanacion|desmonte/, /earthwork|clearing/],
  [/cimentacion|fundacion|cabin/, /foundation/],
  [/topograf/, /topograph/],
  [/tala|arbol|tree/, /tree/],
  [/cable solar|seriado|string/, /solar dc|string/],
  [/cableado bt.*excav|zanja.*bt|bt.*excavacion/, /dc trenches.*excavation/],
  [/cableado bt.*relleno|bt.*relleno/, /dc trenches.*backfill/],
  [/cableado bt.*tendido|bt.*tendido/, /lv cable/],
  [/mv.*excav|mt.*excav/, /mv trenches.*excavation/],
  [/mv.*relleno|mt.*relleno/, /mv trenches.*backfill/],
  [/mv.*tendido|mt.*tendido/, /mv cable/],
  [/ct.*montaje|inversor.*montaje|inverters.*montaje/, /installation of (ct|string inverters)/],
  [/conexionado|wiring/, /wiring/],
  [/prueba|vlf|test/, /test/],
  [/vallado|cerramiento|fence/, /fence/],
  [/drenaje|cuneta|odt|vado/, /drainage|odt|badenes/],
  [/via|road|subrasante|base/, /road|subrasante|subbase|base/],
];

/** Grupo del cronograma más parecido a un grupo de la obra (o null si ninguno se parece). */
export function suggestGroup(workGroup: string, scheduleGroups: string[]): string | null {
  const g = norm(workGroup);
  const exact = scheduleGroups.find((s) => norm(s) === g);
  if (exact) return exact;
  for (const [es, en] of SYNONYMS) {
    if (!es.test(g)) continue;
    const hit = scheduleGroups.find((s) => en.test(norm(s)));
    if (hit) return hit;
  }
  return null;
}

/**
 * Fechas de línea base para las actividades existentes: grupo emparejado + misma zona.
 * Sin zona, se toma la primera actividad del grupo emparejado que tampoco tenga zona.
 */
export function matchBaselines(schedule: ImportActivity[], existing: ZonedActivity[], groupMap: Record<string, string>) {
  const rows: { activityId: string; baseline: string; start: string | null; finish: string | null }[] = [];
  for (const a of existing) {
    const target = a.workGroup ? groupMap[a.workGroup] : undefined;
    if (!target) continue;
    const src = schedule.find((s) => s.workGroup === target && (s.subfield ?? null) === (a.subfield ?? null) && s.baselines?.length);
    for (const b of src?.baselines ?? []) rows.push({ activityId: a.id, baseline: b.name, start: b.start, finish: b.finish });
  }
  return rows;
}
