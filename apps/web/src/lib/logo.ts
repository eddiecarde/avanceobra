"use client";

import { supabase } from "./supabase";

/** URL pública del logo (bucket "logos"); null si no hay. */
export const logoUrl = (path: string | null | undefined) => (path ? supabase.storage.from("logos").getPublicUrl(path).data.publicUrl : null);

/** Logo de la obra si tiene uno propio; si no, el de su empresa (la consulta trae la empresa como objeto o lista). */
export function projectLogo(p: { logo_path?: string | null; org?: unknown }) {
  const org = (Array.isArray(p.org) ? p.org[0] : p.org) as { logo_path?: string | null } | null | undefined;
  return logoUrl(p.logo_path ?? org?.logo_path ?? null);
}
