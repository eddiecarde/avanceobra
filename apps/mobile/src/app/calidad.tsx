import { useQuery } from "@powersync/react";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { closeNoteError } from "../core/findings";
import { changeFindingStatus, closeFinding, startCorrection } from "../services/findings";
import { todayLocal } from "../services/ids";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Screen, Title } from "../ui/components";
import { PhotoStrip } from "../ui/PhotoStrip";
import { useTheme } from "../ui/theme";
import { usePhotoCapture } from "../ui/usePhotoCapture";

type Status = "open" | "in_correction" | "to_review" | "closed";
interface Item {
  id: string;
  category: "no_conformidad" | "punch";
  status: Status;
  description: string;
  impeditive: number | null;
  due_date: string | null;
  corrective_action: string | null;
  act_code: string | null;
  act_name: string | null;
  company: string | null;
}

const CATEGORY: Record<Item["category"], string> = { no_conformidad: "No conformidad", punch: "Punch" };
const STATUS: Record<Status, string> = { open: "Abierto", in_correction: "En corrección", to_review: "Por verificar", closed: "Cerrado" };

/**
 * No conformidades y punch list en el teléfono, sin señal: se leen y se avanzan en la base local y se
 * suben al sincronizar. Cerrar exige la nota de verificación y la foto de cómo quedó.
 */
export default function Calidad() {
  const { projectId, role } = useSession();
  const canClose = role === "resident" || role === "director" || role === "admin";
  const [filter, setFilter] = useState<"all" | "impeditive" | Item["category"]>("all");
  const { data: items } = useQuery<Item>(
    `SELECT f.id, f.category, f.status, f.description, f.impeditive, f.due_date, f.corrective_action,
            a.code AS act_code, a.name AS act_name, c.name AS company
     FROM findings f
     LEFT JOIN activities a ON a.id = f.activity_id
     LEFT JOIN project_companies c ON c.id = f.company_id
     WHERE f.project_id = ? AND f.category IN ('no_conformidad', 'punch') AND f.status != 'closed'
     ORDER BY COALESCE(f.due_date, '9999'), f.created_at`,
    [projectId ?? ""],
  );
  const shown = items.filter((i) => filter === "all" || (filter === "impeditive" ? !!i.impeditive : i.category === filter));

  return (
    <Screen>
      <Stack.Screen options={{ title: "Calidad" }} />
      <BigButton title="✅ Nueva inspección con lista de chequeo" variant="primary" onPress={() => router.push("/inspeccion")} />
      <BigButton title="⚑ Nueva no conformidad" onPress={() => router.push({ pathname: "/hallazgo/nuevo", params: { categoria: "no_conformidad" } })} />
      <BigButton title="⚑ Nuevo punch" onPress={() => router.push({ pathname: "/hallazgo/nuevo", params: { categoria: "punch" } })} />
      <Body muted>Funciona sin señal: los cambios se suben solos cuando el teléfono sincroniza.</Body>

      <Title>{`NC y punch abiertos (${items.length})`}</Title>
      <Chips
        options={[
          { value: "all", label: "Todos" },
          { value: "impeditive", label: "Impeditivos" },
          { value: "no_conformidad", label: "NC" },
          { value: "punch", label: "Punch" },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length === 0 ? <Body muted>Nada abierto con este filtro.</Body> : null}
      {shown.map((i) => (
        <QualityCard key={i.id} item={i} canClose={canClose} projectId={projectId ?? ""} />
      ))}
    </Screen>
  );
}

function QualityCard({ item: i, canClose, projectId }: { item: Item; canClose: boolean; projectId: string }) {
  const t = useTheme();
  const { userName } = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cam = usePhotoCapture(() => ({ lat: null, lon: null, user: userName }));
  const overdue = !!i.due_date && i.due_date < todayLocal();

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) Alert.alert("Listo", done);
    } catch (e) {
      Alert.alert("No se pudo guardar", String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    const error = closeNoteError(note);
    if (error) return Alert.alert("Falta la verificación", error);
    if (!cam.photos.length) return Alert.alert("Falta la foto de cierre", "Toma al menos una foto de cómo quedó: es la evidencia del cierre.");
    void run(() => closeFinding(i.id, projectId, note, cam.photos), "Cerrado con su verificación y foto; se sube al tener señal.");
  }

  return (
    <Card accent={i.impeditive || overdue ? t.danger : t.warning}>
      <Body>{`${CATEGORY[i.category]}${i.impeditive ? " · IMPEDITIVO" : ""} · ${STATUS[i.status]}`}</Body>
      <Body>{i.description}</Body>
      <Body muted>
        {[i.act_code ? `${i.act_code} · ${i.act_name}` : null, i.company ? `Responsable: ${i.company}` : null, i.due_date ? `Límite ${i.due_date}${overdue ? " (vencido)" : ""}` : null]
          .filter(Boolean)
          .join(" · ")}
      </Body>
      {i.corrective_action ? <Body muted>{`Acción: ${i.corrective_action}`}</Body> : null}

      {i.status === "open" ? (
        <>
          <Label>Acción correctiva</Label>
          <Input value={note} onChangeText={setNote} placeholder="Qué se va a hacer" />
          <BigButton title="Iniciar corrección" loading={busy} onPress={() => void run(() => startCorrection(i.id, note))} />
        </>
      ) : null}
      {i.status === "in_correction" ? (
        <BigButton title="Pedir verificación" loading={busy} onPress={() => void run(() => changeFindingStatus(i.id, "to_review"), "Quedó por verificar.")} />
      ) : null}
      {i.status === "to_review" && canClose ? (
        <>
          <Label>Verificación del cierre</Label>
          <Input value={note} onChangeText={setNote} placeholder="Qué se revisó y cómo quedó" multiline />
          <BigButton title={`📷 Foto de cierre (${cam.photos.length})`} loading={cam.busy} onPress={() => void cam.capture("Cierre")} />
          <PhotoStrip photos={cam.photos} onRemove={cam.remove} />
          <BigButton title="Verificar y cerrar" variant="success" loading={busy} onPress={close} />
          <BigButton title="Devolver a corrección" loading={busy} onPress={() => void run(() => changeFindingStatus(i.id, "in_correction"))} />
        </>
      ) : null}
      {i.status === "to_review" && !canClose ? <Body muted>Lo cierra el residente, el director o el administrador.</Body> : null}
    </Card>
  );
}
