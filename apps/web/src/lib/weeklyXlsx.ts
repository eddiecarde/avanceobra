"use client";

import { addDays } from "@avanceobra/engine";
import type { Worksheet } from "exceljs";
import { executionDays, TEST_STATUS_LABEL, weekLabel, WEATHER_LABEL, type WeeklyReport } from "./weekly";

const BLUE = "FF1F4E79";
const LIGHT = "FFDDEBF7";
const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const DAY = ["L", "M", "M", "J", "V", "S", "D"];
const isoDate = (d: string) => new Date(`${d}T00:00:00Z`);

function title(ws: Worksheet, row: number, text: string, cols: number, opts: { fill?: string; size?: number } = {}) {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size: opts.size ?? 11, color: { argb: opts.fill ? "FFFFFFFF" : "FF000000" } };
  c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
}

function header(ws: Worksheet, row: number, values: (string | null)[], fill = BLUE) {
  values.forEach((v, i) => {
    const c = ws.getCell(row, i + 1);
    if (v !== null) c.value = v;
    c.font = { bold: true, color: { argb: fill === BLUE ? "FFFFFFFF" : "FF000000" }, size: 9 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = border;
  });
}

function cells(ws: Worksheet, row: number, values: unknown[], fmt: (string | undefined)[] = []) {
  values.forEach((v, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = v as never;
    c.border = border;
    c.font = { size: 9 };
    if (fmt[i]) c.numFmt = fmt[i]!;
  });
}

/**
 * Informe semanal con las 4 hojas del formato del cliente (CNX-PSS-001 para Helios):
 * REPORTE SEMANAL, EJECUTADO, % y SEGUIMIENTO SEMANAL. Valores calculados por la app (no fórmulas).
 */
export async function exportWeeklyXlsx(r: WeeklyReport): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AvanceObra";
  const { data, progress, week, weekPos } = r;
  const h = data.project.header;
  const acts = progress.rows;

  // ---------- REPORTE SEMANAL ----------
  const rs = wb.addWorksheet("REPORTE SEMANAL", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  rs.columns = [{ width: 6 }, { width: 40 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 10 }, { width: 11 }];
  title(rs, 1, "INFORME SEMANAL DE CONSTRUCCIÓN", 6, { fill: BLUE, size: 13 });
  rs.mergeCells(1, 7, 1, 8);
  rs.getCell(1, 7).value = `Código: ${h.reportCode ?? "—"}\nFecha: ${week.lastWorkday.split("-").reverse().join("/")}`;
  rs.getCell(1, 7).alignment = { wrapText: true, vertical: "middle" };
  rs.getRow(1).height = 32;
  title(rs, 2, "INFORME SEMANAL AVANCE DE OBRA", 8, { fill: LIGHT });
  const info: [string, string][] = [
    ["NOMBRE DEL PROYECTO:", data.project.name],
    ["NOMBRE A QUIEN SE LE REPORTA:", h.clientName ?? "—"],
    ["REPORTA:", h.contractorName ?? "—"],
    ["CONTRATO:", h.contractCode ?? "—"],
    ["No. REPORTE:", String(week.index)],
    ["PERÍODO:", `Semana ${week.index} · ${weekLabel(week)}`],
  ];
  info.forEach(([k, v], i) => {
    const row = 3 + i;
    rs.getCell(row, 1).value = k;
    rs.mergeCells(row, 1, row, 2);
    rs.getCell(row, 1).font = { bold: true, size: 9 };
    rs.mergeCells(row, 3, row, 8);
    rs.getCell(row, 3).value = v;
    rs.getCell(row, 3).font = { size: 9 };
  });
  let row = 10;
  title(rs, row++, "CONTROL DE AVANCE POR ACTIVIDAD", 8, { fill: BLUE });
  header(rs, row++, ["N°", "Actividad", "Unidad", "Total", "Ejecutado semana", "Acumulado", "% Ejecución", "% Programado"]);
  acts.forEach((a, i) => {
    const cum = (a.actual[weekPos] ?? 0) * a.contractQty;
    cells(rs, row++, [i + 1, a.name, a.unit, a.contractQty, a.executed[weekPos], cum, a.actual[weekPos] ?? 0, a.planned[weekPos]], [
      undefined,
      undefined,
      undefined,
      "#,##0.##",
      "#,##0.##",
      "#,##0.##",
      "0.0%",
      "0.0%",
    ]);
  });
  cells(rs, row, ["", "AVANCE GENERAL PONDERADO", "", "", "", "", progress.totalActual[weekPos] ?? 0, progress.totalPlanned[weekPos]], [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "0.0%",
    "0.0%",
  ]);
  rs.getRow(row++).font = { bold: true, size: 9 };

  row++;
  title(rs, row++, "LLUVIA Y CLIMA", 8, { fill: BLUE });
  header(rs, row++, ["", "Día", "Condición", "Lluvia (hora inicio – fin)", null, "Duración (min)", "Horas perdidas por clima", "Observaciones"]);
  r.dayInfo.forEach((d, i) => {
    const log = r.logs[i];
    cells(rs, row, [
      "",
      `${DAY[i]} ${d.date.split("-").reverse().join("/")}`,
      d.weather ? (WEATHER_LABEL[d.weather] ?? d.weather) : "—",
      log?.rain.length ? log.rain.map((x) => `${x.start} – ${x.end}`).join(", ") : "—",
      null,
      log?.rainMinutes ?? 0,
      d.rainHours,
      log?.observations.join(" · ") ?? "",
    ]);
    rs.mergeCells(row, 4, row, 5);
    rs.getCell(row, 8).alignment = { wrapText: true, vertical: "top" };
    row++;
  });

  // Personal por cargo y equipos por tipo, día a día (del parte diario)
  for (const [label, names, kind] of [
    ["PERSONAL", r.roles, "personnel"],
    ["EQUIPOS", r.equipment, "equipment"],
  ] as const) {
    row++;
    header(rs, row++, [label, null, ...r.days.map((d, i) => `${DAY[i]} ${d.slice(8, 10)}/${d.slice(5, 7)}`), "CANTIDAD"]);
    rs.mergeCells(row - 1, 1, row - 1, 2);
    if (!names.length) {
      rs.mergeCells(row, 1, row, 10);
      rs.getCell(row, 1).value = kind === "personnel" ? "Sin parte diario esta semana: personal = suma de cuadrillas de los registros." : "Sin parte diario esta semana.";
      rs.getCell(row, 1).font = { size: 9, italic: true };
      row++;
    }
    for (const n of names) {
      const vals = r.logs.map((l) => l?.[kind][n] ?? 0);
      cells(rs, row, [n, null, ...vals.map((v) => v || null), Math.max(...vals)]);
      rs.mergeCells(row, 1, row, 2);
      row++;
    }
    if (kind === "personnel") {
      cells(rs, row, ["TOTAL PERSONAL", null, ...r.dayInfo.map((d) => d.crew || null), Math.max(...r.dayInfo.map((d) => d.crew))]);
      rs.mergeCells(row, 1, row, 2);
      rs.getRow(row++).font = { bold: true, size: 9 };
    }
  }

  row++;
  title(rs, row++, "ALERTAS Y RESTRICCIONES DE LA SEMANA", 8, { fill: BLUE });
  (r.alerts.length ? r.alerts : ["Sin alertas."]).forEach((t, i) => {
    rs.mergeCells(row, 1, row, 8);
    rs.getCell(row, 1).value = `${i + 1}. ${t}`;
    rs.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
    rs.getCell(row, 1).font = { size: 9 };
    rs.getRow(row).height = 28;
    row++;
  });

  if (r.photos.length) {
    row++;
    title(rs, row++, "REGISTRO FOTOGRÁFICO", 8, { fill: BLUE });
    for (let i = 0; i < r.photos.length; i++) {
      const p = r.photos[i]!;
      try {
        const buf = await (await fetch(p.url)).arrayBuffer();
        const id = wb.addImage({ buffer: buf as never, extension: "jpeg" });
        const col = (i % 2) * 4;
        const top = row + Math.floor(i / 2) * 13;
        rs.addImage(id, { tl: { col, row: top - 1 }, ext: { width: 300, height: 210 } });
        rs.getCell(top + 11, col + 1).value = p.caption;
        rs.getCell(top + 11, col + 1).font = { size: 8, italic: true };
      } catch {
        // Una foto que no descarga no impide el informe
      }
    }
    row += Math.ceil(r.photos.length / 2) * 13;
  }

  row++;
  title(rs, row++, "FIRMAS", 8, { fill: BLUE });
  row += 3;
  h.signers.forEach((s, i) => {
    const col = (i % 2) * 4 + 1;
    const rr = row + Math.floor(i / 2) * 4;
    rs.mergeCells(rr, col, rr, col + 2);
    const c = rs.getCell(rr, col);
    c.value = s.toUpperCase();
    c.border = { top: { style: "thin", color: { argb: "FF000000" } } };
    c.alignment = { horizontal: "center" };
    c.font = { bold: true, size: 9 };
  });

  // ---------- EJECUTADO ----------
  const ej = wb.addWorksheet("EJECUTADO", { views: [{ state: "frozen", xSplit: 2, ySplit: 3 }] });
  const fixed = ["Item", "Actividades", "COMIENZO", "FINAL", "Cantidad a Ejecutar", "Tiempo de Ejecución", "Programado Diario", "Cantidad Ejecutada", "Cantidad x Ejecutar", "% de Avance"];
  const weeks = progress.weeks.slice(0, weekPos + 1);
  const dayCols: ({ date: string; dow: number } | { weekIdx: number })[] = [];
  weeks.forEach((w, wi) => {
    for (let i = 0; i < 7; i++) dayCols.push({ date: addDays(w.start, i), dow: i });
    dayCols.push({ weekIdx: wi });
  });
  ej.columns = [{ width: 6 }, { width: 38 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 9 }, ...dayCols.map((c) => ({ width: "date" in c ? 7 : 9 }))];
  ej.mergeCells(2, 3, 2, 4);
  ej.getCell(2, 3).value = "FECHAS PDT";
  header(ej, 2, [null, null, null, null, null, null, null, null, null, null, ...dayCols.map((c) => ("date" in c ? DAY[c.dow]! : "Avance % Sem."))], LIGHT);
  header(ej, 3, [...fixed, ...dayCols.map((c) => ("date" in c ? c.date.slice(8, 10) + "/" + c.date.slice(5, 7) : `Sem. ${weeks[c.weekIdx]!.index}`))]);
  const totalW = progress.totalActual[weekPos] ?? 0;
  cells(ej, 4, [1, `OBRA: ${data.project.name}`, null, null, 1, null, null, totalW, 1 - totalW, totalW], [undefined, undefined, undefined, undefined, "0%", undefined, undefined, "0.0%", "0.0%", "0.0%"]);
  ej.getRow(4).font = { bold: true, size: 9 };
  data.activities.forEach((a, i) => {
    const pr = acts.find((x) => x.id === a.id)!;
    const exec = (pr.actual[weekPos] ?? 0) * a.contractQty;
    const days = executionDays(r, a.plannedStart, a.plannedFinish);
    const vals: unknown[] = [
      i + 1,
      pr.name,
      a.plannedStart ? isoDate(a.plannedStart) : null,
      a.plannedFinish ? isoDate(a.plannedFinish) : null,
      a.contractQty,
      days,
      days ? a.contractQty / days : null,
      exec,
      a.contractQty - exec,
      a.contractQty ? exec / a.contractQty : 0,
    ];
    dayCols.forEach((c) => {
      if ("date" in c) {
        const q = data.daily.filter((d) => d.activityId === a.id && d.date === c.date).reduce((s, d) => s + d.quantity, 0);
        vals.push(q || null);
      } else vals.push(a.contractQty ? pr.executed[c.weekIdx]! / a.contractQty : 0);
    });
    cells(ej, 5 + i, vals, ["", "", "dd/mm/yyyy", "dd/mm/yyyy", "#,##0.###", "0", "#,##0.##", "#,##0.##", "#,##0.##", "0.0%", ...dayCols.map((c) => ("date" in c ? "#,##0.##" : "0.0%"))]);
  });

  // ---------- % ----------
  const ps = wb.addWorksheet("%");
  ps.columns = [{ width: 6 }, { width: 50 }, { width: 16 }, { width: 4 }, { width: 22 }];
  header(ps, 1, ["Item", "Actividades", "Porcentaje (%)"]);
  acts.forEach((a, i) => cells(ps, 2 + i, [i + 1, a.name, a.weight], [undefined, undefined, "0.0000%"]));
  cells(ps, 2 + acts.length, ["", "TOTAL", acts.reduce((s, a) => s + a.weight, 0)], [undefined, undefined, "0.00%"]);
  ps.getRow(2 + acts.length).font = { bold: true, size: 9 };
  const ag = ps.getCell(1, 5);
  ag.value = "AVANCE GENERAL";
  ag.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
  ag.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  ag.alignment = { horizontal: "center" };
  const agv = ps.getCell(2, 5);
  agv.value = progress.totalActual[weekPos] ?? 0;
  agv.numFmt = "0.00%";
  agv.font = { bold: true, size: 11 };
  agv.border = border;
  if (!progress.weighted) ps.getCell(4 + acts.length, 2).value = "Sin pesos definidos en la app: todas las actividades pesan igual.";

  // ---------- SEGUIMIENTO SEMANAL ----------
  const ss = wb.addWorksheet("SEGUIMIENTO SEMANAL", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const nW = weeks.length;
  ss.columns = [{ width: 5 }, { width: 40 }, { width: 12 }, { width: 7 }, ...Array.from({ length: nW * 3 }, () => ({ width: 9 }))];
  const lastCol = 4 + nW * 3;
  title(ss, 1, `SEGUIMIENTO SEMANAL DE AVANCE — ${data.project.name.toUpperCase()}`, lastCol, { fill: BLUE, size: 12 });
  title(ss, 2, `Período: ${weeks[0]!.start.split("-").reverse().join("/")} — ${week.lastWorkday.split("-").reverse().join("/")} | Contrato: ${h.contractCode ?? "—"}`, lastCol);
  header(ss, 3, ["N°", "ACTIVIDAD", "CANT. CONTRAT.", "UND", ...weeks.flatMap((w) => [`SEMANA ${w.index} ${weekLabel(w)}`, null, null])]);
  weeks.forEach((_, i) => ss.mergeCells(3, 5 + i * 3, 3, 7 + i * 3));
  header(ss, 4, ["", "", "", "", ...weeks.flatMap(() => ["% PROG.", "% EJEC.", "Δ DESV."])], LIGHT);
  acts.forEach((a, i) => {
    cells(ss, 5 + i, [
      i + 1,
      a.name,
      a.contractQty,
      a.unit,
      ...weeks.flatMap((_, wi) => [a.planned[wi], a.actual[wi], a.actual[wi] == null ? null : a.actual[wi]! - a.planned[wi]!]),
    ], ["", "", "#,##0.###", "", ...weeks.flatMap(() => ["0.0%", "0.0%", "+0.0%;-0.0%;0.0%"])]);
    weeks.forEach((_, wi) => {
      const d = a.actual[wi] == null ? null : a.actual[wi]! - a.planned[wi]!;
      if (d != null && d < -0.05) ss.getCell(5 + i, 7 + wi * 3).font = { size: 9, bold: true, color: { argb: "FFC00000" } };
    });
  });
  const tr = 5 + acts.length;
  ss.mergeCells(tr, 1, tr, 4);
  cells(ss, tr, ["AVANCE GENERAL PONDERADO", null, null, null, ...weeks.flatMap((_, wi) => [progress.totalPlanned[wi], progress.totalActual[wi], progress.totalActual[wi] == null ? null : progress.totalActual[wi]! - progress.totalPlanned[wi]!])], [
    "",
    "",
    "",
    "",
    ...weeks.flatMap(() => ["0.0%", "0.0%", "+0.0%;-0.0%;0.0%"]),
  ]);
  ss.getRow(tr).font = { bold: true, size: 9 };
  let sr = tr + 2;
  title(ss, sr++, "ALERTAS Y RESTRICCIONES DE LA SEMANA", lastCol, { fill: BLUE });
  (r.alerts.length ? r.alerts : ["Sin alertas."]).forEach((t, i) => {
    ss.mergeCells(sr, 1, sr, lastCol);
    ss.getCell(sr, 1).value = `${i + 1}. ${t}`;
    ss.getCell(sr, 1).font = { size: 9 };
    sr++;
  });
  sr++;
  title(ss, sr++, "ENSAYOS Y PRUEBAS — ESTADO", lastCol, { fill: BLUE });
  header(ss, sr++, ["N°", "ENSAYO / PRUEBA", "NORMA", "FECHA ENVÍO", "ESTADO / RESULTADO", null, null, "OBSERVACIÓN"], LIGHT);
  r.tests.forEach((t, i) => {
    cells(ss, sr, [
      i + 1,
      `${t.name}${t.lab ? ` (${t.lab})` : ""}`,
      t.standard ?? "",
      t.sent_date ? isoDate(t.sent_date) : t.sample_date ? isoDate(t.sample_date) : "",
      `${TEST_STATUS_LABEL[t.status] ?? t.status}${t.result ? ` · ${t.result}` : ""}`,
      null,
      null,
      t.observation ?? "",
    ], ["", "", "", "dd/mm/yyyy"]);
    ss.mergeCells(sr, 5, sr, 7);
    ss.mergeCells(sr, 8, sr, Math.max(8, lastCol));
    if (t.status === "rechazado") ss.getCell(sr, 5).font = { size: 9, bold: true, color: { argb: "FFC00000" } };
    sr++;
  });
  for (let i = r.tests.length; i < 4; i++) cells(ss, sr++, [i + 1, "", "", "", "", "", "", ""]);
  sr++;
  title(ss, sr++, "FIRMAS — REUNIÓN DE SEGUIMIENTO SEMANAL", lastCol, { fill: BLUE });
  sr += 3;
  h.signers.forEach((s, i) => {
    const half = Math.max(4, Math.floor(lastCol / 2));
    const col = (i % 2) * half + 1;
    const rr = sr + Math.floor(i / 2) * 4;
    ss.mergeCells(rr, col, rr, Math.min(lastCol, col + half - 2));
    const c = ss.getCell(rr, col);
    c.value = s.toUpperCase();
    c.border = { top: { style: "thin", color: { argb: "FF000000" } } };
    c.alignment = { horizontal: "center" };
    c.font = { bold: true, size: 9 };
  });

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 3, visibility: "visible" }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
