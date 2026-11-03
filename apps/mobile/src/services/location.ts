import * as Location from "expo-location";

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number | null;
}

/**
 * GPS automático: intenta una lectura fresca con tiempo límite y, si no llega
 * (sin cielo abierto, dentro de estructura), usa la última posición conocida.
 * El GPS funciona sin datos móviles.
 */
export async function getFix(timeoutMs = 8000): Promise<Fix | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;
  const fresh = Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  const pos = (await fresh) ?? (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }));
  if (!pos) return null;
  return { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
}
