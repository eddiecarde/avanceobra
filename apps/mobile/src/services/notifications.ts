import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("alertas", {
      name: "Alertas de obra",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") await Notifications.requestPermissionsAsync();
}

/** Notificación local inmediata: funciona sin señal, al momento de guardar. */
export async function notifyLocal(title: string, body: string, data: Record<string, unknown> = {}) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: Platform.OS === "android" ? { channelId: "alertas" } : null,
  });
}

/**
 * Registra el token de push del teléfono para recibir alertas con la app cerrada.
 * En Android requiere Firebase (FCM) configurado en Expo; si aún no lo está, se omite en silencio
 * y las alertas siguen llegando por los demás canales.
 */
export async function registerPushToken(userId: string) {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await supabase.from("device_tokens").upsert(
      { token, user_id: userId, platform: Platform.OS === "ios" ? "ios" : "android", updated_at: new Date().toISOString() },
      { onConflict: "token" },
    );
  } catch {
    // Sin FCM o sin señal: se reintenta en el próximo inicio.
  }
}
