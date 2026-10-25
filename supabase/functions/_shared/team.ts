/**
 * Reglas para crear usuarios del equipo desde la web (Edge Function team-create-user).
 * Módulo puro para probarlo con Vitest.
 */
export const ROLES = ["field", "resident", "director", "admin"] as const;
/** "client" no es un rol del equipo: da acceso solo al portal del cliente (tabla project_clients). */
export type TeamRole = (typeof ROLES)[number] | "client";

export interface NewMember {
  project_id: string;
  email: string;
  name: string;
  role: TeamRole;
  password: string;
  /** Empresa del cliente (solo para role = "client"). */
  company: string | null;
}

/** Valida la solicitud; devuelve el miembro normalizado o la lista de errores (en español). */
export function validateNewMember(body: unknown): { ok: true; value: NewMember } | { ok: false; errors: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const email = String(b.email ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim();
  const role = String(b.role ?? "");
  const password = String(b.password ?? "");
  const project = String(b.project_id ?? "");
  const company = String(b.company ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(project)) errors.push("Falta el proyecto.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push("El correo no es válido.");
  if (name.length < 2) errors.push("Escribe el nombre de la persona.");
  if (role !== "client" && !(ROLES as readonly string[]).includes(role)) errors.push("El rol no es válido.");
  if (role === "client" && name.length < 3) errors.push("Escribe el nombre completo del cliente.");
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    errors.push("La contraseña temporal debe tener al menos 10 caracteres, con letras y números.");
  return errors.length ? { ok: false, errors } : { ok: true, value: { project_id: project, email, name, role: role as TeamRole, password, company: role === "client" && company ? company : null } };
}

/** Encabezados CORS: la web (Vercel o local) llama a la función desde el navegador. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
