import { addDays } from "@avanceobra/engine";
import { computeFormulas, FormDefinition, pruneHidden, validateAnswers, type Answers } from "@avanceobra/forms";
import type { LossCause, Weather } from "@avanceobra/shared";
import { lossesFromLegacy, summarizeLosses, type LossDraftLine } from "../../../core/losses";
import { useQuery } from "@powersync/react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform } from "react-native";
import { draftAgeHours, draftTimeLabel, DRAFT_STALE_HOURS } from "../../../core/captureDraft";
import { quantityFromArea } from "../../../core/drawing";
import { cumulativePct, suggestValues, type RecentEntry } from "../../../core/recent";
import { reconcile, saveWarnings } from "../../../core/reconcile";
import { saveEntry } from "../../../services/entries";
import { todayLocal } from "../../../services/ids";
import { getFix, type Fix } from "../../../services/location";
import { saveSignature } from "../../../services/photos";
import { loadDraft, useAutosaveDraft } from "../../../state/captureDrafts";
import { planSelection, usePlanSelection } from "../../../state/draft";
import { useSession } from "../../../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Row, Screen, Title } from "../../../ui/components";
import { DynamicForm } from "../../../ui/DynamicForm";
import { PhotoStrip } from "../../../ui/PhotoStrip";
import { SignaturePad } from "../../../ui/SignaturePad";
import { useTheme } from "../../../ui/theme";
import { usePhotoCapture } from "../../../ui/usePhotoCapture";

const WEATHER: { value: Weather; label: string }[] = [
  { value: "sunny", label: "☀ Soleado" },
  { value: "cloudy", label: "☁ Nublado" },
  { value: "light_rain", label: "🌦 Llovizna" },
  { value: "heavy_rain", label: "🌧 Lluvia" },
  { value: "storm", label: "⛈ Tormenta" },
];

const CAUSES: { value: LossCause; label: string }[] = [
  { value: "none", label: "Ninguna" },
  { value: "weather", label: "Clima" },
  { value: "material", label: "Material" },
  { value: "equipment", label: "Equipo" },
  { value: "permits", label: "Permisos" },
  { value: "labor", label: "Personal" },
  { value: "design_client", label: "Diseño/Cliente" },
  { value: "other", label: "Otra" },
];

const num = (s: string) => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : NaN;
};
const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/**
 * Toque 3 de 3: cantidad + foto + Guardar. Lo demás (horas, clima, causa, personal,
 * plano, firma) está prellenado con los valores recientes y se abre solo si hace falta.
 * Todo se guarda como borrador mientras se escribe: salir de la pantalla no pierde nada.
 */
