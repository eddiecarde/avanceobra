import { addDays } from "@avanceobra/engine";
import { useQuery } from "@powersync/react";
import { useState } from "react";
import { Alert } from "react-native";
import { parseQty } from "../core/quality";
import { todayLocal } from "../services/ids";
import { recordDelivery } from "../services/materials";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Screen, Title } from "../ui/components";

const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** Entregas de material recibidas en obra (remisión y proveedor). Funciona sin señal. */
export default function Entregas() {
  const { projectId, userId } = useSession();
  const today = todayLocal();
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(today);
  const [document, setDocument] = useState("");
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: materials } = useQuery<{ id: string; name: string; unit: string; delivered: number | null }>(
    `SELECT m.id, m.name, m.unit, (SELECT SUM(d.quantity) FROM material_deliveries d WHERE d.material_id = m.id) AS delivered
     FROM materials m WHERE m.project_id = ? ORDER BY m.name`,
    [projectId ?? ""],
  );
  const { data: recent } = useQuery<{ id: string; name: string; unit: string; delivered_on: string; quantity: number; document: string | null; supplier: string | null }>(
    `SELECT d.id, m.name, m.unit, d.delivered_on, d.quantity, d.document, d.supplier
     FROM material_deliveries d JOIN materials m ON m.id = d.material_id
     WHERE d.project_id = ? ORDER BY d.delivered_on DESC, d.created_at DESC LIMIT 15`,
    [projectId ?? ""],
  );
  // Proveedor de la última entrega del material elegido, para no escribirlo cada vez
  const { data: last } = useQuery<{ supplier: string | null }>(
    "SELECT supplier FROM material_deliveries WHERE material_id = ? AND supplier IS NOT NULL ORDER BY delivered_on DESC LIMIT 1",
    [materialId ?? ""],
  );
  const material = materials.find((m) => m.id === materialId);

  async function save() {
    if (!projectId || !userId || !material) return;
    const quantity = parseQty(qty);
    if (!(quantity > 0)) return Alert.alert("Falta la cantidad", `Escribe cuántos ${material.unit} llegaron.`);
    setSaving(true);
    try {
      await recordDelivery({ projectId, userId, materialId: material.id, deliveredOn: date, quantity, document, supplier: supplier || last[0]?.supplier || "" });
      Alert.alert("Entrega guardada", `${fmt(quantity)} ${material.unit} de ${material.name}. Sube sola cuando haya señal.`);
      setQty("");
      setDocument("");
      setSupplier("");
    } catch (e) {
      Alert.alert("No se pudo guardar", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>Entregas de material</Title>
      {materials.length === 0 ? (
        <Body muted>No hay materiales en este proyecto. El residente los crea en la web, en Materiales (requiere señal la primera vez).</Body>
      ) : (
        <>
          <Label>¿Qué llegó?</Label>
          <Chips options={materials.map((m) => ({ value: m.id, label: m.name }))} value={materialId} onChange={setMaterialId} />
          {material ? (
            <>
              <Body muted>{`Entregado hasta hoy: ${fmt(Number(material.delivered ?? 0))} ${material.unit}`}</Body>
              <Label>{`Cantidad (${material.unit})`}</Label>
              <Input big keyboardType="decimal-pad" value={qty} onChangeText={setQty} placeholder="0" accessibilityLabel="Cantidad entregada" />
              <Label>Fecha</Label>
              <Chips
                options={[
                  { value: today, label: "Hoy" },
                  { value: addDays(today, -1), label: "Ayer" },
                ]}
                value={date}
                onChange={setDate}
              />
              <Label>Remisión o factura</Label>
              <Input value={document} onChangeText={setDocument} placeholder="p. ej. REM-1024" accessibilityLabel="Remisión" />
              <Label>Proveedor</Label>
              <Input value={supplier} onChangeText={setSupplier} placeholder={last[0]?.supplier ?? "p. ej. Aceros del Norte"} accessibilityLabel="Proveedor" />
              <BigButton title={saving ? "Guardando…" : "Guardar entrega"} variant="primary" large disabled={saving} onPress={() => void save()} />
            </>
          ) : null}
        </>
      )}
      {recent.length > 0 ? (
        <Card>
          <Label>Últimas entregas</Label>
          {recent.map((r) => (
            <Body key={r.id}>{`${r.delivered_on} · ${r.name}: ${fmt(Number(r.quantity))} ${r.unit}${r.document ? ` · ${r.document}` : ""}${r.supplier ? ` · ${r.supplier}` : ""}`}</Body>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
