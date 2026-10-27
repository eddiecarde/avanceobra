import { expect, test } from "@playwright/test";
import { buildDb, day, PROJECT_ID } from "./fixtures";
import { mockSupabase, type MockDb } from "./mock";

/** Usuario cliente: sin membresías, con acceso a la obra por project_clients y un acta por revisar. */
function clientDb(): { db: MockDb; decisions: Record<string, unknown>[] } {
  const db = buildDb();
  db.tables.memberships = [];
  const decisions: Record<string, unknown>[] = [];
  const shared = db.rpc.shared_dashboard!({ p_token: "token-valido" }) as Record<string, unknown>;
  const cert = {
    id: "pc1",
    number: 1,
    period_start: day(-30),
    period_end: day(-1),
    status: "emitida",
    lines: [
      { id: "a1", code: "BA-HIN", name: "Hincado de pilotes", unit: "pilotes", contractQty: 200, unitPrice: 80000, previousQty: 0, periodQty: 104, cumulativeQty: 104, contractAmount: 16_000_000, previousAmount: 0, periodAmount: 8_320_000, cumulativeAmount: 8_320_000, balanceAmount: 7_680_000, exceeds: false },
    ],
    totals: { contractAmount: 16_000_000, previousAmount: 0, periodAmount: 8_320_000, cumulativeAmount: 8_320_000, balanceAmount: 7_680_000, retentionPct: 0.05, retentionAmount: 416_000, advancePct: 0, advanceAmount: 0, adminPct: 0, adminAmount: 0, contingencyPct: 0, contingencyAmount: 0, utilityPct: 0, utilityAmount: 0, subtotalAmount: 8_320_000, vatMode: "none", vatPct: 0, vatAmount: 0, grossAmount: 8_320_000, netAmount: 7_904_000, financialProgress: 0.52 },
    notes: null,
    issued_at: `${day(0)}T12:00:00Z`,
    void_reason: null,
    client_status: "pendiente",
    client_note: null,
    client_decided_name: null,
    client_decided_at: null,
  };
  db.rpc.client_projects = () => [{ id: PROJECT_ID, name: "Parque Solar Prueba", client_name: "Helios", contractor_name: "CNX" }];
  db.rpc.client_project = () => ({
    ...shared,
    header: { name: "Parque Solar Prueba", client_name: "Helios", contractor_name: "CNX", contract_code: "CNX-001", report_signers: [], start_date: day(-60) },
    certificates: [cert],
    handovers: [{ id: "h1", scope: "Subcampo 01", subfield: "SC01", items: [{}, {}, {}], received_by_name: "Laura Gómez", received_by_role: "Interventora", received_on: day(-2), notes: null }],
  });
  db.rpc.client_decide_certificate = (args) => {
    if (args.p_decision === "observada" && String(args.p_note ?? "").trim().length < 5) throw new Error("Escribe qué hay que corregir en el acta");
    decisions.push(args);
    Object.assign(cert, { client_status: args.p_decision, client_note: args.p_note || null, client_decided_name: "Laura Gómez (Helios)", client_decided_at: `${day(0)}T15:00:00Z` });
    return null;
  };
  return { db, decisions };
}

test("el cliente entra a su portal y devuelve un acta con observaciones", async ({ page }) => {
  const { db, decisions } = clientDb();
  await mockSupabase(page, db);
  await page.goto("/dashboard");
  // Sin membresías va a su portal, sin el menú del equipo
  await expect(page).toHaveURL(/\/cliente$/);
  await expect(page.getByText("Portal del cliente")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gerencia" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Actas de cobro (1 por revisar)" })).toBeVisible();
  const row = page.getByRole("row", { name: /^1 / });
  await expect(row).toContainText("$7.904.000");
  await expect(row).toContainText("Por revisar");
  await row.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("row", { name: /BA-HIN · Hincado de pilotes 104 pilotes/ })).toBeVisible();
  await expect(page.getByText("NETO A PAGAR", { exact: true })).toBeVisible();
  // Devolver sin decir qué corregir no se permite
  await page.getByRole("button", { name: "Devolver con observaciones" }).click();
  await expect(page.getByText("Escribe qué hay que corregir en el acta.")).toBeVisible();
  await page.getByLabel(/Observaciones/).fill("Faltan las memorias de cantidades del subcampo 2");
  await page.getByRole("button", { name: "Devolver con observaciones" }).click();
  await expect(page.getByRole("row", { name: /^1 / })).toContainText("Con observaciones");
  expect(decisions).toEqual([{ p_id: "pc1", p_decision: "observada", p_note: "Faltan las memorias de cantidades del subcampo 2" }]);

  await page.getByRole("tab", { name: "Entregas del punch list" }).click();
  await expect(page.getByRole("row", { name: /Subcampo 01 3 Laura Gómez · Interventora/ })).toBeVisible();
  await page.getByRole("tab", { name: "Avance de obra" }).click();
  await expect(page.getByText(/sin costos internos del contratista/)).toBeVisible();
});

