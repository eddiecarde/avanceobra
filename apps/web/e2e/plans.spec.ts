import { expect, test } from "@playwright/test";
import { writeArrayBuffer } from "geotiff";
import JSZip from "jszip";
import { PDFDocument, PDFName, rgb } from "pdf-lib";
import proj4 from "proj4";
import { buildDb, FRONT_A, PROJECT_ID } from "./fixtures";
import { mockSupabase } from "./mock";

const CTM12 = "+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

/** PDF de dos páginas con un rectángulo, como un plano sencillo. */
async function samplePdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([842, 595]);
    page.drawRectangle({ x: 60, y: 60, width: 720, height: 470, borderColor: rgb(0, 0, 0), borderWidth: 3 });
  }
  return Buffer.from(await doc.save());
}

test("planos: subir un PDF, anclarlo con 3 puntos y guardarlo", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/planos");
  await expect(page.getByText("Todavía no hay planos que puedas ver en este proyecto.")).toBeVisible();
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "Layout general.pdf", mimeType: "application/pdf", buffer: await samplePdf() });
  await expect(page.getByRole("img", { name: "Plano Layout general" })).toBeVisible();
  await expect(page.getByLabel("Página (de 2)")).toBeVisible();
  await expect(page.getByLabel("Nombre del plano")).toHaveValue("Layout general");

  // Tres puntos: se tocan en el plano y se escriben sus coordenadas medidas
  const plan = page.getByTestId("plano-imagen");
  const pts: [number, number, string, string][] = [
    [40, 40, "10.4500", "-74.6500"],
    [300, 40, "10.4500", "-74.6400"],
    [300, 200, "10.4440", "-74.6400"],
  ];
  for (const [i, [x, y, lat, lon]] of pts.entries()) {
    await plan.click({ position: { x, y } });
    await page.getByLabel(`Latitud del punto ${i + 1}`).fill(lat);
    await page.getByLabel(`Latitud del punto ${i + 1}`).blur();
    await page.getByLabel(`Longitud del punto ${i + 1}`).fill(lon);
    await page.getByLabel(`Longitud del punto ${i + 1}`).blur();
  }
  await expect(page.getByText(/Error medio 0 m: con 3 puntos el ajuste siempre cuadra/)).toBeVisible();
  // Un 4.º punto mal marcado (unos 500 m corrido) se delata con su error
  await plan.click({ position: { x: 40, y: 200 } });
  await page.getByLabel("Latitud del punto 4").fill("10.4440");
  await page.getByLabel("Latitud del punto 4").blur();
  await page.getByLabel("Longitud del punto 4").fill("-74.6455");
  await page.getByLabel("Longitud del punto 4").blur();
  await expect(page.getByText(/revisa el punto con más error o agrega otro/)).toBeVisible();
  await page.getByRole("button", { name: "Borrar punto 4" }).click();
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await expect(page.getByText(/Plano "Layout general" guardado/)).toBeVisible();

  const upload = writes.find((w) => w.table === "storage")?.body as { path: string; bytes: number };
  expect(upload.path).toMatch(new RegExp(`^plans/${PROJECT_ID}/[0-9a-f-]+\\.jpg$`));
  expect(upload.bytes).toBeGreaterThan(1000);
  const row = writes.find((w) => w.table === "site_plans" && w.method === "POST")?.body as { corners: number[][]; source_format: string; version: number; control_points: unknown[] };
  expect(row).toMatchObject({ name: "Layout general", source_format: "pdf", version: 1 });
  expect(row.corners).toHaveLength(4);
  expect(row.control_points).toHaveLength(3);
  // La esquina superior izquierda queda cerca del primer punto (al noroeste de la obra)
  expect(row.corners[0]![1]).toBeGreaterThan(10.44);
  expect(row.corners[0]![0]).toBeLessThan(-74.64);
});

test("planos: un archivo que no es plano se rechaza con un aviso", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/planos");
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "plano.dwg", mimeType: "application/octet-stream", buffer: Buffer.from("AC1032") });
  await expect(page.getByText(/Formato no soportado: .* guárdalo como PDF/)).toBeVisible();
});

