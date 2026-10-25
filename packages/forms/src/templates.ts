import type { FormDefinition } from "./schema.js";

/**
 * Plantillas precargadas y modificables. Cada empresa las copia a su catálogo y las ajusta
 * en el constructor; al publicar nace una versión propia (las plantillas no se tocan).
 */

const SI_NO = [
  { value: "si", label: "Sí" },
  { value: "no", label: "No" },
  { value: "na", label: "N/A" },
];
const CUMPLE = [
  { value: "cumple", label: "Cumple" },
  { value: "no_cumple", label: "No cumple" },
  { value: "na", label: "N/A" },
];

const T = (key: string, def: Omit<FormDefinition, "schemaVersion">): { key: string; definition: FormDefinition } => ({
  key,
  definition: { schemaVersion: 1, ...def },
});

export const TEMPLATES = [
  // ---------------- Solar fotovoltaica ----------------
  T("solar_hincado", {
    name: "Hincado de pilotes",
    category: "avance",
    workType: "solar",
    description: "Control de hincado por pilote: profundidad, verticalidad, rechazo y desplazamiento.",
    fields: [
      { id: "maquina", label: "Hincadora", type: "text" },
      { id: "perfil", label: "Perfil del pilote", type: "select", options: [{ value: "w6x9", label: "W6x9" }, { value: "w6x12", label: "W6x12" }, { value: "c150", label: "C150" }] },
      {
        id: "pilotes",
        label: "Pilotes hincados",
        type: "table",
        required: true,
        columns: [
          { id: "codigo", label: "Código / QR", type: "qr" },
          { id: "profundidad", label: "Profundidad", type: "number", unit: "m", decimals: 2, tolerance: { target: 1.8, minus: 0.1, plus: 0.3 } },
          { id: "verticalidad", label: "Verticalidad", type: "number", unit: "°", decimals: 1, tolerance: { target: 0, minus: 1.5, plus: 1.5 } },
          { id: "golpes", label: "Golpes último 30 cm", type: "number", min: 0 },
          { id: "rechazo", label: "Rechazo", type: "checkbox" },
        ],
      },
      { id: "total_pilotes", label: "Total pilotes", type: "formula", expression: "count(pilotes)", unit: "und" },
      { id: "con_rechazo", label: "Hubo rechazos", type: "checkbox" },
      { id: "accion_rechazo", label: "Acción tomada con los rechazos", type: "select", showIf: { field: "con_rechazo", op: "truthy" }, required: true, options: [{ value: "prebarrenado", label: "Prebarrenado" }, { value: "reubicacion", label: "Reubicación" }, { value: "consulta_diseno", label: "Consulta a diseño" }] },
      { id: "observaciones", label: "Observaciones", type: "text", multiline: true },
    ],
  }),
  T("solar_trackers", {
    name: "Montaje de trackers",
    category: "inspeccion",
    workType: "solar",
    fields: [
      { id: "tracker", label: "Tracker (QR)", type: "qr", required: true },
      { id: "alineacion", label: "Alineación de torque tube", type: "select", options: CUMPLE, required: true },
      { id: "torque_pernos", label: "Torque de pernos", type: "number", unit: "N·m", tolerance: { target: 80, minus: 5, plus: 10 }, required: true },
      { id: "amortiguadores", label: "Amortiguadores instalados", type: "select", options: SI_NO },
      { id: "motor", label: "Motor y controlador conectados", type: "select", options: SI_NO },
      { id: "foto", label: "Foto general", type: "photo", maxPhotos: 2 },
    ],
  }),
  T("solar_modulos", {
    name: "Instalación de módulos",
    category: "avance",
    workType: "solar",
    fields: [
      { id: "trackers", label: "Trackers completados", type: "number", unit: "und", min: 0 },
      { id: "modulos_por_tracker", label: "Módulos por tracker", type: "number", unit: "und", min: 1 },
      { id: "modulos", label: "Módulos instalados", type: "formula", expression: "trackers * modulos_por_tracker", unit: "und" },
      { id: "rotos", label: "Módulos rotos o rayados", type: "number", unit: "und", min: 0 },
      { id: "foto_rotos", label: "Foto de módulos dañados", type: "photo", showIf: { field: "rotos", op: "gt", value: 0 }, required: true },
    ],
  }),
  T("solar_cableado", {
    name: "Cableado y pruebas DC",
    category: "inspeccion",
    workType: "solar",
    fields: [
      { id: "string", label: "String / circuito", type: "text", required: true },
      { id: "metros", label: "Cable tendido", type: "number", unit: "m", min: 0 },
      { id: "voc", label: "Voc medido", type: "number", unit: "V", tolerance: { target: 1350, minus: 50, plus: 50 } },
      { id: "aislamiento", label: "Resistencia de aislamiento (megger)", type: "number", unit: "MΩ", min: 0, tolerance: { target: 1000, minus: 960, plus: 100000 } },
      { id: "polaridad", label: "Polaridad verificada", type: "checkbox", required: true },
      { id: "firma", label: "Firma del electricista", type: "signature" },
    ],
  }),
  // ---------------- Civil / vial ----------------
  T("tierras", {
    name: "Movimiento de tierras",
    category: "avance",
    workType: "civil",
    fields: [
      { id: "tipo", label: "Actividad", type: "select", required: true, options: [{ value: "excavacion", label: "Excavación" }, { value: "relleno", label: "Relleno" }, { value: "botada", label: "Retiro a botadero" }] },
      { id: "viajes", label: "Viajes de volqueta", type: "number", unit: "viajes", min: 0 },
      { id: "capacidad", label: "Capacidad por viaje", type: "number", unit: "m³", min: 0 },
      { id: "esponjamiento", label: "Factor de esponjamiento", type: "number", decimals: 2, min: 1, max: 2 },
      { id: "volumen_banco", label: "Volumen en banco", type: "formula", expression: "round(viajes * capacidad / esponjamiento, 1)", unit: "m³" },
      { id: "compactacion", label: "Compactación (% Proctor)", type: "number", unit: "%", showIf: { field: "tipo", op: "eq", value: "relleno" }, tolerance: { target: 97, minus: 2, plus: 3 } },
    ],
  }),
  T("concreto", {
    name: "Vaciado de concreto",
    category: "inspeccion",
    workType: "civil",
    description: "Fundida: volumen, asentamiento, temperatura y cilindros de ensayo.",
    fields: [
      { id: "elemento", label: "Elemento", type: "text", required: true },
      { id: "resistencia", label: "Resistencia de diseño (f'c)", type: "number", unit: "MPa", required: true },
      { id: "volumen", label: "Volumen vaciado", type: "number", unit: "m³", min: 0, required: true },
      { id: "slump", label: "Asentamiento (slump)", type: "number", unit: "pulg", decimals: 1, tolerance: { target: 4, minus: 1, plus: 1 }, required: true },
      { id: "temperatura", label: "Temperatura del concreto", type: "number", unit: "°C", max: 40, tolerance: { target: 25, minus: 15, plus: 7 } },
      {
        id: "cilindros",
        label: "Cilindros",
        type: "table",
        columns: [
          { id: "codigo", label: "Código", type: "text" },
          { id: "edad", label: "Edad de ensayo", type: "select", options: [{ value: "7", label: "7 días" }, { value: "14", label: "14 días" }, { value: "28", label: "28 días" }] },
          { id: "carga", label: "Resistencia obtenida", type: "number", unit: "MPa" },
        ],
      },
      { id: "cumplimiento", label: "% de f'c (promedio)", type: "formula", expression: "round(avg(cilindros.carga) / resistencia * 100, 1)", unit: "%" },
    ],
  }),
  T("vias_drenajes", {
    name: "Vías y drenajes",
    category: "avance",
    workType: "vial",
    fields: [
      { id: "abscisa_inicio", label: "Abscisa inicial", type: "text", required: true },
      { id: "abscisa_fin", label: "Abscisa final", type: "text", required: true },
      { id: "capa", label: "Capa", type: "select", options: [{ value: "subrasante", label: "Subrasante" }, { value: "subbase", label: "Subbase" }, { value: "base", label: "Base" }, { value: "carpeta", label: "Carpeta asfáltica" }] },
      { id: "longitud", label: "Longitud", type: "number", unit: "m", min: 0 },
      { id: "ancho", label: "Ancho", type: "number", unit: "m", min: 0 },
      { id: "espesor", label: "Espesor", type: "number", unit: "m", decimals: 2, min: 0 },
      { id: "volumen", label: "Volumen", type: "formula", expression: "round(longitud * ancho * espesor, 1)", unit: "m³" },
      { id: "cunetas", label: "Cunetas / alcantarillas instaladas", type: "number", unit: "m", min: 0 },
    ],
  }),
  T("redes_hidraulicas", {
    name: "Redes hidráulicas — prueba de presión",
    category: "inspeccion",
    workType: "redes",
    fields: [
      { id: "tramo", label: "Tramo", type: "text", required: true },
      { id: "diametro", label: "Diámetro", type: "number", unit: "pulg" },
      { id: "presion_prueba", label: "Presión de prueba", type: "number", unit: "psi", required: true },
      { id: "presion_final", label: "Presión al final (2 h)", type: "number", unit: "psi", required: true },
      { id: "caida", label: "Caída de presión", type: "formula", expression: "round((presion_prueba - presion_final) / presion_prueba * 100, 1)", unit: "%", tolerance: { target: 0, minus: 0, plus: 2 } },
      { id: "resultado", label: "Resultado", type: "select", options: [{ value: "aprobado", label: "Aprobado" }, { value: "rechazado", label: "Rechazado" }], required: true },
    ],
  }),
  T("acabados", {
    name: "Acabados",
    category: "inspeccion",
    workType: "edificacion",
    fields: [
      { id: "espacio", label: "Espacio / unidad", type: "text", required: true },
      { id: "item", label: "Ítem", type: "select", options: [{ value: "pintura", label: "Pintura" }, { value: "enchape", label: "Enchape" }, { value: "carpinteria", label: "Carpintería" }, { value: "aparatos", label: "Aparatos sanitarios" }] },
      { id: "plomo_nivel", label: "Plomo y nivel", type: "select", options: CUMPLE },
      { id: "terminacion", label: "Terminación", type: "select", options: CUMPLE },
      { id: "foto", label: "Foto", type: "photo" },
    ],
  }),
  // ---------------- Transversales ----------------
  T("sst_charla", {
    name: "SST — charla diaria y permisos",
    category: "checklist",
    workType: "general",
    fields: [
      { id: "tema", label: "Tema de la charla", type: "text", required: true },
      { id: "asistentes", label: "Número de asistentes", type: "number", unit: "personas", min: 0, required: true },
      { id: "epp", label: "EPP completo en el personal", type: "select", options: SI_NO, required: true },
      { id: "trabajo_alturas", label: "Hay trabajo en alturas hoy", type: "checkbox" },
      { id: "permiso_alturas", label: "Permiso de alturas firmado", type: "select", options: SI_NO, showIf: { field: "trabajo_alturas", op: "truthy" }, required: true },
      { id: "trabajo_caliente", label: "Hay trabajo en caliente hoy", type: "checkbox" },
      { id: "permiso_caliente", label: "Permiso de trabajo en caliente firmado", type: "select", options: SI_NO, showIf: { field: "trabajo_caliente", op: "truthy" }, required: true },
      { id: "foto", label: "Foto de la charla", type: "photo" },
      { id: "firma", label: "Firma del responsable SST", type: "signature", required: true },
    ],
  }),
  T("ambiental", {
    name: "Ambiental",
    category: "checklist",
    workType: "general",
    fields: [
      { id: "residuos", label: "Residuos clasificados", type: "select", options: CUMPLE, required: true },
      { id: "derrames", label: "Derrames de combustible o aceite", type: "checkbox" },
      { id: "kit_antiderrames", label: "Kit antiderrames usado", type: "select", options: SI_NO, showIf: { field: "derrames", op: "truthy" }, required: true },
      { id: "riego_vias", label: "Riego de vías (control de polvo)", type: "select", options: SI_NO },
      { id: "fauna", label: "Avistamiento / rescate de fauna", type: "text", multiline: true },
      { id: "ubicacion", label: "Ubicación", type: "gps" },
    ],
  }),
  T("qaqc", {
    name: "QA/QC — inspección general",
    category: "inspeccion",
    workType: "general",
    fields: [
      { id: "elemento", label: "Elemento inspeccionado", type: "text", required: true },
      { id: "plano", label: "Plano / especificación de referencia", type: "text" },
      {
        id: "items",
        label: "Ítems de control",
        type: "table",
        minRows: 1,
        columns: [
          { id: "item", label: "Ítem", type: "text" },
          { id: "conforme", label: "Conforme", type: "checkbox" },
          { id: "observacion", label: "Observación", type: "text" },
        ],
      },
      { id: "no_conformes", label: "Ítems no conformes", type: "formula", expression: "count(items) - sum(items.conforme)", unit: "und" },
      { id: "dictamen", label: "Dictamen", type: "select", options: [{ value: "liberado", label: "Liberado" }, { value: "observaciones", label: "Liberado con observaciones" }, { value: "rechazado", label: "Rechazado" }], required: true },
      { id: "firma", label: "Firma del inspector", type: "signature" },
    ],
  }),
  T("informe_diario", {
    name: "Informe diario de obra",
    category: "informe",
    workType: "general",
    fields: [
      { id: "s_general", label: "Generalidades", type: "section" },
      { id: "clima_manana", label: "Clima en la mañana", type: "select", options: [{ value: "seco", label: "Seco" }, { value: "lluvia", label: "Lluvia" }] },
      { id: "clima_tarde", label: "Clima en la tarde", type: "select", options: [{ value: "seco", label: "Seco" }, { value: "lluvia", label: "Lluvia" }] },
      { id: "s_personal", label: "Personal y equipos", type: "section" },
      { id: "personal_directo", label: "Personal directo", type: "number", unit: "personas", min: 0 },
      { id: "personal_sub", label: "Personal subcontratistas", type: "number", unit: "personas", min: 0 },
      { id: "personal_total", label: "Personal total", type: "formula", expression: "personal_directo + personal_sub", unit: "personas" },
      {
        id: "equipos",
        label: "Equipos en obra",
        type: "table",
        columns: [
          { id: "equipo", label: "Equipo", type: "text" },
          { id: "horas", label: "Horas trabajadas", type: "number", unit: "h", min: 0, max: 24 },
          { id: "estado", label: "Estado", type: "select", options: [{ value: "operando", label: "Operando" }, { value: "varado", label: "Varado" }, { value: "standby", label: "En espera" }] },
        ],
      },
      { id: "s_cierre", label: "Cierre", type: "section" },
      { id: "novedades", label: "Novedades del día", type: "text", multiline: true },
      { id: "firma_residente", label: "Firma del residente", type: "signature", required: true },
    ],
  }),
];

export type TemplateKey = (typeof TEMPLATES)[number]["key"];
