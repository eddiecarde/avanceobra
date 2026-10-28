import { supabase } from "./supabase";

/**
 * Asistente con modelos de Meta (Edge Function ai-assist). Necesita señal: sin señal devuelve un error
 * claro y lo escrito queda guardado en el borrador para intentarlo después.
 */
export async function callAi<T>(action: string, body: Record<string, unknown>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-assist", { body: { action, ...body } });
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      if (detail?.error) return { data: null, error: String(detail.error) };
      return { data: null, error: "Sin señal o el asistente no respondió. Lo escrito queda guardado: inténtalo cuando haya señal." };
    }
    return { data: data as T, error: null };
  } catch {
    return { data: null, error: "Sin señal. Lo escrito queda guardado: inténtalo cuando haya señal." };
  }
}
