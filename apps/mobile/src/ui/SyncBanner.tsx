import { router } from "expo-router";
import { Pressable, Text } from "react-native";
import { useSyncSummary } from "../state/syncState";
import { useTheme } from "./theme";

/** Indicador siempre visible: "Sin conexión / Sincronizando / Sincronizado" + pendientes. */
export function SyncBanner() {
  const t = useTheme();
  const s = useSyncSummary();
  const bg = s.state === "offline" ? t.offline : s.state === "syncing" ? t.warning : t.success;
  const icon = s.state === "offline" ? "⦸" : s.state === "syncing" ? "⟳" : "✓";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Estado de sincronización: ${s.label}`}
      onPress={() => router.push("/(tabs)/sync")}
      style={{ backgroundColor: bg, paddingVertical: 8, paddingHorizontal: 16 }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "800" }}>
        {icon} {s.label}
      </Text>
    </Pressable>
  );
}