test("planos: importar trackers y una zanja desde el DXF del layout", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  // Layout en MAGNA-SIRGAS Origen Nacional, al lado de los elementos que ya tiene la obra
  const ctm12 = proj4(CTM12);
  const [x0, y0] = ctm12.forward([-73.65, 9.95]);
  const ins = (x: number, y: number) => ["0", "INSERT", "8", "TRACKERS", "2", "TRK60", "10", String(x0 + x), "20", String(y0 + y)];
  const dxf = [
    ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"],
    ...[0, 1, 2].flatMap((c) => [ins(c * 12, 0), ins(c * 12, -40)]),
    ["0", "LWPOLYLINE", "8", "ZANJA DC", "90", "2", "70", "0", "10", String(x0), "20", String(y0 - 60), "10", String(x0 + 250), "20", String(y0 - 60)],
    ["0", "TEXT", "8", "TEXTOS", "10", String(x0), "20", String(y0), "1", "BLOQUE A"],
    ["0", "ENDSEC", "0", "EOF"],
  ]
    .flat()
    .join("\n");

  await page.goto("/planos");
  await page.getByLabel("Archivo DXF").setInputFiles({ name: "layout.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await expect(page.getByText("layout.dxf · 7 objetos en 2 capas")).toBeVisible();
  // Se reconoce el sistema de coordenadas por la ubicación de la obra
  await expect(page.getByLabel("Sistema de coordenadas")).toHaveValue("EPSG:9377");
  await page.getByLabel("Tipo de la capa TRACKERS").selectOption("tracker");
  await page.getByLabel("Actividad de la capa TRACKERS").selectOption({ label: "BA-MON · Montaje de trackers (trackers)" });
  await page.getByLabel("Tipo de la capa ZANJA DC").selectOption("trench");
  await expect(page.getByText("1 sin actividad")).toBeVisible();
  await page.getByRole("button", { name: "Importar 7 elementos" }).click();
  await expect(page.getByText("7 elemento(s) nuevos desde layout.dxf")).toBeVisible();

  const rows = writes.filter((w) => w.table === "elements" && w.method === "POST").flatMap((w) => w.body as Record<string, unknown>[]);
  expect(rows.map((r) => r.code)).toEqual(["TRK-001", "TRK-002", "TRK-003", "TRK-004", "TRK-005", "TRK-006", "ZNJ-001"]);
  expect(rows[0]).toMatchObject({ kind: "tracker", activity_id: "a2", front_id: FRONT_A, qty: 1 });
  expect(String(rows[0]!.geom)).toMatch(/^SRID=4326;POINT\(-73\.650\d+ 9\.950\d+\)$/);
  // La zanja vale su largo en metros
  expect(rows[6]).toMatchObject({ kind: "trench", activity_id: null, qty: 250 });
  expect(writes.find((w) => w.table === "elements")?.query).toContain("on_conflict=project_id%2Ccode");
  expect(writes.find((w) => w.table === "import_runs")?.body).toMatchObject({ kind: "dxf", file_name: "layout.dxf", summary: { creados: 7, duplicados_omitidos: 0 } });
});

test("planos: el DXF muestra qué cambia, omite duplicados y solo actualiza lo autorizado", async ({ page }) => {
  const db = buildDb();
  // TRK-001 ya existe en la obra, 10 m al occidente de donde lo pone el nuevo dibujo
  const lonOld = -73.65 - 10 / (111_320 * Math.cos((9.95 * Math.PI) / 180));
  db.tables.elements!.push({ id: "trk1", project_id: PROJECT_ID, code: "TRK-001", kind: "tracker", activity_id: "a2", qty: 1, geojson: JSON.stringify({ type: "Point", coordinates: [lonOld, 9.95] }) });
  db.tables.entry_elements!.push({ element_id: "trk1", project_id: PROJECT_ID, entry: { activity_id: "a2", work_date: "2026-10-01", status: "approved" } });
  const writes = await mockSupabase(page, db);
  const [x0, y0] = proj4(CTM12).forward([-73.65, 9.95]);
  const ins = (x: number, y: number) => ["0", "INSERT", "8", "TRACKERS", "2", "TRK60", "10", String(x0 + x), "20", String(y0 + y)];
  const dxf = [
    ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"],
    ins(0, 0),
    ins(0, 0), // copia encima, por error
    ins(12, 0),
    ["0", "ENDSEC", "0", "EOF"],
  ]
    .flat()
    .join("\n");
  await page.goto("/planos");
  await page.getByLabel("Archivo DXF").setInputFiles({ name: "layout-v2.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await page.getByLabel("Tipo de la capa TRACKERS").selectOption("tracker");
  await page.getByLabel("Actividad de la capa TRACKERS").selectOption({ label: "BA-MON · Montaje de trackers (trackers)" });
  await expect(page.getByText("Duplicados omitidos")).toBeVisible();
  await expect(page.getByText(/TRK-001: posición \(se mueve 10 m\)/)).toBeVisible();
  await expect(page.getByText(/1 tienen avance marcado en el plano/)).toBeVisible();
  // Sin autorizar, solo el nuevo
  await expect(page.getByRole("button", { name: "Importar 1 elementos" })).toBeVisible();
  await page.getByLabel(/Autorizo actualizar estos 1 elementos/).check();
  await page.getByRole("button", { name: "Importar 2 elementos" }).click();
  await expect(page.getByText(/1 elemento\(s\) nuevos y 1 actualizado\(s\) desde layout-v2.dxf/)).toBeVisible();
  const rows = writes.filter((w) => w.table === "elements" && w.method === "POST").flatMap((w) => w.body as Record<string, unknown>[]);
  expect(rows.map((r) => r.code)).toEqual(["TRK-001", "TRK-002"]);
  expect(writes.find((w) => w.table === "import_runs")?.body).toMatchObject({
    kind: "dxf",
    updated_existing: true,
    summary: { creados: 1, actualizados: 1, duplicados_omitidos: 1 },
    changes: [{ codigo: "TRK-001", cambios: ["posición (se mueve 10 m)"] }],
  });
});

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
type SavedRow = { name: string; source_format: string; corners: [number, number][]; control_points: unknown };
const savedPlan = (writes: Awaited<ReturnType<typeof mockSupabase>>) => writes.find((w) => w.table === "site_plans" && w.method === "POST")?.body as SavedRow;

test("planos: un GeoTIFF se ubica solo, con su sistema de coordenadas", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  const values = new Uint8Array(40 * 30 * 3).map((_, i) => (i % 3 === 0 ? 200 : 40));
  const tif = await writeArrayBuffer(values, {
    width: 40, height: 30, SamplesPerPixel: 3, BitsPerSample: [8, 8, 8], PhotometricInterpretation: 2, PlanarConfiguration: 1,
    ModelPixelScale: [2, 2, 0], ModelTiepoint: [0, 0, 0, 4920000, 2660000, 0], GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 9377,
  });
  await page.goto("/planos");
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "Ortofoto.tif", mimeType: "image/tiff", buffer: Buffer.from(tif) });
  await expect(page.getByRole("heading", { name: "Ubicación leída del archivo · GeoTIFF" })).toBeVisible();
  await expect(page.getByLabel("Sistema de coordenadas")).toHaveValue("EPSG:9377");
  await expect(page.getByText("Ubicado sin puntos de control.")).toBeVisible();
  // Un sistema equivocado lo saca de Colombia y se avisa
  await page.getByLabel("Sistema de coordenadas").selectOption("EPSG:4326");
  await expect(page.getByText(/queda fuera de Colombia/)).toBeVisible();
  await page.getByLabel("Sistema de coordenadas").selectOption("EPSG:9377");
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await expect(page.getByText(/Plano "Ortofoto" guardado/)).toBeVisible();
  const row = savedPlan(writes);
  expect(row).toMatchObject({ source_format: "geotiff", control_points: null });
  const [lon, lat] = proj4(CTM12, "WGS84", [4920000, 2660000]);
  expect(row.corners[0]![0]).toBeCloseTo(lon, 6);
  expect(row.corners[0]![1]).toBeCloseTo(lat, 6);
  expect(row.corners[2]![1]).toBeLessThan(row.corners[0]![1]);
});

