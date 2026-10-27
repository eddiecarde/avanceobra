import { describe, expect, it } from "vitest";
import { validateNewCompany } from "../functions/_shared/platform.ts";

const ok = {
  company_name: " Constructora Andina SAS ",
  tax_id: "900123456-7",
  admin_name: "Carolina Ruiz",
  admin_email: " Carolina@Andina.CO ",
  password: "Andina2026segura",
  project_name: "Parque Solar Norte",
  project_code: "psn 01",
  start: "2026-11-02",
  end: "2027-05-30",
};

describe("alta de empresa desde el panel del dueño", () => {
  it("normaliza nombre, correo y código de la obra", () => {
    const r = validateNewCompany(ok);
    expect(r.ok && r.value).toMatchObject({ company_name: "Constructora Andina SAS", admin_email: "carolina@andina.co", project_code: "PSN-01", tax_id: "900123456-7" });
  });
  it("rechaza datos incompletos con mensajes claros", () => {
    const r = validateNewCompany({ ...ok, company_name: "A", admin_email: "x@", password: "123", end: "2026-10-01", tax_id: "" });
    expect(!r.ok && r.errors).toEqual([
      "Escribe el nombre de la empresa.",
      "El correo del administrador no es válido.",
      "La contraseña temporal debe tener al menos 10 caracteres, con letras y números.",
      "La terminación debe ser posterior al inicio.",
    ]);
    expect(validateNewCompany(null).ok).toBe(false);
  });
});