test("el administrador da acceso al portal a un cliente desde Equipo", async ({ page }) => {
  const db = buildDb();
  db.tables.project_clients = [];
  const calls: Record<string, unknown>[] = [];
  db.functions = {
    ...db.functions,
    "team-create-user": (body) => {
      calls.push(body);
      db.tables.project_clients!.push({ project_id: PROJECT_ID, user_id: "u-cliente", name: body.name, company: body.company, created_at: `${day(0)}T12:00:00Z` });
      return [200, { status: "created", user_id: "u-cliente" }];
    },
  };
  await mockSupabase(page, db);
  await page.goto("/equipo");
  await expect(page.getByRole("heading", { name: "Acceso del cliente" })).toBeVisible();
  await page.getByPlaceholder("p. ej. Laura Gómez").fill("Laura Gómez");
  await page.getByPlaceholder("p. ej. Interventoría ABC").fill("Helios");
  await page.getByLabel("Correo del cliente").fill("laura@helios.co");
  await page.getByRole("button", { name: "Generar" }).last().click();
  await page.getByRole("button", { name: "Dar acceso al portal" }).click();
  await expect(page.getByText("Laura Gómez ya puede entrar al portal del cliente.")).toBeVisible();
  await expect(page.getByText(/\/cliente con tu correo laura@helios.co/)).toBeVisible();
  expect(calls[0]).toMatchObject({ project_id: PROJECT_ID, role: "client", name: "Laura Gómez", company: "Helios", email: "laura@helios.co" });
  await expect(page.getByRole("listitem").filter({ hasText: "Laura Gómez · Helios" })).toBeVisible();
});

test("el cliente aprueba en su portal una orden de cambio", async ({ page }) => {
  const { db } = clientDb();
  const base = db.rpc.client_project!;
  const order = {
    id: "co1",
    number: 1,
    title: "Pilotes adicionales sector norte",
    description: "Ampliación pedida por el cliente",
    reason: "cliente",
    days_extension: 5,
    status: "enviada",
    amount: 800_000,
    decided_name: null,
    decided_at: null,
    decision_note: null,
    items: [{ activity: "BA-HIN · Hincado de pilotes", unit: "pilotes", delta_qty: 10, new_unit_price: null, is_new: false }],
  };
  db.rpc.client_project = (args) => ({ ...(base(args) as object), change_orders: [order], settlement: null });
  const calls: Record<string, unknown>[] = [];
  db.rpc.client_decide_change_order = (args) => {
    calls.push(args);
    Object.assign(order, { status: "aprobada", decided_name: "Laura Gómez (Helios)", decided_at: `${day(0)}T15:00:00Z` });
    return null;
  };
  await mockSupabase(page, db);
  await page.goto("/cliente");
  await page.getByRole("tab", { name: "Órdenes de cambio (1 por revisar)" }).click();
  await expect(page.getByRole("heading", { name: "Orden de cambio N° 1 · Pilotes adicionales sector norte" })).toBeVisible();
  await expect(page.getByText("Prórroga solicitada: 5 días.")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Aprobar orden de cambio" }).click();
  await expect(page.getByText(/Aprobada.*por Laura Gómez \(Helios\)/)).toBeVisible();
  expect(calls).toEqual([{ p_id: "co1", p_approve: true, p_note: "" }]);
});
