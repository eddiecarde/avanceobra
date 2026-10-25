import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase, type MockDb } from "./mock";

/** Obra de prueba organizada como una planta: grupos de trabajo, dos subcampos en un circuito y línea base. */
function plantDb(): MockDb {
  const db = buildDb();
  db.tables.projects![0]!.zone_label = "Subcampo";
  const zone: Record<string, [string, string]> = { "BA-HIN": ["Hincas", "SC01"], "BA-MON": ["Trackers", "SC01"], "BB-HIN": ["Hincas", "SC02"], "BB-ZAN": ["Zanjas DC", "SC02"] };
  db.tables.activities = db.tables.activities!.map((a) => ({ ...a, work_group: zone[a.code as string]![0], subfield: zone[a.code as string]![1], circuit: "Circuito 01" }));
  db.tables.project_subfields = [
    { project_id: PROJECT_ID, code: "SC01", name: "Subcampo 01", circuit: "Circuito 01", position: "cabecera", energization_order: 1, planned_energization: day(20), baseline_energization: day(10) },
    { project_id: PROJECT_ID, code: "SC02", name: "Subcampo 02", circuit: "Circuito 01", position: "cola", energization_order: 2, planned_energization: day(25), baseline_energization: day(12) },
  ];
  const a1 = db.tables.activities!.find((a) => a.code === "BA-HIN")!;
  db.tables.activity_baselines = [{ activity_id: a1.id, project_id: PROJECT_ID, baseline: "BL0 contractual", start: day(-30), finish: day(-5) }];
  return db;
}

