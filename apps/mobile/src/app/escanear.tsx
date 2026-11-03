import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef } from "react";
import { Alert, View } from "react-native";
import { db } from "../db/database";
import { planSelection } from "../state/draft";
import { useSession } from "../state/session";
import { BigButton, Body, Screen } from "../ui/components";

/**
 * Escanea el QR/código de barras de un elemento (tracker, pilote, tramo, eje, losa)
 * y abre directamente la captura de su actividad con el elemento ya marcado.
 * La búsqueda es local: funciona sin señal.
 */
export default function Escanear() {
  const [perm, requestPerm] = useCameraPermissions();
  const { projectId } = useSession();
  const handled = useRef(false);

  async function onCode(code: string) {
    if (handled.current) return;
    handled.current = true;
    const el = await db.getOptional<{ id: string; activity_id: string | null; front_id: string | null; code: string }>(
      "SELECT id, activity_id, front_id, code FROM elements WHERE project_id = ? AND (qr_code = ? OR code = ?) LIMIT 1",
      [projectId ?? "", code, code],
    );
    if (!el || !el.activity_id || !el.front_id) {
      Alert.alert("Código no encontrado", `No hay un elemento con el código "${code}" en este proyecto.`, [
        { text: "Reintentar", onPress: () => (handled.current = false) },
      ]);
      return;
    }
    planSelection.start(el.activity_id);
    planSelection.addElements([el.id]);
    router.replace({ pathname: "/registro/[frontId]/[activityId]", params: { frontId: el.front_id, activityId: el.activity_id } });
  }

  if (!perm?.granted)
    return (
      <Screen>
        <Body>Se necesita la cámara para escanear códigos.</Body>
        <BigButton title="Permitir cámara" variant="primary" onPress={requestPerm} />
      </Screen>
    );

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "datamatrix"] }}
        onBarcodeScanned={(r) => void onCode(r.data)}
      />
    </View>
  );
}