test("planos: un KMZ de Google Earth trae imagen y esquinas", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  const zip = new JSZip();
  zip.file(
    "doc.kml",
    `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><GroundOverlay><name>Layout Pivijay</name>
     <Icon><href>files/layout.png</href></Icon><LatLonBox><north>10.1</north><south>10.0</south><east>-74.0</east><west>-74.2</west><rotation>0</rotation></LatLonBox>
     </GroundOverlay></Document></kml>`,
  );
  zip.file("files/layout.png", PNG_1PX);
  await page.goto("/planos");
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "Layout.kmz", mimeType: "application/vnd.google-earth.kmz", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  await expect(page.getByRole("heading", { name: "Ubicación leída del archivo · Google Earth (KMZ/KML)" })).toBeVisible();
  await expect(page.getByLabel("Sistema de coordenadas")).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await expect(page.getByText(/Plano "Layout" guardado/)).toBeVisible();
  const row = savedPlan(writes);
  expect(row.source_format).toBe("kml");
  expect(row.corners).toEqual([[-74.2, 10.1], [-74, 10.1], [-74, 10], [-74.2, 10]]);
});

test("planos: imagen con archivo de mundo y .prj (UTM 18N)", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  await page.goto("/planos");
  await page.getByLabel("Archivo del plano").setInputFiles([
    { name: "plano.png", mimeType: "image/png", buffer: PNG_1PX },
    { name: "plano.pgw", mimeType: "text/plain", buffer: Buffer.from("0.5\n0\n0\n-0.5\n500000.25\n1100000.25\n") },
    { name: "plano.prj", mimeType: "text/plain", buffer: Buffer.from('PROJCS["WGS_1984_UTM_Zone_18N",GEOGCS["GCS_WGS_1984"],PROJECTION["Transverse_Mercator"]]') },
  ]);
  await expect(page.getByRole("heading", { name: "Ubicación leída del archivo · Imagen con archivo de mundo" })).toBeVisible();
  await expect(page.getByLabel("Sistema de coordenadas")).toHaveValue("EPSG:32618");
  await expect(page.getByLabel("Nombre del plano")).toHaveValue("plano");
  await page.getByRole("button", { name: "Guardar plano" }).click();
  const row = await expect.poll(() => savedPlan(writes)).toBeTruthy().then(() => savedPlan(writes));
  expect(row.source_format).toBe("png");
  const [lon, lat] = proj4("+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs", "WGS84", [500000, 1100000.5]);
  expect(row.corners[0]![0]).toBeCloseTo(lon, 6);
  expect(row.corners[0]![1]).toBeCloseTo(lat, 6);
});

