import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { localPhotoFile } from "../services/photos";
import { supabase } from "../services/supabase";
import { useTheme } from "./theme";

export interface PhotoItem {
  id: string;
  /** URI local conocida (fotos recién tomadas). */
  uri?: string;
  /** Ruta en Storage, para fotos tomadas en otro dispositivo. */
  storagePath?: string | null;
}

/** Usa el archivo local si existe; si no, una URL firmada temporal (requiere señal). */
function usePhotoUri(p: PhotoItem): string | null {
  const [uri, setUri] = useState<string | null>(p.uri ?? null);
  useEffect(() => {
    if (p.uri) return;
    const local = localPhotoFile(p.id);
    if (local.exists) return setUri(local.uri);
    if (!p.storagePath) return;
    let alive = true;
    supabase.storage
      .from("photos")
      .createSignedUrl(p.storagePath, 3600)
      .then(({ data }) => alive && data && setUri(data.signedUrl))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [p.id, p.uri, p.storagePath]);
  return uri;
}

function Thumb({ photo, onRemove }: { photo: PhotoItem; onRemove?: (id: string) => void }) {
  const t = useTheme();
  const uri = usePhotoUri(photo);
  return (
    <Pressable
      accessibilityLabel={onRemove ? "Mantener presionado para quitar la foto" : "Foto"}
      onLongPress={() => onRemove?.(photo.id)}
      style={{ width: 110, height: 110, borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: t.border, backgroundColor: t.surface }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: 110, height: 110 }} contentFit="cover" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>Foto sin descargar</Text>
        </View>
      )}
      {onRemove ? (
        <View style={{ position: "absolute", right: 0, top: 0, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 6 }}>
          <Text style={{ color: "#fff", fontSize: 12 }}>mantener: quitar</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function PhotoStrip({ photos, onRemove }: { photos: PhotoItem[]; onRemove?: (id: string) => void }) {
  if (photos.length === 0) return null;
  return (
    <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
      {photos.map((p) => (
        <Thumb key={p.id} photo={p} onRemove={onRemove} />
      ))}
    </ScrollView>
  );
}

export const fileExists = (uri: string) => new File(uri).exists;
