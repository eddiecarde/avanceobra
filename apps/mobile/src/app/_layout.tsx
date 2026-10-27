import "@azure/core-asynciterator-polyfill";
import "react-native-get-random-values";
import { PowerSyncContext } from "@powersync/react";
import { Redirect, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { mustChangePassword } from "../core/account";
import { db } from "../db/database";
import { SessionProvider, useSession } from "../state/session";
import { NoticeWatcher } from "../ui/NoticeWatcher";
import { SyncBanner } from "../ui/SyncBanner";
import { useTheme } from "../ui/theme";

function Gate() {
  const { ready, session } = useSession();
  const segments = useSegments();
  const t = useTheme();
  if (!ready)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    );
  const inLogin = segments[0] === "login";
  const inChange = segments[0] === "cambiar-clave";
  const mustChange = mustChangePassword(session);
  if (!session && !inLogin) return <Redirect href="/login" />;
  // Contraseña temporal: primero crea la suya
  if (session && mustChange && !inChange) return <Redirect href="/cambiar-clave" />;
  if (session && (inLogin || (inChange && !mustChange))) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {session ? <SyncBanner /> : null}
      {session ? <NoticeWatcher /> : null}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerTitleStyle: { fontSize: 22, fontWeight: "800" },
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="cambiar-clave" options={{ title: "Tu contraseña", headerBackVisible: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="registro/[frontId]/index" options={{ title: "Actividad" }} />
        <Stack.Screen name="registro/[frontId]/[activityId]" options={{ title: "Registrar avance" }} />
        <Stack.Screen name="marcar" options={{ title: "Marcar en el plano" }} />
        <Stack.Screen name="parte" options={{ title: "Parte diario" }} />
        <Stack.Screen name="entregas" options={{ title: "Entregas de material" }} />
        <Stack.Screen name="escanear" options={{ title: "Escanear código", presentation: "modal" }} />
        <Stack.Screen name="hallazgo/nuevo" options={{ title: "Nuevo hallazgo" }} />
        <Stack.Screen name="hallazgo/[id]" options={{ title: "Hallazgo" }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PowerSyncContext.Provider value={db}>
          <SessionProvider>
            <StatusBar style="auto" />
            <Gate />
          </SessionProvider>
        </PowerSyncContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
