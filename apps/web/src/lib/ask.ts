import { REPORT_STATUS_LABEL, type DailyAnalysis, type WeeklyAnalysis } from "@avanceobra/engine";
import { FINDING_TYPE_LABEL, LOSS_LABEL, SEVERITY_LABEL, type DashData } from "./dashboard";
import { dmy } from "./report";

export interface ConstraintRow {
  id: string;
  description: string;
  responsible: string | null;
  need_by: string | null;
  status: string;
  created_at: string;
}

const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const pct = (x: number) => `${(x * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;
const pts = (x: number) => `${x > 0 ? "+" : ""}${x.toLocaleString("es-CO", { maximumFractionDigits: 1 })} pts`;

/** Frentes con actividades en curso que no tienen ningún registro de avance en el día. */
export function frontsWithoutReport(data: DashData, a: DailyAnalysis) {
  const active = new Map<string, string>();
  for (const r of a.snapshot.rows)
    if (["atrasada", "sin_avance", "sin_registros", "en_riesgo", "al_dia"].includes(r.status) && r.front) active.set(r.front, r.frontName ? `${r.front} · ${r.frontName}` : r.front);
  const reported = new Set(data.entries.filter((e) => e.workDate === a.day).map((e) => data.activities.find((x) => x.id === e.activityId)?.frontCode));
  return [...active.entries()].filter(([code]) => !reported.has(code)).map(([, label]) => label);
}

/**
 * Datos de la obra para responder preguntas (calculados por el motor, con los permisos de quien
 * pregunta). Las cifras van formateadas: la IA las copia y el servidor revisa que no invente otras.
 */
export function askFacts(data: DashData, a: DailyAnalysis, w: WeeklyAnalysis, constraints: ConstraintRow[]) {
  return {
    obra: data.project.name,
    corte: a.day,
    indicadores: {
      avance_real: pct(a.actual),
      avance_programado: pct(a.planned),
      desviacion: pts(a.deviationPts),
      fecha_contractual: a.contractEnd ? dmy(a.contractEnd) : "no registrada",
      fin_proyectado: a.projectedFinish ? dmy(a.projectedFinish) : "no calculable",
      dias_frente_a_contractual: a.finishDelay == null ? "no calculable" : String(a.finishDelay),
      actividades_por_estado: Object.fromEntries(Object.entries(a.snapshot.counts).map(([k, v]) => [REPORT_STATUS_LABEL[k as keyof typeof REPORT_STATUS_LABEL], v])),
    },
    actividades_que_requieren_atencion: a.priority.slice(0, 40).map((r) => ({
      codigo: r.code,
      nombre: r.name,
      frente: r.frontName ? `${r.front} · ${r.frontName}` : r.front,
      estado: REPORT_STATUS_LABEL[r.status],
      real: pct(r.actualPct),
      programado: pct(r.plannedPct),
      desviacion: pts(r.gapPts),
      pendiente: `${n1(r.pendingQty)} ${r.unit}`,
      ultimo_registro: r.lastUpdate ? dmy(r.lastUpdate) : "nunca",
      responsable: r.responsible ?? "no registrado",
      accion_sugerida: r.action,
    })),
    hoy: {
      registros: a.entries,
      produccion: a.snapshot.rows.filter((r) => r.periodQty !== 0).map((r) => ({ codigo: r.code, nombre: r.name, cantidad: `${n1(r.periodQty)} ${r.unit}` })),
      frentes_sin_reporte: frontsWithoutReport(data, a),
      horas_perdidas: a.lossesToday.map((l) => `${LOSS_LABEL[l.cause] ?? l.cause}: ${n1(l.hours)} h`),
    },
    semana: {
      periodo: `${dmy(w.weekStart)} a ${dmy(w.cutoff)}`,
      avance_ganado: pts(w.gainPts),
      avance_programado_en_la_semana: pts(w.plannedGainPts),
      avance_ganado_semana_anterior: w.prevGainPts == null ? "sin dato" : pts(w.prevGainPts),
      registros: w.entries,
      registros_semana_anterior: w.prevEntries,
      horas_perdidas: `${n1(w.lostHours)} h`,
      horas_perdidas_semana_anterior: `${n1(w.prevLostHours)} h`,
      causas: w.causes.map((c) => `${LOSS_LABEL[c.cause] ?? c.cause}: ${n1(c.hours)} h`),
      ritmo_frente_al_necesario: w.rateVsRequired.map((r) => ({ codigo: r.code, ritmo: `${n1(r.weekRate)} ${r.unit}/día`, necesario: `${n1(r.requiredRate)} ${r.unit}/día` })),
      terminadas: w.completed.map((r) => r.code),
    },
    hallazgos_abiertos: a.findings.open.slice(0, 40).map((f) => ({
      id: f.id.slice(0, 8),
      descripcion: f.description,
      tipo: FINDING_TYPE_LABEL[f.type] ?? f.type,
      severidad: SEVERITY_LABEL[f.severity] ?? f.severity,
      creado: dmy(f.createdAt),
      fecha_limite: f.dueDate ? dmy(f.dueDate) : "sin fecha",
      vencido: f.overdue ? "sí" : "no",
      impeditivo: f.impeditive ? "sí" : "no",
    })),
    restricciones_abiertas: constraints
      .filter((c) => c.status === "abierta")
      .slice(0, 30)
      .map((c) => ({
        id: c.id.slice(0, 8),
        descripcion: c.description,
        responsable: c.responsible ?? "no registrado",
        necesaria_para: c.need_by ? dmy(c.need_by) : "sin fecha",
        vencida: c.need_by && c.need_by < a.day ? "sí" : "no",
      })),
    _nota: `Actividades: ${data.activities.length} en total; se listan solo las que requieren atención (atrasadas, sin avance, sin registros o en riesgo).`,
  };
}