test("planos: un KML sin su imagen pide seleccionarla", async ({ page }) => {
  await mockSupabase(page, buildDb());
  await page.goto("/planos");
  const kml = String.raw`<kml><GroundOverlay><Icon><href>C:\Planos\layout.jpg</href></Icon><LatLonBox><north>1</north><south>0</south><east>1</east><west>0</west></LatLonBox></GroundOverlay></kml>`;
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "layout.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(kml) });
  await expect(page.getByText(/usa la imagen "layout.jpg": selecciónala junto con el KML/)).toBeVisible();
});

test("planos: un PDF georreferenciado se ubica solo y queda a nombre de una empresa", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb());
  // Página de 842 × 595 con el recuadro del mapa en (100,100)–(742,495), como lo exporta ArcGIS
  const doc = await PDFDocument.create();
  const p = doc.addPage([842, 595]);
  p.drawRectangle({ x: 100, y: 100, width: 642, height: 395, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  p.node.set(
    PDFName.of("VP"),
    doc.context.obj([
      {
        Type: "Viewport",
        BBox: [100, 100, 742, 495],
        Measure: { Type: "Measure", Subtype: "GEO", GPTS: [10.0, -74.2, 10.1, -74.2, 10.1, -74.0, 10.0, -74.0], LPTS: [0, 0, 0, 1, 1, 1, 1, 0], GCS: { Type: "PROJCS", EPSG: 9377 } },
      },
    ]),
  );
  await page.goto("/planos");
  await page.getByLabel("Empresa del plano").selectOption({ label: "Constructora Demo (contratista)" });
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "Layout ArcGIS.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.getByRole("heading", { name: "Ubicación leída del archivo · PDF georreferenciado" })).toBeVisible();
  await expect(page.getByText(/4 puntos de georreferencia · EPSG:9377/)).toBeVisible();
  await expect(page.getByLabel("Sistema de coordenadas")).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await expect(page.getByText(/Plano "Layout ArcGIS" guardado/)).toBeVisible();
  const row = writes.find((w) => w.table === "site_plans" && w.method === "POST")?.body as SavedRow & { company_id: string };
  expect(row).toMatchObject({ source_format: "pdf", control_points: null, company_id: "co-contratista" });
  // La esquina de la hoja queda fuera del recuadro del mapa, al noroeste
  expect(row.corners[0]![0]).toBeCloseTo(-74.2 - (100 / 642) * 0.2, 3);
  expect(row.corners[0]![1]).toBeCloseTo(10.0 + (495 / 395) * 0.1, 3);
});

