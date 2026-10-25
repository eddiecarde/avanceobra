import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../state/session";
import { useTheme } from "../../ui/theme";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 24 }}>{glyph}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  const { role } = useSession();
  const canReview = role === "resident" || role === "admin";
  // La barra crece con el espacio de los botones del sistema para no quedar debajo de ellos
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerTitleStyle: { fontSize: 22, fontWeight: "800" },
        tabBarStyle: { backgroundColor: t.bg, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8), borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: "700" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Registrar", tabBarIcon: icon("✚") }} />
      <Tabs.Screen name="plano" options={{ title: "Plano", tabBarIcon: icon("▦") }} />
      <Tabs.Screen name="pendientes" options={{ title: "Pendientes", tabBarIcon: icon("⚑") }} />
      <Tabs.Screen name="revisar" options={{ title: "Revisar", tabBarIcon: icon("✔"), href: canReview ? undefined : null }} />
      <Tabs.Screen name="sync" options={{ title: "Sincronía", tabBarIcon: icon("⟳") }} />
    </Tabs>
  );
}