export default function Capture() {
  // cantidad y nota llegan del parte dictado (Muse Spark)
  const { frontId, activityId, cantidad, nota } = useLocalSearchParams<{ frontId: string; activityId: string; cantidad?: string; nota?: string }>();
  const { projectId, userId, userName } = useSession();
  const t = useTheme();
  const today = todayLocal();
  const selection = usePlanSelection();

  const [workDate, setWorkDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [more, setMore] = useState(false);
  const [hours, setHours] = useState<string | null>(null);
  // Pérdidas de tiempo: varias líneas (2 h Clima, 1 h Material…)
  const [losses, setLosses] = useState<LossDraftLine[]>([]);
  const setLoss = (i: number, patch: Partial<LossDraftLine>) => setLosses((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lossSummary = summarizeLosses(losses);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [crew, setCrew] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsState, setGpsState] = useState<"buscando" | "ok" | "sin GPS">("buscando");
  const [signing, setSigning] = useState(false);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [restoredLabel, setRestoredLabel] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Answers>({});
  const [showFormCheck, setShowFormCheck] = useState(false);

  const { data: rows } = useQuery<{ name: string; unit: string; contract_qty: number; front: string; project: string }>(
    `SELECT a.name, a.unit, a.contract_qty, f.name AS front, p.name AS project
     FROM activities a JOIN fronts f ON f.id = a.front_id JOIN projects p ON p.id = a.project_id WHERE a.id = ?`,
    [activityId],
  );
  const { data: recent } = useQuery<RecentEntry>(
    `SELECT activity_id, work_date, client_created_at, quantity, effective_hours, crew_size, weather
     FROM progress_entries WHERE activity_id = ? AND created_by = ? ORDER BY client_created_at DESC LIMIT 5`,
    [activityId, userId ?? ""],
  );
  const { data: progress } = useQuery<{ executed: number; on_date: number }>(
    `SELECT COALESCE(SUM(quantity), 0) AS executed,
            COALESCE(SUM(CASE WHEN work_date = ? THEN quantity END), 0) AS on_date
     FROM progress_entries WHERE activity_id = ? AND status IN ('submitted','approved')`,
    [workDate, activityId],
  );
  const { data: selectedElements } = useQuery<{ n: number; qty: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS qty FROM elements WHERE id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(selection.elementIds)],
  );
  const { data: templateRows } = useQuery<{ version_id: string; version: number; schema: string; name: string }>(
    `SELECT v.id AS version_id, v.version, v.schema, t.name
     FROM activities a JOIN form_templates t ON t.id = a.template_id
     JOIN form_template_versions v ON v.template_id = t.id AND v.version = t.current_version
     WHERE a.id = ?`,
    [activityId],
  );
  const activity = rows[0];
  /** Formato de la actividad (última versión publicada); si el JSON no es válido se ignora. */
  const form = useMemo(() => {
    const r = templateRows[0];
    if (!r) return null;
    try {
      const parsed = FormDefinition.safeParse(JSON.parse(r.schema));
      return parsed.success ? { definition: parsed.data, versionId: r.version_id, version: r.version, name: r.name } : null;
    } catch {
      return null;
    }
  }, [templateRows]);
  const formCheck = useMemo(() => (form ? validateAnswers(form.definition, formValues) : null), [form, formValues]);
  const suggestion = useMemo(() => suggestValues(activityId, recent), [activityId, recent]);

  const cam = usePhotoCapture(() => ({
    lat: fix?.lat ?? null,
    lon: fix?.lon ?? null,
    accuracyM: fix?.accuracy,
    project: activity?.project,
    front: activity?.front,
    activity: activity?.name,
    user: userName,
  }));

  // Recupera el borrador (si lo hay) antes de empezar a guardar cambios.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    planSelection.start(activityId);
    loadDraft(userId, activityId)
      .then((d) => {
        if (!alive || !d) return;
        setWorkDate(d.workDate || today);
        setQuantity(d.quantity);
        setHours(d.hours);
        setLosses(d.losses ?? lossesFromLegacy(d.lostHours, d.cause));
        setWeather(d.weather as Weather | null);
        setCrew(d.crew);
        setNotes(d.notes);
        setSignatureUri(d.signatureUri);
        setFormValues(d.values ?? {});
        cam.restore(d.photos);
        // Si se llegó escaneando un QR, se suma ese elemento a lo que ya traía el borrador.
        const current = planSelection.get();
        planSelection.restore(activityId, [...new Set([...d.elementIds, ...current.elementIds])], d.area ?? current.area);
        if ((d.losses ?? lossesFromLegacy(d.lostHours, d.cause)).length || d.notes || d.signatureUri) setMore(true);
        const old = draftAgeHours(d) > DRAFT_STALE_HOURS;
        setRestoredLabel(`${old ? "⚠ Borrador antiguo" : "Borrador recuperado"} (${draftTimeLabel(d)})`);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        if (cantidad) setQuantity(cantidad);
        if (nota) {
          setNotes(nota);
          setMore(true);
        }
        setDraftLoaded(true);
      });
    getFix()
      .then((f) => {
        setFix(f);
        setGpsState(f ? "ok" : "sin GPS");
      })
      .catch(() => setGpsState("sin GPS"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, userId]);

  useEffect(() => {
    if (activity?.unit) planSelection.start(activityId, activity.unit);
  }, [activity?.unit, activityId]);

  const q = num(quantity);
  useEffect(() => {
    planSelection.setReported(Number.isFinite(q) ? q : null);
  }, [q]);

  const autosave = useAutosaveDraft(
    userId,
    {
      activityId,
      frontId,
      workDate,
      quantity,
      hours,
      lostHours: String(lossSummary.total),
      cause: lossSummary.main,
      losses,
      weather,
      crew,
      notes,
      photos: cam.photos,
      signatureUri,
      elementIds: selection.elementIds,
      area: selection.area,
      values: formValues,
    },
    draftLoaded,
  );

  const elementQty = selectedElements[0]?.qty ?? 0;
  const areaQty = selection.area && activity ? quantityFromArea(activity.unit, selection.area.areaM2) : null;
  const check = activity ? reconcile(Number.isFinite(q) ? q : null, elementQty, activity.unit) : null;
  const executed = progress[0]?.executed ?? 0;
  const onDate = progress[0]?.on_date ?? 0;

  const effectiveHours = hours ?? String(suggestion.effectiveHours);
  const crewSize = crew ?? String(suggestion.crewSize);

  function resetForm() {
    setWorkDate(today);
    setQuantity("");
    setHours(null);
    setLosses([]);
    setWeather(null);
    setCrew(null);
    setNotes("");
    setSignatureUri(null);
    setFormValues({});
    setShowFormCheck(false);
    cam.reset();
    planSelection.setElements([]);
    planSelection.setArea(null);
    setRestoredLabel(null);
  }

  async function discardDraft() {
    Alert.alert("Descartar borrador", "Se borrará lo que tenías escrito para esta actividad.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Descartar",
        style: "destructive",
        onPress: async () => {
          await autosave.finish();
          resetForm();
          autosave.resume();
        },
      },
    ]);
  }

  async function doSave(qty: number, h: number, lh: number) {
    if (!projectId || !userId || !activity) return;
    setSaving(true);
    try {
      await saveEntry({
        projectId,
        frontId,
        activityId,
        activityName: activity.name,
        unit: activity.unit,
        workDate,
        quantity: qty,
        effectiveHours: h,
        lostHours: lh,
        lossCause: lossSummary.main as LossCause,
        losses: lossSummary.lines,
        weather: weather ?? (suggestion.weather as Weather | null),
        crewSize: Math.max(0, Math.round(num(crewSize) || 0)),
        notes,
        fix,
        photos: cam.photos,
        elementIds: selection.elementIds,
        area: selection.area,
        signatureUri,
        userId,
        ...(form
          ? {
              values: pruneHidden(form.definition, computeFormulas(form.definition, formValues)),
              templateVersionId: form.versionId,
              formFiles: form.definition.fields
                .filter((f) => f.type === "signature" && typeof formValues[f.id] === "string")
                .map((f) => ({ fieldId: f.id, uri: formValues[f.id] as string })),
            }
          : {}),
      });
      await autosave.finish();
      planSelection.clear();
      Alert.alert("✓ Guardado", "Se sincronizará automáticamente cuando haya señal.");
      router.dismissTo("/");
    } catch (e) {
      Alert.alert("No se pudo guardar", String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!activity) return;
    if (!(q >= 0)) return Alert.alert("Cantidad inválida", "Escribe la cantidad ejecutada.");
    const h = num(effectiveHours);
    if (lossSummary.error) return Alert.alert("Revisa las pérdidas de tiempo", lossSummary.error);
    const lh = lossSummary.total;
    if (!(h >= 0 && h <= 24)) return Alert.alert("Horas inválidas", "Deben estar entre 0 y 24.");

    if (form && formCheck && !formCheck.ok) {
      setShowFormCheck(true);
      const n = Object.keys(formCheck.errors).length;
      return Alert.alert("Revisa el formato", `Hay ${n} campo(s) del formato «${form.name}» por completar o corregir (marcados en rojo).`);
    }
    const now = Date.now();
    const warnings = saveWarnings({
      quantity: q,
      unit: activity.unit,
      contractQty: activity.contract_qty,
      executedBefore: executed,
      marked: elementQty,
      recentSame: recent
        .filter((r) => r.work_date === workDate)
        .map((r) => ({ quantity: r.quantity, minutesAgo: (now - Date.parse(r.client_created_at)) / 60_000 })),
    });
    if (form && formCheck) {
      const labels = new Map(form.definition.fields.map((f) => [f.id, f.label]));
      for (const [k, w] of Object.entries(formCheck.warnings)) warnings.push(`${labels.get(k.split("[")[0]!) ?? k}: ${w}`);
    }
    if (warnings.length === 0) return void doSave(q, h, lh);
    Alert.alert("Revisa antes de guardar", warnings.map((w) => `• ${w}`).join("\n\n"), [
      { text: "Revisar", style: "cancel" },
      { text: "Guardar igual", onPress: () => void doSave(q, h, lh) },
    ]);
  }

  if (!activity) return <Screen><Body muted>Cargando…</Body></Screen>;

  const dateOptions = [
    { value: today, label: "Hoy" },
    { value: addDays(today, -1), label: "Ayer" },
    { value: addDays(today, -2), label: "Antier" },
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: activity.name }} />
      <Screen>
        {restoredLabel ? (
          <Card accent={t.primary}>
            <Body>{`✎ ${restoredLabel}`}</Body>
            <BigButton title="Descartar y empezar de nuevo" onPress={discardDraft} />
          </Card>
        ) : null}
        <Label>{`${activity.front} · GPS: ${gpsState}${fix?.accuracy ? ` ±${Math.round(fix.accuracy)} m` : ""}`}</Label>
        <Body muted>
          {`Acumulado ${fmt(executed)} de ${fmt(activity.contract_qty)} ${activity.unit} (${cumulativePct(executed, activity.contract_qty)} %)` +
            (onDate > 0 ? ` · ya reportado ${workDate === today ? "hoy" : "ese día"}: ${fmt(onDate)}` : "")}
        </Body>
        <Chips options={dateOptions} value={workDate} onChange={setWorkDate} />
        <Title>{`Cantidad ${workDate === today ? "de hoy" : `del ${workDate}`} (${activity.unit})`}</Title>
        <Input
          big
          autoFocus={!restoredLabel}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          placeholder={suggestion.quantity !== null ? String(suggestion.quantity) : "0"}
          accessibilityLabel={`Cantidad en ${activity.unit}`}
        />
        <Row style={{ flexWrap: "wrap" }}>
          {suggestion.quantity !== null ? (
            <BigButton title={`Igual que la última: ${suggestion.quantity}`} onPress={() => setQuantity(String(suggestion.quantity))} />
          ) : null}
          {selection.elementIds.length > 0 && elementQty > 0 && check?.state !== "match" ? (
            <BigButton title={`Usar lo marcado: ${fmt(elementQty)}`} onPress={() => setQuantity(String(elementQty))} />
          ) : null}
          {areaQty !== null ? <BigButton title={`Usar área: ${areaQty} ${activity.unit}`} onPress={() => setQuantity(String(areaQty))} /> : null}
        </Row>

        {check && check.state !== "nothing_marked" ? (
          <Card accent={check.state === "match" ? t.success : check.state === "no_quantity" ? t.primary : t.warning}>
            <Body>{check.message}</Body>
            {check.state === "missing" || check.state === "extra" ? (
              <BigButton title="▦ Ajustar en el plano" onPress={() => router.push({ pathname: "/marcar", params: { activityId } })} />
            ) : null}
          </Card>
        ) : null}

        <BigButton
          title={selection.elementIds.length ? `▦ Plano: ${fmt(elementQty)} marcados` : "▦ Marcar en el plano"}
          onPress={() => router.push({ pathname: "/marcar", params: { activityId } })}
        />
        <BigButton title={`📷 Foto (${cam.photos.filter((p) => !p.annotation).length}/5)`} loading={cam.busy} onPress={() => void cam.capture()} />
        <PhotoStrip photos={cam.photos.filter((p) => !p.annotation)} onRemove={cam.remove} />

        {form ? (
          <Card accent={showFormCheck && formCheck && !formCheck.ok ? t.danger : t.primary}>
            <Label>{`Formato: ${form.name} · v${form.version}`}</Label>
            <DynamicForm
              definition={form.definition}
              values={formValues}
              onChange={setFormValues}
              check={showFormCheck ? formCheck : null}
              photos={cam.photos}
              onCapturePhoto={(fieldId) => cam.capture(fieldId)}
              onRemovePhoto={cam.remove}
              draftKey={`${activityId}-${Date.now().toString(36)}`}
            />
          </Card>
        ) : null}

        <BigButton title="Guardar" variant="primary" large loading={saving} disabled={quantity.trim() === ""} onPress={save} />

        <BigButton title={more ? "▲ Menos datos" : "▼ Más datos (horas, clima, causa, firma)"} onPress={() => setMore(!more)} />
        {more ? (
          <>
            {selection.area ? <Body muted>{`Área trabajada ≈ ${Math.round(selection.area.areaM2).toLocaleString("es-CO")} m²`}</Body> : null}
            <Label>Horas efectivas</Label>
            <Input value={effectiveHours} onChangeText={setHours} keyboardType="decimal-pad" />
            <Label>Personal (número de personas)</Label>
            <Input value={crewSize} onChangeText={setCrew} keyboardType="number-pad" />
            <Label>Clima</Label>
            <Chips options={WEATHER} value={weather ?? (suggestion.weather as Weather | null)} onChange={setWeather} />
            <Label>{`Pérdidas de tiempo${lossSummary.total > 0 ? ` · ${lossSummary.total.toLocaleString("es-CO")} h` : ""}`}</Label>
            {losses.map((l, i) => (
              <Card key={i} accent={l.cause === "none" && l.hours.trim() !== "" && l.hours !== "0" ? t.danger : undefined}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Input
                    value={l.hours}
                    onChangeText={(s) => setLoss(i, { hours: s })}
                    keyboardType="decimal-pad"
                    placeholder="Horas"
                    accessibilityLabel={`Horas perdidas ${i + 1}`}
                    style={{ width: 110 }}
                  />
                  <BigButton title="Quitar" onPress={() => setLosses((ls) => ls.filter((_, j) => j !== i))} />
                </Row>
                <Chips options={CAUSES.filter((c) => c.value !== "none")} value={l.cause === "none" ? null : (l.cause as LossCause)} onChange={(c) => setLoss(i, { cause: c })} />
              </Card>
            ))}
            <BigButton title="+ Agregar pérdida" onPress={() => setLosses((ls) => [...ls, { hours: "", cause: "none" }])} />
            <Label>Observaciones</Label>
            <Input value={notes} onChangeText={setNotes} multiline style={{ minHeight: 100, textAlignVertical: "top" }} />
            <BigButton title={signatureUri ? "✓ Firmado (tocar para repetir)" : "✍ Firmar"} onPress={() => setSigning(true)} />
          </>
        ) : null}
        <Body muted>Se guarda como borrador mientras escribes: puedes salir y volver sin perder nada.</Body>
      </Screen>
      <SignaturePad
        visible={signing}
        onCancel={() => setSigning(false)}
        onSave={(b64) => {
          // La firma se asocia al registro al guardar; se guarda con un id temporal.
          const f = saveSignature(`${activityId}-${Date.now()}`, b64);
          setSignatureUri(f.uri);
          setSigning(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}
