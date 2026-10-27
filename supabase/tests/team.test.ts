import { describe, expect, it } from "vitest";
import { validateNewMember, validateReset } from "../functions/_shared/team.ts";

const ok = { project_id: "53f66974-0cdb-45f8-a1e0-20d708ab02a5", email: " Ana.Perez@Obra.CO ", name: "Ana Pérez", role: "resident", password: "Obra2026segura" };

describe("crear usuario del equipo", () => {
  it("normaliza el correo y acepta una solicitud válida", () => {
    const r = validateNewMember(ok);
    expect(r).toEqual({ ok: true, value: { ...ok, email: "ana.perez@obra.co", company: null } });
  });
  it("rechaza datos incompletos o inseguros con mensajes claros", () => {
    const r = validateNewMember({ ...ok, email: "ana@", name: "A", role: "jefe", password: "123456" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual([
      "El correo no es válido.",
      "Escribe el nombre de la persona.",
      "El rol no es válido.",
      "La contraseña temporal debe tener al menos 10 caracteres, con letras y números.",
    ]);
    expect(validateNewMember(null).ok).toBe(false);
  });
  it("acepta un cliente con su empresa (acceso solo al portal)", () => {
    const r = validateNewMember({ ...ok, role: "client", company: " Helios " });
    expect(r.ok && r.value).toMatchObject({ role: "client", company: "Helios" });
    // La empresa solo aplica al cliente
    const member = validateNewMember({ ...ok, company: "X" });
    expect(member.ok && member.value.company).toBeNull();
  });
});

describe("restablecer contraseña", () => {
  const id = "53f66974-0cdb-45f8-a1e0-20d708ab02a5";
  it("acepta persona, obra y contraseña temporal segura; la obra es opcional (dueño)", () => {
    expect(validateReset({ user_id: id, project_id: id, password: "Obra2026segura" })).toEqual({ ok: true, value: { user_id: id, project_id: id, password: "Obra2026segura" } });
    expect(validateReset({ user_id: id, password: "Obra2026segura" }).ok).toBe(true);
  });
  it("rechaza contraseñas débiles o sin persona", () => {
    const r = validateReset({ user_id: "x", password: "123" });
    expect(!r.ok && r.errors).toEqual(["Falta la persona.", "La contraseña temporal debe tener al menos 10 caracteres, con letras y números."]);
  });
});
