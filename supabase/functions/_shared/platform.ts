/**
 * Alta de una empresa desde el panel del dueño (Edge Function platform-create-company).
 * Módulo puro para probarlo con Vitest.
 */
/** Planes: obras y usuarios permitidos y días de prueba (null = sin límite). */
export const PLANS = {
  prueba: { label: "Prueba", maxProjects: 1, maxUsers: 10, days: 30 },
  basico: { label: "Básico", maxProjects: 1, maxUsers: 15, days: null },
  profesional: { label: "Profesional", maxProjects: 5, maxUsers: 60, days: null },
  empresa: { label: "Empresa", maxProjects: null, maxUsers: null, days: null },
} as const;
export type Plan = keyof typeof PLANS;

export interface NewCompany {
  company_name: string;
  tax_id: string | null;
  admin_name: string;
  admin_email: string;
  password: string;
  project_name: string;
  project_code: string;
  start: string;
  end: string;
  plan: Plan;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Valida la solicitud; devuelve la empresa normalizada o la lista de errores (en español). */
export function validateNewCompany(body: unknown): { ok: true; value: NewCompany } | { ok: false; errors: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = (k: string) => String(b[k] ?? "").trim();
  const value: NewCompany = {
    company_name: s("company_name"),
    tax_id: s("tax_id") || null,
    admin_name: s("admin_name"),
    admin_email: s("admin_email").toLowerCase(),
    password: String(b.password ?? ""),
    project_name: s("project_name"),
    project_code: s("project_code").toUpperCase().replace(/\s+/g, "-"),
    start: s("start"),
    end: s("end"),
    plan: (s("plan") || "prueba") as Plan,
  };
  const errors: string[] = [];
  if (value.company_name.length < 3) errors.push("Escribe el nombre de la empresa.");
  if (value.admin_name.length < 3) errors.push("Escribe el nombre del administrador.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.admin_email)) errors.push("El correo del administrador no es válido.");
  if (value.password.length < 10 || !/[A-Za-z]/.test(value.password) || !/\d/.test(value.password))
    errors.push("La contraseña temporal debe tener al menos 10 caracteres, con letras y números.");
  if (value.project_name.length < 3) errors.push("Escribe el nombre de la primera obra.");
  if (value.project_code.length < 2 || value.project_code.length > 20) errors.push("El código de la obra debe tener entre 2 y 20 caracteres.");
  if (!(value.plan in PLANS)) errors.push("El plan no es válido.");
  if (!isDate(value.start) || !isDate(value.end)) errors.push("Faltan las fechas de la obra.");
  else if (value.end <= value.start) errors.push("La terminación debe ser posterior al inicio.");
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
