import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

export interface AiMarksData {
  width: number | null;
  height: number | null;
  boxes: { x1: number; y1: number; x2: number; y2: number; c: number | null }[];
}

/** Foto con las zonas que marcó SAM 3.1 (cajas en píxeles de la foto original, escaladas al ancho visible). */
export function AiMarks({ uri, marks }: { uri: string; marks: AiMarksData }) {
  const [w, setW] = useState(0);
  if (!marks.width || !marks.height) return null;
  const scale = w / marks.width;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ width: "100%", aspectRatio: marks.width / marks.height, borderRadius: 8, overflow: "hidden" }}>
      <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" accessibilityLabel="Foto con las zonas marcadas por la IA" />
      {w
        ? marks.boxes.map((b, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: b.x1 * scale,
                top: b.y1 * scale,
                width: (b.x2 - b.x1) * scale,
                height: (b.y2 - b.y1) * scale,
                borderWidth: 3,
                borderColor: "#E11D48",
                borderRadius: 4,
              }}
            />
          ))
        : null}
    </View>
  );
}
