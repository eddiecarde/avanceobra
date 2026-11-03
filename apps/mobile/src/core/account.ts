/** Regla de contraseña (la misma de la web): al menos 10 caracteres, con letras y números. */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return "La contraseña debe tener al menos 10 caracteres, con letras y números.";
  if (password !== again) return "Las dos contraseñas no coinciden.";
  return null;
}

/** ¿Entró con una contraseña temporal (creada o restablecida por el administrador)? */
export const mustChangePassword = (session: { user: { user_metadata?: Record<string, unknown> } } | null) => Boolean(session?.user.user_metadata?.must_change_password);
