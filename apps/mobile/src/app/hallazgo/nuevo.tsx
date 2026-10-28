import type { FindingType, Severity } from "@avanceobra/shared";
import { addDays } from "@avanceobra/engine";
import { File } from "expo-file-system";
import { useQuery } from "@powersync/react";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { CATEGORY_LABEL, SEVERITY_LABEL, TYPE_LABEL, type FindingCategory } from "../../core/findings";
import { callAi } from "../../services/ai";
import { createFinding } from "../../services/findings";
import { todayLocal } from "../../services/ids";
import { getFix, type Fix } from "../../services/location";
import { useSession } from "../../state/session";
import { AiMarks, type AiMarksData } from "../../ui/AiMarks";
import { BigButton, Body, Card, Chips, Input, Label, Screen } from "../../ui/components";
import { PhotoStrip } from "../../ui/PhotoStrip";
import { usePhotoCapture } from "../../ui/usePhotoCapture";

const TYPES = (Object.keys(TYPE_LABEL) as FindingType[]).map((v) => ({ value: v, label: TYPE_LABEL[v]! }));
const CATEGORIES = (Object.keys(CATEGORY_LABEL) as FindingCategory[]).map((v) => ({ value: v, label: CATEGORY_LABEL[v] }));
const SEVERITIES = (["low", "medium", "high", "critical"] as Severity[]).map((v) => ({ value: v, label: SEVERITY_LABEL[v] }));
/** Plazo sugerido de corrección según severidad. */
const DUE_DAYS: Record<Severity, number> = { critical: 1, high: 3, medium: 7, low: 15 };

