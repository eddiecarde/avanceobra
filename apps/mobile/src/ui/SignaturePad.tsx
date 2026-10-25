import { Canvas, Path, Skia, useCanvasRef, ImageFormat, type SkPath } from "@shopify/react-native-skia";
import { useRef, useState } from "react";
import { Modal, View } from "react-native";
import { BigButton, Row, Title } from "./components";
import { useTheme } from "./theme";

/** Firma con el dedo; devuelve el PNG en base64 (fondo blanco para que se vea en el PDF). */
export function SignaturePad(props: { visible: boolean; onCancel: () => void; onSave: (base64Png: string) => void; title?: string }) {
  const t = useTheme();
  const ref = useCanvasRef();
  const [paths, setPaths] = useState<SkPath[]>([]);
  const current = useRef<SkPath | null>(null);
  const [, force] = useState(0);

  const save = () => {
    const img = ref.current?.makeImageSnapshot();
    if (!img) return;
    props.onSave(img.encodeToBase64(ImageFormat.PNG, 100));
    setPaths([]);
  };

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onCancel}>
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, gap: 12 }}>
        <Title>{props.title ?? "Firma del supervisor"}</Title>
        <View
          style={{ flex: 1, borderWidth: 2, borderColor: t.border, borderRadius: 12, overflow: "hidden" }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            const p = Skia.Path.Make();
            p.moveTo(e.nativeEvent.locationX, e.nativeEvent.locationY);
            current.current = p;
            setPaths((ps) => [...ps, p]);
          }}
          onResponderMove={(e) => {
            current.current?.lineTo(e.nativeEvent.locationX, e.nativeEvent.locationY);
            force((n) => n + 1);
          }}
          onResponderRelease={() => (current.current = null)}
        >
          <Canvas ref={ref} style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
            {paths.map((p, i) => (
              <Path key={i} path={p} style="stroke" strokeWidth={4} color="#000000" strokeCap="round" strokeJoin="round" />
            ))}
          </Canvas>
        </View>
        <Row>
          <BigButton title="Borrar" onPress={() => setPaths([])} style={{ flex: 1 }} />
          <BigButton title="Cancelar" onPress={props.onCancel} style={{ flex: 1 }} />
        </Row>
        <BigButton title="Guardar firma" variant="primary" large disabled={paths.length === 0} onPress={save} />
      </View>
    </Modal>
  );
}
