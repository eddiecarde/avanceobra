import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { Modal, View } from "react-native";
import { BigButton, Body } from "./components";
import { useTheme } from "./theme";

/** Lector de QR / código de barras para un campo del formato (funciona sin señal). */
export function QrModal({ visible, onCode, onClose }: { visible: boolean; onCode: (code: string) => void; onClose: () => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const t = useTheme();
  const done = useRef(false);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => (done.current = false)}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {perm?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "datamatrix"] }}
            onBarcodeScanned={(r) => {
              if (done.current) return;
              done.current = true;
              onCode(r.data);
            }}
          />
        ) : (
          <View style={{ flex: 1, padding: 16, gap: 12, justifyContent: "center" }}>
            <Body>Se necesita la cámara para leer el código.</Body>
            <BigButton title="Permitir cámara" variant="primary" onPress={requestPerm} />
          </View>
        )}
        <View style={{ padding: 16 }}>
          <BigButton title="Cancelar" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