export default function NuevoHallazgo() {
  const { projectId, userId, userName } = useSession();
  // Desde Calidad se abre con ?categoria=no_conformidad o punch; desde el parte dictado, con la descripción
  const params = useLocalSearchParams<{ categoria?: FindingCategory; descripcion?: string; tipo?: FindingType; severidad?: Severity }>();
  const [category, setCategory] = useState<FindingCategory>(params.categoria && params.categoria in CATEGORY_LABEL ? params.categoria : "observacion");
  const [impeditive, setImpeditive] = useState(false);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [type, setType] = useState<FindingType>(params.tipo && params.tipo in TYPE_LABEL ? params.tipo : "quality");
  const [severity, setSeverity] = useState<Severity>(params.severidad && params.severidad in SEVERITY_LABEL ? params.severidad : "medium");
  const [description, setDescription] = useState(params.descripcion ?? "");
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<{ title: string; is_defect: boolean; marks: AiMarksData; uri: string } | null>(null);
  const [frontId, setFrontId] = useState<string | null>(null);
  const [responsible, setResponsible] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: fronts } = useQuery<{ id: string; code: string }>("SELECT id, code FROM fronts WHERE project_id = ? ORDER BY code", [projectId ?? ""]);
  const { data: activities } = useQuery<{ id: string; code: string; front_id: string }>(
    "SELECT id, code, front_id FROM activities WHERE project_id = ? ORDER BY code",
    [projectId ?? ""],
  );
  const { data: members } = useQuery<{ user_id: string; member_name: string | null; role: string }>(
    "SELECT user_id, member_name, role FROM memberships WHERE project_id = ? ORDER BY member_name",
    [projectId ?? ""],
  );
  const cam = usePhotoCapture(() => ({ lat: fix?.lat ?? null, lon: fix?.lon ?? null, accuracyM: fix?.accuracy, user: userName }));

  useEffect(() => {
    getFix().then(setFix).catch(() => undefined);
  }, []);

  /** Muse Spark (Meta) lee la foto: tipo, severidad, descripción y acción correctiva; SAM 3.1 marca el defecto. */
  async function analyze() {
    const photo = cam.photos[0];
    if (!photo || !projectId) return;
    setAiBusy(true);
    try {
      const image = await new File(photo.uri).base64();
      const r = await callAi<{
        analysis: { is_defect: boolean; type: FindingType; severity: Severity; title: string; description: string; corrective_action: string };
        marks: AiMarksData;
      }>("defect", { project_id: projectId, image_base64: image, note: description });
      if (r.data === null) return Alert.alert("No se pudo analizar", r.error);
      const a = r.data.analysis;
      setAi({ title: a.title, is_defect: a.is_defect, marks: r.data.marks, uri: photo.uri });
      if (!a.is_defect) return Alert.alert("La IA no ve un defecto", "Revisa la foto o describe el hallazgo a mano.");
      setType(a.type);
      setSeverity(a.severity);
      const typed = description.trim();
      setDescription(
        [typed, `${a.title}. ${a.description}`, a.corrective_action ? `Acción correctiva sugerida (IA): ${a.corrective_action}` : ""].filter(Boolean).join("\n\n"),
      );
    } catch (e) {
      Alert.alert("No se pudo analizar", String((e as Error).message ?? e));
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    if (!projectId || !userId) return;
    if (description.trim().length < 3) return Alert.alert("Falta la descripción");
    if (category !== "observacion" && !activityId)
      return Alert.alert("Falta la actividad", "Una no conformidad o un punch se liga a su actividad: así queda la empresa responsable.");
    setSaving(true);
    try {
      await createFinding({
        projectId,
        frontId,
        type,
        severity,
        description,
        responsibleUserId: responsible,
        dueDate: addDays(todayLocal(), DUE_DAYS[severity]),
        fix,
        photos: cam.photos,
        userId,
        category,
        impeditive,
        activityId,
      });
      router.back();
    } catch (e) {
      Alert.alert("No se pudo guardar", String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Label>Clase</Label>
      <Chips options={CATEGORIES} value={category} onChange={setCategory} />
      <Label>Tipo</Label>
      <Chips options={TYPES} value={type} onChange={setType} />
      <Label>Severidad</Label>
      <Chips options={SEVERITIES} value={severity} onChange={setSeverity} />
      <Label>Descripción</Label>
      <Input value={description} onChangeText={setDescription} multiline style={{ minHeight: 110, textAlignVertical: "top" }} />
      <BigButton title={`📷 Foto (${cam.photos.length}/5)`} loading={cam.busy} onPress={() => void cam.capture()} />
      <PhotoStrip photos={cam.photos} onRemove={cam.remove} />
      {cam.photos.length ? <BigButton title="✨ Analizar la foto con IA" loading={aiBusy} onPress={() => void analyze()} /> : null}
      {ai ? (
        <Card>
          <Label>{ai.is_defect ? `IA: ${ai.title}` : "IA: no ve un defecto en la foto"}</Label>
          {ai.marks.boxes.length ? <AiMarks uri={ai.uri} marks={ai.marks} /> : null}
          <Body muted>Muse Spark y SAM 3.1 (Meta) sugieren tipo, severidad, descripción y acción correctiva. Revísalo antes de guardar.</Body>
        </Card>
      ) : null}
      <Label>Frente</Label>
      <Chips options={fronts.map((f) => ({ value: f.id, label: f.code }))} value={frontId} onChange={setFrontId} />
      <Label>{category === "observacion" ? "Actividad (opcional)" : "Actividad"}</Label>
      <Chips
        options={activities.filter((a) => !frontId || a.front_id === frontId).map((a) => ({ value: a.id, label: a.code }))}
        value={activityId}
        onChange={setActivityId}
      />
      {category !== "observacion" ? <Body muted>La empresa responsable será la de la actividad.</Body> : null}
      <Label>¿Detiene la obra?</Label>
      <Chips
        options={[
          { value: "no", label: "No" },
          { value: "si", label: "Sí, es impeditivo" },
        ]}
        value={impeditive ? "si" : "no"}
        onChange={(v) => setImpeditive(v === "si")}
      />
      <Label>Responsable</Label>
      <Chips
        options={members.map((m) => ({ value: m.user_id, label: m.member_name ?? m.role }))}
        value={responsible}
        onChange={setResponsible}
      />
      <Label>{`Fecha límite sugerida: ${addDays(todayLocal(), DUE_DAYS[severity])}`}</Label>
      <BigButton title="Guardar hallazgo" variant={severity === "critical" ? "danger" : "primary"} large loading={saving} onPress={save} />
    </Screen>
  );
}
