"use client";

import { fromSheetRows, toSheetRows, validateDefinition, type FormDefinition } from "@avanceobra/forms";
import { downloadBlob } from "@/components/ui";

const safeName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");

export function exportJson(def: FormDefinition) {
  downloadBlob(`formato_${safeName(def.name)}.json`, JSON.stringify(def, null, 2), "application/json");
}

/** Excel con una hoja "campos" (una fila por campo) y una hoja "formato" con los metadatos. */
export async function exportExcel(def: FormDefinition) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const meta = wb.addWorksheet("formato");
  meta.addRows([
    ["nombre", def.name],
    ["categoria", def.category],
    ["tipo_obra", def.workType],
    ["descripcion", def.description ?? ""],
  ]);
  const ws = wb.addWorksheet("campos");
  ws.addRows(toSheetRows(def));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 18));
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(`formato_${safeName(def.name)}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export interface ImportResult {
  definition?: FormDefinition;
  issues: string[];
}

/** Lee un .json o un .xlsx exportado (o hecho a mano con las mismas columnas) y lo valida. */
export async function importFile(file: File): Promise<ImportResult> {
  try {
    if (file.name.toLowerCase().endsWith(".json")) {
      const r = validateDefinition(JSON.parse(await file.text()));
      return { definition: r.ok ? r.definition : undefined, issues: r.issues.map((i) => (i.fieldId ? `${i.fieldId}: ${i.message}` : i.message)) };
    }
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet("campos") ?? wb.worksheets[0];
    if (!ws) return { issues: ["El Excel no tiene hojas"] };
    const rows: (string | number | boolean | null)[][] = [];
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => (v === undefined || v === null ? null : typeof v === "object" ? String((v as { text?: string }).text ?? "") : (v as string | number | boolean)));
      rows.push(vals);
    });
    const meta = new Map<string, string>();
    wb.getWorksheet("formato")?.eachRow((row) => {
      const [k, v] = (row.values as unknown[]).slice(1);
      meta.set(String(k ?? ""), String(v ?? ""));
    });
    const def = fromSheetRows(rows, {
      name: meta.get("nombre") || file.name.replace(/\.xlsx$/i, "").replace(/_/g, " "),
      category: (meta.get("categoria") as FormDefinition["category"]) || "avance",
      workType: meta.get("tipo_obra") || "general",
    });
    const r = validateDefinition(def);
    return { definition: r.ok ? r.definition : undefined, issues: r.issues.map((i) => (i.fieldId ? `${i.fieldId}: ${i.message}` : i.message)) };
  } catch (e) {
    return { issues: [`No se pudo leer el archivo: ${(e as Error).message}`] };
  }
}
