import { useColorScheme } from "react-native";

/**
 * Alto contraste para leer bajo sol directo y botones de mínimo 64 dp para usar con guantes.
 * El modo oscuro sigue la configuración del teléfono.
 */
export const palettes = {
  light: {
    bg: "#FFFFFF",
    surface: "#F1F3F5",
    text: "#0B0D0F",
    muted: "#3D444B",
    border: "#0B0D0F",
    primary: "#0047AB",
    primaryText: "#FFFFFF",
    success: "#0A7D2C",
    warning: "#B45309",
    danger: "#B91C1C",
    offline: "#4B5563",
  },
  dark: {
    bg: "#000000",
    surface: "#16191D",
    text: "#FFFFFF",
    muted: "#C9CED4",
    border: "#FFFFFF",
    primary: "#4D9BFF",
    primaryText: "#000000",
    success: "#34D27A",
    warning: "#FBBF24",
    danger: "#FF6B6B",
    offline: "#9CA3AF",
  },
};

export type Palette = typeof palettes.light;

export const sizes = {
  touch: 64,
  touchLarge: 84,
  radius: 14,
  gap: 12,
  pad: 16,
  font: 20,
  fontLarge: 26,
  fontHuge: 44,
};

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? palettes.dark : palettes.light;
}

export const severityColor = (p: Palette, s: string) =>
  s === "critical" ? p.danger : s === "high" ? p.warning : s === "medium" ? p.primary : p.muted;
