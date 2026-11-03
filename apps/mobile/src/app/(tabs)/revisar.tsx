import { useQuery } from "@powersync/react";
import { useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import { REJECT_REASONS, reviewFlags, reviewOrder } from "../../core/review";
import { todayLocal } from "../../services/ids";
import { reviewEntry } from "../../services/entries";
import { useSession } from "../../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Row, Screen } from "../../ui/components";
import { useTheme } from "../../ui/theme";
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
  const t = useTheme();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [motive, setMotive] = useState<string | null>(null);

  const { data: entries } = useQuery<{
    id: string; work_date: string; quantity: number; unit: string; activity: string; front: string; author: string | null;
    notes: string; lost_hours: number; loss_cause: string; losses: string | null; elements: number; area: number | null;
    activity_id: string; contract_qty: number; executed_before: number; lat: number | null;
  }>(
    `SELECT e.id, e.work_date, e.quantity, a.unit, a.name AS activity, f.code AS front, m.member_name AS author,
            e.notes, e.lost_hours, e.loss_cause, e.losses, e.activity_id, a.contract_qty, e.lat,
            (SELECT COALESCE(SUM(x.quantity), 0) FROM progress_entries x WHERE x.activity_id = e.activity_id AND x.id != e.id
               AND x.status IN ('approved', 'submitted') AND (x.work_date < e.work_date OR (x.work_date = e.work_date AND x.client_created_at < e.client_created_at))) AS executed_before,
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

  // Cantidades aprobadas recientes de cada actividad, para ver qué es lo usual
  const { data: history } = useQuery<{ activity_id: string; quantity: number }>(
    "SELECT activity_id, quantity FROM progress_entries WHERE project_id = ? AND status = 'approved' AND activity_id IN (SELECT activity_id FROM progress_entries WHERE status = 'submitted') ORDER BY work_date DESC LIMIT 2000",
    [projectId ?? ""],
  );
  const today = todayLocal();
  const ordered = useMemo(() => {
    const usual = new Map<string, number[]>();
    for (const h of history) {
      const xs = usual.get(h.activity_id) ?? [];
      if (xs.length < 10) xs.push(Number(h.quantity));
      usual.set(h.activity_id, xs);
    }
    return reviewOrder(
      entries.map((e) => ({
        ...e,
        flags: reviewFlags(
          {
            id: e.id,
            work_date: e.work_date,
            quantity: Number(e.quantity),
            contract_qty: Number(e.contract_qty),
            executed_before: Number(e.executed_before),
            elements: Number(e.elements),
            photos: photos.filter((p) => p.entry_id === e.id).length,
            has_gps: e.lat != null,
            unit: e.unit,
          },
          today,
          usual.get(e.activity_id) ?? [],
        ),
      })),
    );
  }, [entries, photos, history, today]);

  if (role !== "resident" && role !== "admin") return <Screen><Body>Solo el residente o el administrador aprueba registros.</Body></Screen>;

  return (
    <Screen>
      <Label>{`${entries.length} registro(s) por aprobar · primero los que tienen señales, luego los más antiguos`}</Label>
      {ordered.map((e) => (
        <Card key={e.id} accent={e.flags.length ? t.warning : undefined}>
          <Label>{`${e.work_date} · ${e.front} · ${e.author ?? "—"}`}</Label>
          <Body>{`${e.activity}: ${e.quantity.toLocaleString("es-CO")} ${e.unit}`}</Body>
          <Body muted>
            {`Antes: ${Number(e.executed_before).toLocaleString("es-CO")} de ${Number(e.contract_qty).toLocaleString("es-CO")} ${e.unit} · saldo ${Math.max(0, Number(e.contract_qty) - Number(e.executed_before)).toLocaleString("es-CO")}`}
          </Body>
          {e.flags.map((f) => (
            <Text key={f} style={{ color: t.warning, fontWeight: "700", fontSize: 16 }}>{`▲ ${f}`}</Text>
          ))}
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
              <Label>Motivo del rechazo</Label>
              <Chips options={REJECT_REASONS.map((r) => ({ value: r, label: r }))} value={motive} onChange={setMotive} />
              <Input value={reason} onChangeText={setReason} placeholder="Comentario (opcional si elegiste un motivo)" />
              <Row>
                <BigButton
                  title="Cancelar"
                  onPress={() => {
                    setRejecting(null);
                    setMotive(null);
                  }}
                  style={{ flex: 1 }}
                />
                <BigButton
                  title="Rechazar"
                  variant="danger"
                  disabled={!motive && reason.trim().length < 3}
                  onPress={async () => {
                    await reviewEntry(e.id, false, userId!, [motive, reason.trim()].filter(Boolean).join(": "));
                    setRejecting(null);
                    setReason("");
                    setMotive(null);
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
                  Alert.alert("Aprobar registro", e.flags.length ? `Tiene ${e.flags.length} señal(es): ${e.flags.join("; ")}.\n\nUna vez aprobado no se podrá modificar.` : "Una vez aprobado no se podrá modificar.", [
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
