import { useQuery } from "@powersync/react";
import { useState } from "react";
import { Alert } from "react-native";
import { reviewEntry } from "../../services/entries";
import { useSession } from "../../state/session";
import { BigButton, Body, Card, Input, Label, Row, Screen } from "../../ui/components";
import { PhotoStrip } from "../../ui/PhotoStrip";

/**
 * Aprobación del residente. Un registro aprobado ya no se puede editar ni borrar
 * (lo garantiza el servidor); las correcciones se hacen con un registro de ajuste.
 */
const CAUSE_LABEL: Record<string, string> = { weather: "Clima", material: "Material", equipment: "Equipo", permits: "Permisos", labor: "Personal", design_client: "Diseño/Cliente", other: "Otra" };
/** "2 h Clima · 1 h Material" (o la única causa de registros anteriores). */
function lossText(e: { lost_hours: number; loss_cause: string; losses: string | null }) {
  let lines: { cause: string; hours: number }[] = [];
  try {
    lines = e.losses ? (JSON.parse(e.losses) as { cause: string; hours: number }[]) : [];
  } catch {
    lines = [];
  }
  if (!lines.length) lines = [{ cause: e.loss_cause, hours: e.lost_hours }];
  return lines.map((l) => `${Number(l.hours).toLocaleString("es-CO")} h ${CAUSE_LABEL[l.cause] ?? l.cause}`).join(" · ");
}

export default function Revisar() {
  const { projectId, userId, role } = useSession();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data: entries } = useQuery<{
    id: string; work_date: string; quantity: number; unit: string; activity: string; front: string; author: string | null;
    notes: string; lost_hours: number; loss_cause: string; losses: string | null; elements: number; area: number | null;
  }>(
    `SELECT e.id, e.work_date, e.quantity, a.unit, a.name AS activity, f.code AS front, m.member_name AS author,
            e.notes, e.lost_hours, e.loss_cause, e.losses,
            (SELECT COUNT(*) FROM entry_elements ee WHERE ee.entry_id = e.id) AS elements,
            (SELECT SUM(area_m2) FROM progress_areas pa WHERE pa.entry_id = e.id) AS area
     FROM progress_entries e JOIN activities a ON a.id = e.activity_id JOIN fronts f ON f.id = e.front_id
     LEFT JOIN memberships m ON m.user_id = e.created_by AND m.project_id = e.project_id
     WHERE e.project_id = ? AND e.status = 'submitted' ORDER BY e.work_date DESC, e.client_created_at DESC LIMIT 100`,
    [projectId ?? ""],
  );
  const { data: photos } = useQuery<{ id: string; entry_id: string; taken_at: string; storage_path: string }>(
    "SELECT id, entry_id, taken_at, storage_path FROM photos WHERE project_id = ? AND entry_id IN (SELECT id FROM progress_entries WHERE status = 'submitted')",
    [projectId ?? ""],
  );

  if (role !== "resident" && role !== "admin") return <Screen><Body>Solo el residente o el administrador aprueba registros.</Body></Screen>;

  return (
    <Screen>
      <Label>{`${entries.length} registro(s) por aprobar`}</Label>
      {entries.map((e) => (
        <Card key={e.id}>
          <Label>{`${e.work_date} · ${e.front} · ${e.author ?? "—"}`}</Label>
          <Body>{`${e.activity}: ${e.quantity.toLocaleString("es-CO")} ${e.unit}`}</Body>
          {e.elements || e.area ? (
            <Body muted>{`${e.elements} elemento(s) marcados${e.area ? ` · área ≈ ${Math.round(e.area)} m²` : ""}`}</Body>
          ) : null}
          {e.lost_hours > 0 ? <Body muted>{`Horas perdidas: ${lossText(e)}`}</Body> : null}
          {e.notes ? <Body muted>{e.notes}</Body> : null}
          <PhotoStrip
            photos={photos.filter((p) => p.entry_id === e.id).map((p) => ({ id: p.id, storagePath: p.storage_path }))}
          />
          {rejecting === e.id ? (
            <>
              <Input value={reason} onChangeText={setReason} placeholder="Motivo del rechazo" />
              <Row>
                <BigButton title="Cancelar" onPress={() => setRejecting(null)} style={{ flex: 1 }} />
                <BigButton
                  title="Rechazar"
                  variant="danger"
                  disabled={reason.trim().length < 3}
                  onPress={async () => {
                    await reviewEntry(e.id, false, userId!, reason.trim());
                    setRejecting(null);
                    setReason("");
                  }}
                  style={{ flex: 1 }}
                />
              </Row>
            </>
          ) : (
            <Row>
              <BigButton title="✕ Rechazar" onPress={() => setRejecting(e.id)} style={{ flex: 1 }} />
              <BigButton
                title="✓ Aprobar"
                variant="success"
                onPress={() =>
                  Alert.alert("Aprobar registro", "Una vez aprobado no se podrá modificar.", [
                    { text: "Cancelar", style: "cancel" },
                    { text: "Aprobar", onPress: () => void reviewEntry(e.id, true, userId!) },
                  ])
                }
                style={{ flex: 1 }}
              />
            </Row>
          )}
        </Card>
      ))}
    </Screen>
  );
}
