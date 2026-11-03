import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  powersyncUrl: process.env.EXPO_PUBLIC_POWERSYNC_URL ?? "",
  /** Usuario del bot de Telegram (sin @). Vacío = no se muestra el botón de vincular. */
  telegramBot: process.env.EXPO_PUBLIC_TELEGRAM_BOT ?? "",
  /** Estilo base del mapa (configurable para usar satélite propio). */
  mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty",
};

export const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && config.powersyncUrl);

/**
 * La sesión se guarda en AsyncStorage para que la app siga funcionando sin señal
 * después del primer inicio de sesión (el token se refresca al volver la conexión).
 */
export const supabase = createClient(config.supabaseUrl || "http://localhost", config.supabaseAnonKey || "anon", {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
