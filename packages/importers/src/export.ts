/**
 * Exportar el avance real de vuelta al cronograma del programador:
 * - MS Project: XML (Archivo → Abrir → XML) con % completado, comienzo y fin reales.
 * - Primavera P6: hoja de cálculo para "Importar → Hoja de cálculo" que actualiza las actividades
 *   existentes por su ID (estado, % físico y fechas reales).
 * Lógica pura: recibe los datos ya calculados y devuelve texto o filas.
 */

export interface ExportActivity {
  code: string;
  name: string;
  unit: string;
  contractQty: number;
  frontCode: string;
  frontName: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  /** Días laborables del programa (para la duración en MS Project). */
  plannedDays: number | null;
  predecessors: string[];
  /** "msp:12" o "p6:345" si vino de un cronograma. */
  externalRef: string | null;
}

export interface ProgressPoint {
  date: string;
  quantity: number;
}

export interface ActivitySnapshot extends ExportActivity {
  executedQty: number;
  /** 0–1 */
  pct: number;
  actualStart: string | null;
  actualFinish: string | null;
  status: "not_started" | "in_progress" | "completed";
}

/** Avance de cada actividad a la fecha de corte (ejecutado, %, comienzo y fin reales). */
export function progressSnapshot(activities: ExportActivity[], progress: Map<string, ProgressPoint[]>, cutoff: string): ActivitySnapshot[] {
  return activities.map((a) => {
    const pts = (progress.get(a.code) ?? []).filter((p) => p.date <= cutoff && p.quantity > 0).sort((x, y) => x.date.localeCompare(y.date));
    const executed = pts.reduce((s, p) => s + p.quantity, 0);
    const pct = a.contractQty > 0 ? Math.min(1, executed / a.contractQty) : 0;
    // Día en que el acumulado alcanzó la cantidad contractual
    let finish: string | null = null;
    let cum = 0;
    for (const p of pts) {
      cum += p.quantity;
      if (a.contractQty > 0 && cum >= a.contractQty - 1e-9) {
        finish = p.date;
        break;
      }
    }
    return {
      ...a,
      executedQty: executed,
      pct,
      actualStart: pts[0]?.date ?? null,
      actualFinish: finish,
      status: finish ? "completed" : pts.length ? "in_progress" : "not_started",
    };
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtQty = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
const at = (d: string, hour: string) => `${d}T${hour}:00`;

/**
 * MS Project XML. Los frentes son tareas resumen; las actividades conservan su UID si vinieron de
 * MS Project (así se reconocen al combinar), y las nuevas reciben UID desde el mayor existente.
 */
export function toMsProjectXml(input: { projectName: string; cutoff: string; activities: ActivitySnapshot[]; hoursPerDay?: number }): string {
  const hpd = input.hoursPerDay ?? 8;
  const usedUids = new Set(input.activities.map((a) => /^msp:(\d+)$/.exec(a.externalRef ?? "")?.[1]).filter(Boolean).map(Number));
  let next = Math.max(0, ...usedUids) + 1;
  const newUid = () => {
    while (usedUids.has(next)) next++;
    usedUids.add(next);
    return next++;
  };
  const uidOf = new Map(input.activities.map((a) => [a.code, Number(/^msp:(\d+)$/.exec(a.externalRef ?? "")?.[1]) || 0]));
  for (const a of input.activities) if (!uidOf.get(a.code)) uidOf.set(a.code, newUid());

  const fronts = [...new Map(input.activities.map((a) => [a.frontCode, a.frontName])).entries()];
  const tasks: string[] = [];
  let id = 1;
  tasks.push(`<Task><UID>0</UID><ID>0</ID><Name>${esc(input.projectName)}</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>`);
  fronts.forEach(([fCode, fName], fi) => {
    tasks.push(
      `<Task><UID>${newUid()}</UID><ID>${id++}</ID><Name>${esc(fName)}</Name><WBS>${fi + 1}</WBS><OutlineNumber>${fi + 1}</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Manual>0</Manual></Task>`,
    );
    input.activities
      .filter((a) => a.frontCode === fCode)
      .forEach((a, ai) => {
        const parts = [
          `<UID>${uidOf.get(a.code)}</UID>`,
          `<ID>${id++}</ID>`,
          `<Name>${esc(a.name)}</Name>`,
          `<WBS>${fi + 1}.${ai + 1}</WBS>`,
          `<OutlineNumber>${fi + 1}.${ai + 1}</OutlineNumber>`,
          `<OutlineLevel>2</OutlineLevel>`,
          `<Summary>0</Summary>`,
          `<Milestone>0</Milestone>`,
          `<Manual>0</Manual>`,
        ];
        if (a.plannedStart) parts.push(`<Start>${at(a.actualStart ?? a.plannedStart, "08:00")}</Start>`);
        if (a.plannedFinish) parts.push(`<Finish>${at(a.actualFinish ?? a.plannedFinish, "17:00")}</Finish>`);
        if (a.plannedDays) parts.push(`<Duration>PT${a.plannedDays * hpd}H0M0S</Duration><DurationFormat>7</DurationFormat>`);
        parts.push(`<PercentComplete>${Math.round(a.pct * 100)}</PercentComplete>`, `<PhysicalPercentComplete>${Math.round(a.pct * 100)}</PhysicalPercentComplete>`);
        if (a.actualStart) parts.push(`<ActualStart>${at(a.actualStart, "08:00")}</ActualStart>`);
        if (a.actualFinish) parts.push(`<ActualFinish>${at(a.actualFinish, "17:00")}</ActualFinish>`);
        parts.push(
          `<Notes>${esc(`${a.code}: ejecutado ${fmtQty(a.executedQty)} de ${fmtQty(a.contractQty)} ${a.unit} al ${input.cutoff} (AvanceObra)`)}</Notes>`,
        );
        for (const p of a.predecessors) {
          const u = uidOf.get(p);
          if (u) parts.push(`<PredecessorLink><PredecessorUID>${u}</PredecessorUID><Type>1</Type></PredecessorLink>`);
        }
        tasks.push(`<Task>${parts.join("")}</Task>`);
      });
  });

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    `<Name>${esc(input.projectName)}.xml</Name>`,
    `<Title>${esc(input.projectName)}</Title>`,
    `<StatusDate>${at(input.cutoff, "17:00")}</StatusDate>`,
    `<CurrentDate>${at(input.cutoff, "17:00")}</CurrentDate>`,
    "<ScheduleFromStart>1</ScheduleFromStart>",
    `<MinutesPerDay>${(input.hoursPerDay ?? 8) * 60}</MinutesPerDay>`,
    "<Tasks>",
    ...tasks,
    "</Tasks>",
    "</Project>",
  ].join("\n");
}

export const P6_STATUS: Record<ActivitySnapshot["status"], string> = { not_started: "TK_NotStart", in_progress: "TK_Active", completed: "TK_Complete" };

/**
 * Hoja TASK para importar en Primavera P6 (Archivo → Importar → Hoja de cálculo, "Actualizar
 * existentes"): fila 1 con los nombres de campo de P6, fila 2 con los títulos, luego una fila por
 * actividad. El ID de actividad (task_code) es el código de la actividad en AvanceObra.
 */
export function toP6Rows(activities: ActivitySnapshot[]): { fields: string[]; titles: string[]; rows: (string | number | null)[][] } {
  const fields = ["task_code", "task_name", "status_code", "act_start_date", "act_end_date", "phys_complete_pct"];
  const titles = ["Activity ID", "Activity Name", "Activity Status", "Actual Start", "Actual Finish", "Physical % Complete"];
  const rows = activities.map((a) => [
    a.code,
    a.name,
    P6_STATUS[a.status],
    a.actualStart,
    a.actualFinish,
    Math.round(a.pct * 1000) / 10,
  ]);
  return { fields, titles, rows };
}
