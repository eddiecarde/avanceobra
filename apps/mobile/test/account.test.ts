import { describe, expect, it } from "vitest";
import { mustChangePassword, passwordProblem } from "../src/core/account";

describe("contraseña", () => {
  it("exige 10 caracteres con letras y números, y que coincidan", () => {
    expect(passwordProblem("corta1", "corta1")).toMatch(/al menos 10/);
    expect(passwordProblem("sololetrasaqui", "sololetrasaqui")).toMatch(/letras y números/);
    expect(passwordProblem("Obra2026segura", "Obra2026segurx")).toBe("Las dos contraseñas no coinciden.");
    expect(passwordProblem("Obra2026segura", "Obra2026segura")).toBeNull();
  });
  it("detecta la contraseña temporal", () => {
    expect(mustChangePassword({ user: { user_metadata: { must_change_password: true } } })).toBe(true);
    expect(mustChangePassword({ user: { user_metadata: {} } })).toBe(false);
    expect(mustChangePassword(null)).toBe(false);
  });
});