test("planta por subcampos: KPI semanal, energización por circuito, matriz y línea base", async ({ page }) => {
  await mockSupabase(page, plantDb());
  await page.goto("/dashboard");
  // Resumen: la curva S trae la línea base y el avance va por grupo de trabajo
  await expect(page.getByText("Línea base: BL0 contractual")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Avance por grupo de trabajo" })).toBeVisible();

  await page.getByRole("tab", { name: "Semanal" }).click();
  await expect(page.getByRole("heading", { name: "KPI semanal por grupo de trabajo" })).toBeVisible();
  for (const g of ["Hincas", "Trackers", "Zanjas DC"]) await expect(page.getByRole("cell", { name: g, exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Subcampos" }).click();
  const circuit = page.getByRole("region", { name: "Circuito 01" });
  await expect(circuit).toContainText("Subcampo 01");
  await expect(circuit).toContainText("cabecera");
  await expect(circuit).toContainText(/Listo el|Sin ritmo/);
  await expect(page.getByRole("heading", { name: "Matriz de avance por subcampo" })).toBeVisible();
  await expect(page.locator('td[title^="Subcampo 02 · Zanjas DC"]')).toBeVisible();
});

test("obra sin subcampos ni grupos: KPI por actividad y matriz por frente", async ({ page }) => {
  const db = buildDb();
  db.tables.activities = db.tables.activities!.map((a) => ({ ...a, subfield: null, circuit: null }));
  await mockSupabase(page, db);
  await page.goto("/dashboard");
  await page.getByRole("tab", { name: "Semanal" }).click();
  await expect(page.getByRole("heading", { name: "KPI semanal por actividad" })).toBeVisible();
  // El mismo trabajo en dos frentes es un solo grupo
  await expect(page.getByRole("cell", { name: "Hincado de pilotes", exact: true })).toHaveCount(1);
  await page.getByRole("tab", { name: "Frentes" }).click();
  await expect(page.getByRole("heading", { name: "Matriz de avance por frente" })).toBeVisible();
  await expect(page.locator('td[title^="BA · Bloque A · Hincado de pilotes"]')).toBeVisible();
  // Sin circuitos no hay tablero de energización
  await expect(page.getByRole("heading", { name: "Energización por circuito" })).toHaveCount(0);
});

test("importar MS Project: guarda la línea base y, con autorización, el avance hasta la fecha de estado", async ({ page }) => {
  const db = buildDb();
  let history: { p_rows: { quantity: number; work_date: string }[] } | null = null;
  db.rpc.import_progress_history = (args) => {
    history = args as typeof history;
    return (args.p_rows as unknown[]).length;
  };
  const writes = await mockSupabase(page, db);
  // BA-HIN existe (200 pilotes, 120 registrados): el cronograma dice 80 % → faltan 40
  const xml = `<?xml version="1.0"?><Project><Title>Obra</Title><StatusDate>${day(0)}T17:00:00</StatusDate><Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Bloque A</Name><WBS>BA</WBS><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Hincado de pilotes</Name><WBS>BA-HIN</WBS><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>${day(-20)}T08:00:00</Start><Finish>${day(10)}T17:00:00</Finish><PercentComplete>80</PercentComplete><ActualStart>${day(-20)}T08:00:00</ActualStart>
      <Baseline><Number>0</Number><Start>${day(-30)}T08:00:00</Start><Finish>${day(0)}T17:00:00</Finish></Baseline></Task>
  </Tasks></Project>`;
  await page.goto("/importar");
  await page.locator('input[type="file"]').setInputFiles({ name: "obra.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await expect(page.getByText(/Línea base en 1 actividad/)).toBeVisible();
  await expect(page.getByText(/Avance \(% completado y fechas reales\) en 1 actividad/)).toBeVisible();
  await page.getByLabel(/Autorizo cargar ese avance/).check();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/Importación lista/)).toBeVisible();
  const bl = writes.find((w) => w.table === "activity_baselines")?.body as Record<string, unknown>[];
  expect(bl[0]).toMatchObject({ baseline: "Línea base", start: day(-30), finish: day(0) });
  const rpc = history!;
  // Solo lo que falta (40), sin pasar de la fecha de estado
  expect(rpc.p_rows.reduce((t, r) => t + r.quantity, 0)).toBeCloseTo(40);
  expect(rpc.p_rows.every((r) => r.work_date <= day(0))).toBe(true);
});

test("importar el informe Eiffage (hoja Memoria): subcampos, pesos y grupos", async ({ page }) => {
  // Informe mínimo con la estructura real: esquema de filas, pesos relativos y una columna diaria
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Memoria");
  ws.getCell("C2").value = new Date("2026-02-15T00:00:00Z");
  ws.getRow(7).values = [null, "ACTIVIDADES", "Unidad", "Weigth", "Cantidad Total", "Inicio", "Fin"];
  ws.getCell(7, 27).value = new Date("2026-02-10T00:00:00Z");
  ws.getCell(8, 27).value = "Daily";
  const put = (r: number, outline: number, cells: unknown[]) => {
    ws.getRow(r).values = cells as ExcelJS.CellValue[];
    ws.getRow(r).outlineLevel = outline;
  };
  put(9, 0, [null, "Mechanical Works"]);
  put(10, 0, ["AO.ME.1.1", "Hincas", "Ud", 1, 300, new Date("2026-01-01"), new Date("2026-03-01")]);
  put(11, 1, [null, "Subcampo 01 (Antes Subcampo 19)", "Ud", 0.4, 100, new Date("2026-01-01"), new Date("2026-02-01")]);
  put(12, 1, [null, "Subcampo 02 (Antes Subcampo 18)", "Ud", 0.6, 200, new Date("2026-02-01"), new Date("2026-03-01")]);
  // Historial: 30 hincados el 10 de febrero en el subcampo 19
  ws.getCell(11, 27).value = 30;
  const file = Buffer.from(await wb.xlsx.writeBuffer());

  const edb = buildDb();
  const captured: { history?: { p_rows: unknown[] } } = {};
  edb.rpc.import_progress_history = (args) => {
    captured.history = args as { p_rows: unknown[] };
    return (args.p_rows as unknown[]).length;
  };
  const writes = await mockSupabase(page, edb);
  await page.goto("/importar");
  await page.locator('input[type="file"]').setInputFiles({ name: "informe-eiffage.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await expect(page.getByRole("row", { name: /Nueva SC19 AO.ME.1.1-SC19 · Hincas › Subcampo 19 Ud 100/ })).toBeVisible();
  // El historial diario se carga solo con autorización
  await expect(page.getByRole("heading", { name: "Historial diario del informe" })).toBeVisible();
  await page.getByLabel(/Autorizo cargar el historial diario/).check();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/Importación lista/)).toBeVisible();
  const created = writes.filter((w) => w.table === "activities" && w.method === "POST").map((w) => w.body as Record<string, unknown>);
  expect(created.find((b) => b.code === "AO.ME.1.1-SC19")).toMatchObject({ subfield: "SC19", work_group: "Hincas", unit: "Ud", contract_qty: 100, weight: 0.4 });
  expect(created.find((b) => b.code === "AO.ME.1.1-SC18")).toMatchObject({ subfield: "SC18", weight: 0.6 });
  // Un frente por subcampo
  expect(writes.filter((w) => w.table === "fronts" && w.method === "POST").map((w) => (w.body as { code: string }).code).sort()).toEqual(["SC18", "SC19"]);
  expect(captured.history?.p_rows).toEqual([{ activity_id: expect.any(String), work_date: "2026-02-10", quantity: 30 }]);
});

test("línea base de MS Project sobre una obra con otros códigos: se emparejan los grupos", async ({ page }) => {
  const db = plantDb();
  const xml = `<?xml version="1.0"?><Project><Title>Planta</Title><Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Planta</Name><WBS>1</WBS><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Ramming of Poles</Name><WBS>1.1</WBS><OutlineLevel>2</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Subcampo 01</Name><WBS>1.1.1</WBS><OutlineLevel>3</OutlineLevel><Summary>0</Summary><Start>2026-01-05T08:00:00</Start><Finish>2026-01-20T17:00:00</Finish>
      <Baseline><Number>0</Number><Start>2025-12-01T08:00:00</Start><Finish>2025-12-15T17:00:00</Finish></Baseline></Task>
    <Task><UID>4</UID><ID>4</ID><Name>Subcampo 02</Name><WBS>1.1.2</WBS><OutlineLevel>3</OutlineLevel><Summary>0</Summary><Start>2026-01-21T08:00:00</Start><Finish>2026-02-05T17:00:00</Finish>
      <Baseline><Number>0</Number><Start>2025-12-16T08:00:00</Start><Finish>2025-12-31T17:00:00</Finish></Baseline></Task>
  </Tasks></Project>`;
  const writes = await mockSupabase(page, db);
  await page.goto("/importar");
  await page.locator('input[type="file"]').setInputFiles({ name: "cronograma.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await expect(page.getByRole("heading", { name: "Línea base para la obra existente" })).toBeVisible();
  // Hincas se sugiere solo con el grupo del cronograma
  await expect(page.getByLabel("Grupo del cronograma para Hincas")).toHaveValue("Ramming of Poles");
  await page.getByRole("button", { name: /Guardar línea base \(2 actividades\)/ }).click();
  await expect(page.getByText("Línea base guardada en 2 actividad(es) de la obra.")).toBeVisible();
  const rows = writes.find((w) => w.table === "activity_baselines" && w.method === "POST")?.body as { activity_id: string; start: string }[];
  expect(rows.map((r) => [r.activity_id, r.start]).sort()).toEqual([
    ["a1", "2025-12-01"],
    ["a3", "2025-12-16"],
  ]);
});
