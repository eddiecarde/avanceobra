import { expect, test } from "@playwright/test";
import { buildDb, day, FRONT_A, PROJECT_ID } from "./fixtures";
import { mockSupabase, type MockDb } from "./mock";

function coDb(status: "borrador" | "enviada" = "borrador"): { db: MockDb; calls: { fn: string; args: Record<string, unknown> }[] } {
  const db = buildDb();
  Object.assign(db.tables.activities!.find((a) => a.code === "BA-HIN")!, { unit_price: 80_000 });
  db.tables.change_orders = [
    {
      id: "co1",
      project_id: PROJECT_ID,
      company_id: null,
      number: 1,
      title: "Pilotes adicionales sector norte",
      description: null,
      reason: "cliente",
      days_extension: 5,
      status,
      amount: status === "enviada" ? 800_000 : null,
      decided_name: null,
      decided_at: null,
      decision_note: null,
      created_at: `${day(-1)}T12:00:00Z`,
      items: [{ id: "i1", activity_id: "a1", delta_qty: 10, new_unit_price: null, new_front_id: null, new_code: null, new_name: null, new_unit: null, old_qty: null, old_unit_price: null }],
    },
  ];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  for (const fn of ["submit_change_order", "decide_change_order", "void_change_order"]) {
    db.rpc[fn] = (args) => {
      calls.push({ fn, args });
      return null;
    };
  }
  return { db, calls };
}

test("órdenes de cambio: el borrador recibe renglones (existente y nueva) y se envía a aprobación", async ({ page }) => {
  const { db, calls } = coDb();
  const writes = await mockSupabase(page, db);
  await page.goto("/cambios");
  await expect(page.getByRole("heading", { name: "N° 1 · Pilotes adicionales sector norte" })).toBeVisible();
  // 10 pilotes más a $80.000 = $800.000 estimados
  await expect(page.getByText("$800.000")).toBeVisible();
  await expect(page.getByRole("row", { name: /BA-HIN · Hincado de pilotes \+10 pilotes sin cambio/ })).toBeVisible();

  await page.getByLabel("Renglón").selectOption("nueva");
  await page.getByLabel("Código").fill("ADI-01");
  await page.getByLabel("Nombre", { exact: true }).fill("Cerramiento adicional");
  await page.getByLabel("Unidad").fill("ml");
  await page.getByLabel(/^Cantidad/).fill("50");
  await page.getByLabel(/^Precio unitario/).fill("120.000");
  await page.getByRole("button", { name: "Agregar renglón" }).click();
  await expect.poll(() => writes.find((w) => w.table === "change_order_items")?.body).toMatchObject({
    change_order_id: "co1",
    project_id: PROJECT_ID,
    new_front_id: FRONT_A,
    new_code: "ADI-01",
    new_name: "Cerramiento adicional",
    new_unit: "ml",
    delta_qty: 50,
    new_unit_price: 120_000,
  });

  await page.getByRole("button", { name: "Enviar a aprobación" }).click();
  await expect(page.getByText("Orden N° 1 enviada a aprobación.")).toBeVisible();
  expect(calls).toEqual([{ fn: "submit_change_order", args: { p_id: "co1" } }]);
});

test("órdenes de cambio: el contratista registra la aprobación del cliente con su soporte", async ({ page }) => {
  const { db, calls } = coDb("enviada");
  await mockSupabase(page, db);
  await page.goto("/cambios");
  await expect(page.getByText("Por aprobar")).toBeVisible();
  page.once("dialog", (d) => void d.accept("Laura Gómez, interventoría, oficio 123"));
  await page.getByRole("button", { name: "Registrar aprobación del cliente" }).click();
  await expect(page.getByText("Orden N° 1 aprobada y aplicada al contrato.")).toBeVisible();
  expect(calls).toEqual([{ fn: "decide_change_order", args: { p_id: "co1", p_approve: true, p_note: "Laura Gómez, interventoría, oficio 123" } }]);
});

test("liquidación: valor final, saldo a pagar y emisión que cierra el contrato", async ({ page }) => {
  const { db } = coDb();
  db.tables.change_orders![0]!.status = "aprobada";
  db.tables.change_orders![0]!.amount = 800_000;
  db.tables.payment_certificates = [];
  db.tables.settlements = [];
  const writes = await mockSupabase(page, db);
  await page.goto("/actas");
  await page.getByRole("button", { name: "Preparar liquidación" }).click();
  await expect(page.getByRole("row", { name: /Órdenes de cambio aprobadas \$800\.000/ })).toBeVisible();
  // Sin actas: lo ejecutado (104 pilotes × $80.000) queda pendiente por facturar y es el saldo
  await expect(page.getByRole("row", { name: /Ejecutado y aprobado \$8\.320\.000/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /SALDO A PAGAR EN LA LIQUIDACIÓN \$8\.320\.000/ })).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Emitir acta de liquidación" }).click();
  await expect(page.getByText("Liquidación emitida: el contrato quedó cerrado.")).toBeVisible();
  const body = writes.find((w) => w.table === "settlements")?.body as { company_id: string | null; totals: { balance: number; changeOrdersAmount: number } };
  expect(body.company_id).toBeNull();
  expect(body.totals).toMatchObject({ balance: 8_320_000, changeOrdersAmount: 800_000 });
});
