import "react-native-get-random-values";
import { v7 as uuidv7 } from "uuid";
import * as Device from "expo-device";

/** UUID v7: ordenable por tiempo y generado offline, así el registro tiene identidad definitiva desde el campo. */
export const newId = (): string => uuidv7();

export const deviceId = `${Device.osName ?? "device"}-${Device.modelId ?? Device.modelName ?? "x"}`;

export const nowIso = () => new Date().toISOString();

/** Fecha de trabajo en hora de Colombia (no la del teléfono ni UTC). */
export function todayLocal(timeZone = "America/Bogota"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