test("planos: lista por empresa, filtro y comparación de dos planos", async ({ page }) => {
  const db = buildDb();
  const corners = [[-73.66, 9.96], [-73.64, 9.96], [-73.64, 9.94], [-73.66, 9.94]];
  db.tables.site_plans = [
    { id: "pl1", project_id: PROJECT_ID, name: "Layout diseño", version: 1, source_format: "pdf", storage_path: `${PROJECT_ID}/a.jpg`, corners, company_id: null, size_bytes: 900000, created_at: "2026-10-20T10:00:00Z" },
    { id: "pl2", project_id: PROJECT_ID, name: "Layout montaje", version: 2, source_format: "geotiff", storage_path: `${PROJECT_ID}/b.jpg`, corners, company_id: "co-contratista", size_bytes: 1200000, created_at: "2026-10-21T10:00:00Z" },
  ];
  await mockSupabase(page, db);
  await page.goto("/planos");
  await expect(page.getByRole("row", { name: /Layout montaje Contratista Constructora Demo 2/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Layout diseño General 1/ })).toBeVisible();
  await page.getByLabel("Filtrar por empresa").selectOption("general");
  await expect(page.getByRole("row", { name: /Layout montaje/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Comparar planos" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Plano A/ })).toHaveValue("pl1");
  await expect(page.getByRole("combobox", { name: /^Plano B/ })).toHaveValue("pl2");
  await page.getByRole("button", { name: "Parpadear" }).click();
  await expect(page.getByRole("button", { name: "Detener" })).toBeVisible();
});

test("planos: el residente sube solo a nombre de su empresa y no importa elementos", async ({ page }) => {
  const writes = await mockSupabase(page, buildDb("resident"));
  await page.goto("/planos");
  await expect(page.getByText(/quedan a nombre de Constructora Demo/)).toBeVisible();
  await expect(page.getByLabel("Empresa del plano")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Elementos desde el DXF del layout" })).toHaveCount(0);
  await page.getByLabel("Archivo del plano").setInputFiles({ name: "Mi plano.pdf", mimeType: "application/pdf", buffer: await samplePdf() });
  const plan = page.getByTestId("plano-imagen");
  for (const [i, [x, y, lat, lon]] of ([[40, 40, "10.45", "-74.65"], [300, 40, "10.45", "-74.64"], [300, 200, "10.444", "-74.64"]] as const).entries()) {
    await plan.click({ position: { x, y } });
    await page.getByLabel(`Latitud del punto ${i + 1}`).fill(lat);
    await page.getByLabel(`Latitud del punto ${i + 1}`).blur();
    await page.getByLabel(`Longitud del punto ${i + 1}`).fill(lon);
    await page.getByLabel(`Longitud del punto ${i + 1}`).blur();
  }
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await expect(page.getByText(/Plano "Mi plano" guardado/)).toBeVisible();
  expect(writes.find((w) => w.table === "site_plans" && w.method === "POST")?.body).toMatchObject({ company_id: "co-contratista" });
});
