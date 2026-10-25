import * as Updates from "expo-updates";
import { Alert } from "react-native";

/**
 * Revisa al abrir la app si hay una versión nueva publicada (OTA). Si la hay, la descarga
 * y ofrece reiniciar de inmediato, en vez de esperar a que Android cierre la app del todo.
 * Sin señal no hace nada: la versión actual sigue funcionando.
 */
export async function checkForAppUpdate() {
  if (!Updates.isEnabled || __DEV__) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return;
    Alert.alert("Nueva versión lista", "Se descargó una actualización de AvanceObra. Tus datos no se pierden.", [
      { text: "Más tarde", style: "cancel" },
      { text: "Reiniciar ahora", onPress: () => void Updates.reloadAsync() },
    ]);
  } catch {
    // Sin señal o servidor no disponible: se intenta en la próxima apertura.
  }
}

/** Texto corto para soporte: "1.1.0 · actualización 01a160ec" o "1.1.0 · versión instalada". */
export function versionLabel(): string {
  const rt = Updates.runtimeVersion ?? "dev";
  if (!Updates.isEnabled) return `${rt} · desarrollo`;
  return Updates.isEmbeddedLaunch || !Updates.updateId ? `${rt} · versión instalada` : `${rt} · actualización ${Updates.updateId.slice(0, 8)}`;
}
