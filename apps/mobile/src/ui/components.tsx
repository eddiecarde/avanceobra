import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useSegments } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { sizes, useTheme } from "./theme";

/**
 * Espacio que ocupan abajo los botones del sistema (atrás, inicio, recientes) o la barra de gestos.
 * Android dibuja la app de borde a borde: sin este margen, lo último de la pantalla queda tapado.
 * Dentro de las pestañas es 0, porque la barra de pestañas ya lo reserva.
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  const inTabs = useSegments()[0] === "(tabs)";
  return inTabs ? 0 : insets.bottom;
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const bottom = useBottomInset();
  // Margen extra al final para que el último botón no quede pegado al borde
  const body = <View style={{ padding: sizes.pad, gap: sizes.gap, paddingBottom: sizes.pad + bottom + (scroll ? 24 : 0) }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["left", "right"]}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.text, fontSize: sizes.fontLarge, fontWeight: "800" }}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 16, fontWeight: "700", textTransform: "uppercase" }}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const t = useTheme();
  return <Text style={{ color: muted ? t.muted : t.text, fontSize: sizes.font }}>{children}</Text>;
}

type Variant = "primary" | "secondary" | "danger" | "success";

/** Botón grande: 64 dp de alto mínimo, texto en negrita, área táctil completa. */
export function BigButton(props: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  large?: boolean;
  right?: ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const v = props.variant ?? "secondary";
  const bg = v === "primary" ? t.primary : v === "danger" ? t.danger : v === "success" ? t.success : t.surface;
  const fg = v === "secondary" ? t.text : t.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      disabled={props.disabled || props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: props.large ? sizes.touchLarge : sizes.touch,
          backgroundColor: bg,
          borderColor: v === "secondary" ? t.border : bg,
          opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        props.style,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: fg, fontSize: props.large ? sizes.fontLarge : sizes.font, fontWeight: "800" }}>{props.title}</Text>
        {props.subtitle ? <Text style={{ color: fg, fontSize: 16, opacity: 0.85 }}>{props.subtitle}</Text> : null}
      </View>
      {props.loading ? <ActivityIndicator color={fg} /> : props.right}
    </Pressable>
  );
}

/** Selector de opciones como fichas grandes (clima, causa, severidad…). */
export function Chips<T extends string>(props: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(o.value)}
            style={{
              minHeight: 52,
              paddingHorizontal: 16,
              justifyContent: "center",
              borderRadius: 26,
              borderWidth: 2,
              borderColor: active ? t.primary : t.border,
              backgroundColor: active ? t.primary : t.bg,
            }}
          >
            <Text style={{ color: active ? t.primaryText : t.text, fontSize: 18, fontWeight: "700" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Input(props: TextInputProps & { big?: boolean }) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...props}
      style={[
        {
          minHeight: props.big ? 88 : sizes.touch,
          borderWidth: 2,
          borderColor: t.border,
          borderRadius: sizes.radius,
          paddingHorizontal: 16,
          color: t.text,
          backgroundColor: t.bg,
          fontSize: props.big ? sizes.fontHuge : sizes.font,
          fontWeight: props.big ? "800" : "500",
        },
        props.style,
      ]}
    />
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", gap: sizes.gap, alignItems: "center" }, style]}>{children}</View>;
}

export function Card({ children, accent }: { children: ReactNode; accent?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: sizes.radius,
        padding: 14,
        gap: 6,
        borderLeftWidth: accent ? 8 : 0,
        borderLeftColor: accent,
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: sizes.radius,
    borderWidth: 2,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
