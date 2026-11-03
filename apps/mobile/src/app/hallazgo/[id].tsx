import type { FindingStatus, Severity } from "@avanceobra/shared";
import { useQuery } from "@powersync/react";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { ageDays, allowedTransitions, closeNoteError, isOverdue, SEVERITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "../../core/findings";
import { changeFindingStatus, closeFinding } from "../../services/findings";
import { todayLocal } from "../../services/ids";
import { useSession } from "../../state/session";
import { BigButton, Body, Card, Input, Label, Screen, Title } from "../../ui/components";
import { PhotoStrip } from "../../ui/PhotoStrip";
import { usePhotoCapture } from "../../ui/usePhotoCapture";
import { severityColor, useTheme } from "../../ui/theme";

export default function Hallazgo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role, userName } = useSession();
  const cam = usePhotoCapture(() => ({ lat: null, lon: null, user: userName }));
  const t = useTheme();
  const today = todayLocal();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const { data } = useQuery<{
    type: string; severity: Severity; status: FindingStatus; description: string; due_date: string | null;
    created_at: string; front: string | null; responsible: string | null; category: string | null; project_id: string;
  }>(
    `SELECT f.type, f.severity, f.status, f.description, f.due_date, f.created_at, f.category, f.project_id, fr.code AS front, m.member_name AS responsible
     FROM findings f LEFT JOIN fronts fr ON fr.id = f.front_id
     LEFT JOIN memberships m ON m.user_id = f.responsible_user_id AND m.project_id = f.project_id
     WHERE f.id = ?`,
    [id],
  );
  const { data: photos } = useQuery<{ id: string; storage_path: string }>("SELECT id, storage_path FROM photos WHERE finding_id = ?", [id]);
  const f = data[0];
  if (!f) return <Screen><Body muted>Cargando…</Body></Screen>;

  const transitions = role ? allowedTransitions(f.status, role) : [];
  const move = (to: FindingStatus) => {
    // Cerrar pide la nota de verificación (obligatoria en no conformidades y punch)
    if (to === "closed") return setClosing(true);
    Alert.alert("Cambiar estado", `¿Pasar a "${STATUS_LABEL[to]}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Sí", onPress: () => void changeFindingStatus(id, to) },
    ]);
  };
  const close = () => {
    const error = closeNoteError(note);
    if (error) return Alert.alert("Falta la verificación", error);
    // NC y punch: el servidor exige la foto de cómo quedó
    if ((f.category === "no_conformidad" || f.category === "punch") && !cam.photos.length)
      return Alert.alert("Falta la foto de cierre", "Toma al menos una foto de cómo quedó: es la evidencia del cierre.");
    const save = cam.photos.length ? closeFinding(id, f.project_id, note, cam.photos) : changeFindingStatus(id, "closed", note);
    void save.then(() => {
      setClosing(false);
      Alert.alert("Cerrado", "Se cerró con su nota de verificación; se sincroniza al tener señal.");
    });
  };

  return (
    <Screen>
      <Card accent={severityColor(t, f.severity)}>
        <Label>{`${TYPE_LABEL[f.type] ?? f.type} · ${SEVERITY_LABEL[f.severity]} · ${STATUS_LABEL[f.status]}`}</Label>
        <Title>{f.description}</Title>
        <Body>{`Frente: ${f.front ?? "—"} · Responsable: ${f.responsible ?? "sin asignar"}`}</Body>
        <Body>
          {`Fecha límite: ${f.due_date ?? "—"}${isOverdue(f, today) ? " (VENCIDO)" : ""} · Abierto hace ${ageDays(f.created_at, today)} días`}
        </Body>
      </Card>
      <PhotoStrip photos={photos.map((p) => ({ id: p.id, storagePath: p.storage_path }))} />
      {closing ? (
        <Card accent={t.success}>
          <Label>Verificación del cierre</Label>
          <Input value={note} onChangeText={setNote} placeholder="Qué se revisó y cómo quedó" multiline />
          <BigButton title={`📷 Foto de cierre (${cam.photos.length})`} loading={cam.busy} onPress={() => void cam.capture("Cierre")} />
          <PhotoStrip photos={cam.photos} onRemove={cam.remove} />
          <BigButton title="Verificar y cerrar" variant="success" large onPress={close} />
          <BigButton title="Cancelar" onPress={() => setClosing(false)} />
        </Card>
      ) : null}
      {!closing && transitions.map((to) => (
        <BigButton key={to} title={`→ ${STATUS_LABEL[to]}`} variant={to === "closed" ? "success" : "primary"} large onPress={() => move(to)} />
      ))}
      {f.status === "to_review" && !transitions.includes("closed") ? <Body muted>Lo cierra el residente, el director o el administrador.</Body> : null}
    </Screen>
  );
}
