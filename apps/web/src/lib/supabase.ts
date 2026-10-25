"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de navegador. Usa la clave publishable (pública): los permisos los decide RLS
 * en la base, igual que en la app móvil. El administrador ve y edita lo de su empresa.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
