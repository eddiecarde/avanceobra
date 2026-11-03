import { useQuery } from "@powersync/react";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { DEFAULT_EQUIPMENT, DEFAULT_ROLES, emptyDraft, normalizeTime, nowColombia, rainMinutes, toDailyLogRow, validateDraft, type DailyLogDraft } from "../core/dailyLog";
import { applyReport, dictatedProgress, type ParsedReport } from "../core/dictation";
import { db } from "../db/database";
import { callAi } from "../services/ai";
import { newId, nowIso, todayLocal } from "../services/ids";
import { supabase } from "../services/supabase";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Row, Screen, Title } from "../ui/components";
import { useTheme } from "../ui/theme";
import { VoiceDictation } from "../ui/VoiceDictation";
import { useAiAccess } from "../state/useAiAccess";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ALL = "__todo__";
const NONE = "__ninguna__";

/** Fila con − cantidad + grandes, para contar personal o equipos con guantes. */
function Counter({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const t = useTheme();
  const btn = (txt: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? "Sumar" : "Restar"} ${label}`}
      onPress={() => onChange(Math.max(0, value + delta))}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 2,
        borderColor: t.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.surface : t.bg,
      })}
    >
      <Text style={{ color: t.text, fontSize: 28, fontWeight: "800" }}>{txt}</Text>
    </Pressable>
  );
  return (
    <Row style={{ justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: t.text, fontSize: 18, flex: 1, fontWeight: value > 0 ? "800" : "500" }}>{label}</Text>
      {btn("−", -1)}
      <Input
        value={String(value)}
        keyboardType="number-pad"
        onChangeText={(s) => onChange(Math.max(0, Math.min(9999, Number(s.replace(/\D/g, "")) || 0)))}
        style={{ width: 72, textAlign: "center", fontSize: 22, fontWeight: "800" }}
        accessibilityLabel={`Cantidad de ${label}`}
      />
      {btn("+", 1)}
    </Row>
  );
}

/**
 * Parte diario del supervisor: personal por cargo, equipos y lluvia (inicio–fin). Funciona sin
 * señal: se guarda como borrador mientras se escribe y al enviar queda en la cola de subida.
 * Se puede corregir y volver a enviar; para el informe vale el último envío.
 */
export default function Parte() {
  const t = useTheme();
  const { projectId, userId } = useSession();
  const today = todayLocal();
  const [date, setDate] = useState(today);
  const [front, setFront] = useState<string>(ALL);
  const [draft, setDraft] = useState<DailyLogDraft>(emptyDraft());
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [newEquipment, setNewEquipment] = useState("");
  const [rainStart, setRainStart] = useState("");
  const [rainEnd, setRainEnd] = useState("");
  const loadedKey = useRef<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiAllowed = useAiAccess();

  const { data: fronts } = useQuery<{ id: string; code: string; name: string }>("SELECT id, code, name FROM fronts WHERE project_id = ? ORDER BY code", [projectId ?? ""]);
  const { data: activities } = useQuery<{ id: string; code: string; name: string; unit: string; front_id: string }>(
    "SELECT id, code, name, unit, front_id FROM activities WHERE project_id = ? ORDER BY code",
    [projectId ?? ""],
  );
  const { data: catalogs } = useQuery<{ personnel_roles: string; equipment_types: string }>("SELECT personnel_roles, equipment_types FROM project_catalogs WHERE id = ?", [projectId ?? ""]);

  // Catálogos del proyecto: se actualizan si hay señal; si no, se usan los guardados o los de fábrica
  useEffect(() => {
    if (!projectId) return;
    void supabase
      .from("projects")
      .select("personnel_roles, equipment_types")
      .eq("id", projectId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) return;
        await db.execute("DELETE FROM project_catalogs WHERE id = ?", [projectId]);
        await db.execute("INSERT INTO project_catalogs (id, personnel_roles, equipment_types, updated_at) VALUES (?, ?, ?, ?)", [
          projectId,
          JSON.stringify(data.personnel_roles ?? []),
          JSON.stringify(data.equipment_types ?? []),
          nowIso(),
        ]);
      });
  }, [projectId]);

  const roles = useMemo(() => {
    const base: string[] = catalogs[0] ? JSON.parse(catalogs[0].personnel_roles) : DEFAULT_ROLES;
    return [...new Set([...(base.length ? base : DEFAULT_ROLES), ...Object.keys(draft.personnel)])];
  }, [catalogs, draft.personnel]);
  const equipment = useMemo(() => {
    const base: string[] = catalogs[0] ? JSON.parse(catalogs[0].equipment_types) : DEFAULT_EQUIPMENT;
    return [...new Set([...(base.length ? base : DEFAULT_EQUIPMENT), ...Object.keys(draft.equipment)])];
  }, [catalogs, draft.equipment]);

  // Cargar el borrador de este día y frente
  const key = `${userId}|${projectId}|${date}|${front}`;
  useEffect(() => {
    if (!userId || !projectId) return;
    let off = false;
    void db
      .getOptional<{ data: string; submitted_at: string | null }>(
        "SELECT data, submitted_at FROM daily_log_drafts WHERE user_id = ? AND project_id = ? AND log_date = ? AND front_id = ?",
        [userId, projectId, date, front],
      )
      .then((row) => {
        if (off) return;
        setDraft(row ? (JSON.parse(row.data) as DailyLogDraft) : emptyDraft());
        setSubmittedAt(row?.submitted_at ?? null);
        loadedKey.current = key;
      });
    return () => {
      off = true;
    };
  }, [userId, projectId, date, front, key]);

  // Guardar el borrador 0,5 s después de cada cambio
  useEffect(() => {
    if (loadedKey.current !== key || !userId || !projectId) return;
    const h = setTimeout(() => {
      void db.writeTransaction(async (tx) => {
        await tx.execute("DELETE FROM daily_log_drafts WHERE user_id = ? AND project_id = ? AND log_date = ? AND front_id = ?", [userId, projectId, date, front]);
        await tx.execute(
          "INSERT INTO daily_log_drafts (id, user_id, project_id, front_id, log_date, data, updated_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [newId(), userId, projectId, front, date, JSON.stringify(draft), nowIso(), submittedAt],
        );
      });
    }, 500);
    return () => clearTimeout(h);
  }, [draft, key, userId, projectId, date, front, submittedAt]);

  const setQty = (kind: "personnel" | "equipment", name: string, n: number) => setDraft((d) => ({ ...d, [kind]: { ...d[kind], [name]: n } }));
  const setEquipmentActivity = (name: string, activityId: string) =>
    setDraft((d) => {
      const next = { ...(d.equipmentActivity ?? {}) };
      if (activityId === NONE) delete next[name];
      else next[name] = activityId;
      return { ...d, equipmentActivity: next };
    });
  // Actividades para asignar equipos: las del frente elegido, o las que tuvieron avance en las últimas 2 semanas
  const { data: recent } = useQuery<{ activity_id: string }>("SELECT DISTINCT activity_id FROM progress_entries WHERE project_id = ? AND work_date >= ?", [
    projectId ?? "",
    addDays(today, -14),
  ]);
  const equipmentActivities = useMemo(() => {
    const recentIds = new Set(recent.map((r) => r.activity_id));
    const list = front === ALL ? activities.filter((a) => recentIds.has(a.id)) : activities.filter((a) => a.front_id === front);
    const chosen = new Set(Object.values(draft.equipmentActivity ?? {}));
    return [...list.slice(0, 12), ...activities.filter((a) => chosen.has(a.id) && !list.slice(0, 12).includes(a))];
  }, [activities, recent, front, draft.equipmentActivity]);
  const totalPeople = Object.values(draft.personnel).reduce((s, n) => s + n, 0);
  const totalEquip = Object.values(draft.equipment).reduce((s, n) => s + n, 0);

  function addRain() {
    const a = normalizeTime(rainStart);
    const b = normalizeTime(rainEnd);
    if (!a || !b) return Alert.alert("Hora no válida", "Escribe la hora de inicio y de fin, por ejemplo 10:15 y 11:40.");
    if (a >= b) return Alert.alert("Revisa las horas", "La hora de fin debe ser después de la de inicio.");
    setDraft((d) => ({ ...d, rain: [...d.rain, { start: a, end: b }].sort((x, y) => x.start.localeCompare(y.start)) }));
    setRainStart("");
    setRainEnd("");
  }

  /** Muse Spark (Meta) convierte lo dictado en el parte; el supervisor revisa antes de enviar. */
  async function fillWithAi() {
    if (!projectId) return;
    setAiBusy(true);
    const r = await callAi<{ report: ParsedReport }>("parse_report", {
      project_id: projectId,
      text: draft.dictation ?? "",
      front_id: front === ALL ? null : front,
    });
    setAiBusy(false);
    if (r.data === null) return Alert.alert("No se pudo llenar con IA", r.error);
    const report = r.data.report;
    setDraft((d) => ({ ...applyReport(d, report, { roles, equipment }), dictation: d.dictation, ai: report }));
    const n = report.personnel.length + report.equipment.length + report.rain.length;
    Alert.alert(
      "Parte llenado con IA",
      `${n} dato(s) de personal, equipos y lluvia quedaron en el parte. Revísalos antes de enviar.` +
        (report.progress.length || report.findings.length ? " Abajo de lo dictado están los avances y hallazgos para registrar." : ""),
    );
  }
  const dictated = draft.ai ? dictatedProgress(draft.ai, activities) : [];

  async function send() {
    if (!projectId || !userId) return;
    const errors = validateDraft(draft);
    if (errors.length) return Alert.alert("Revisa el parte", errors.join("\n"));
    const row = toDailyLogRow(draft, { id: newId(), projectId, frontId: front === ALL ? null : front, date, now: nowIso() });
    const sentAt = nowIso();
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        "INSERT INTO daily_logs (id, project_id, front_id, log_date, personnel, equipment, rain, observations, client_created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [row.id, row.project_id, row.front_id, row.log_date, row.personnel, row.equipment, row.rain, row.observations, row.client_created_at],
      );
      await tx.execute("UPDATE daily_log_drafts SET submitted_at = ? WHERE user_id = ? AND project_id = ? AND log_date = ? AND front_id = ?", [
        sentAt,
        userId,
        projectId,
        date,
        front,
      ]);
    });
    setSubmittedAt(sentAt);
    Alert.alert("Parte enviado", "Se sube en cuanto haya señal. Si corriges algo, vuelve a enviarlo: vale el último.");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Parte diario" }} />
      <Screen>
        <Label>Fecha</Label>
        <Chips
          options={[
            { value: today, label: "Hoy" },
            { value: addDays(today, -1), label: "Ayer" },
            { value: addDays(today, -2), label: "Antier" },
          ]}
          value={date}
          onChange={setDate}
        />
        <Label>¿De qué frente es este parte?</Label>
        <Chips options={[{ value: ALL, label: "Toda la obra" }, ...fronts.map((f) => ({ value: f.id, label: f.code }))]} value={front} onChange={setFront} />
        {submittedAt ? (
          <Card accent={t.success}>
            <Body>{`✓ Enviado a las ${nowColombia(new Date(submittedAt))}. Puedes corregir y volver a enviar.`}</Body>
          </Card>
        ) : null}

        {aiAllowed ? (
          <>
        <Title>🎙 Dictar el parte</Title>
        <Body muted>
          Toca «Hablar» y cuenta el día: qué hicieron y cuánto, cuánta gente y qué equipos, si llovió (de qué hora a qué hora) y los problemas.
          Luego toca «Llenar el parte con IA» y revisa antes de enviar.
        </Body>
        <VoiceDictation onText={(s) => setDraft((d) => ({ ...d, dictation: `${(d.dictation ?? "").trim()} ${s}`.trim() }))} />
        <Input
          value={draft.dictation ?? ""}
          onChangeText={(s) => setDraft((d) => ({ ...d, dictation: s }))}
          placeholder="Ej.: hoy hincamos 120 pilotes en el subcampo 3 con 2 hincadoras, 4 oficiales y 6 ayudantes; llovió de 10 a 11; hay un pilote torcido en la fila 4"
          multiline
          accessibilityLabel="Texto dictado del parte"
          style={{ minHeight: 110, textAlignVertical: "top", paddingTop: 12 }}
        />
        <BigButton title="✨ Llenar el parte con IA" loading={aiBusy} disabled={(draft.dictation ?? "").trim().length < 8} onPress={() => void fillWithAi()} />
        {(draft.dictation ?? "").trim().length < 8 ? <Body muted>Dicta o escribe el parte para poder llenarlo con IA.</Body> : null}
          </>
        ) : null}
        {draft.ai && (dictated.length || draft.ai.findings.length || draft.ai.unmatched.length) ? (
          <Card accent={t.primary}>
            {dictated.length ? <Label>Avance dictado: tócalo para registrarlo con su foto</Label> : null}
            {dictated.map((p) => (
              <BigButton
                key={p.activityId}
                title={`${p.code} · ${p.name}: ${p.quantity} ${p.unit}`}
                onPress={() =>
                  router.push({ pathname: "/registro/[frontId]/[activityId]", params: { frontId: p.frontId, activityId: p.activityId, cantidad: String(p.quantity), nota: p.note } })
                }
              />
            ))}
            {draft.ai.findings.length ? <Label>Problemas dictados: tócalos para crear el hallazgo</Label> : null}
            {draft.ai.findings.map((f, i) => (
              <BigButton
                key={`${i}-${f.description}`}
                title={`⚠ ${f.description}`}
                onPress={() => router.push({ pathname: "/hallazgo/nuevo", params: { descripcion: f.description, tipo: f.type, severidad: f.severity } })}
              />
            ))}
            {draft.ai.unmatched.length ? <Body muted>{`No se pudo ubicar: ${draft.ai.unmatched.join("; ")}. Regístralo a mano.`}</Body> : null}
          </Card>
        ) : null}

        <Title>{`Personal · ${totalPeople}`}</Title>
        {roles.map((r) => (
          <Counter key={r} label={r} value={draft.personnel[r] ?? 0} onChange={(n) => setQty("personnel", r, n)} />
        ))}
        <Row>
          <Input value={newRole} onChangeText={setNewRole} placeholder="Otro cargo" style={{ flex: 1 }} />
          <BigButton
            title="Agregar"
            disabled={!newRole.trim()}
            onPress={() => {
              setQty("personnel", newRole.trim(), 1);
              setNewRole("");
            }}
          />
        </Row>

        <Title>{`Equipos · ${totalEquip}`}</Title>
        {equipment.map((e) => (
          <View key={e}>
            <Counter label={e} value={draft.equipment[e] ?? 0} onChange={(n) => setQty("equipment", e, n)} />
            {(draft.equipment[e] ?? 0) > 0 && equipmentActivities.length ? (
              <View style={{ gap: 6, paddingBottom: 8 }}>
                <Label>{`¿En qué actividad trabajó ${e}?`}</Label>
                <Chips
                  options={[{ value: NONE, label: "Sin indicar" }, ...equipmentActivities.map((a) => ({ value: a.id, label: a.code }))]}
                  value={draft.equipmentActivity?.[e] ?? NONE}
                  onChange={(v) => setEquipmentActivity(e, v)}
                />
              </View>
            ) : null}
          </View>
        ))}
        <Row>
          <Input value={newEquipment} onChangeText={setNewEquipment} placeholder="Otro equipo" style={{ flex: 1 }} />
          <BigButton
            title="Agregar"
            disabled={!newEquipment.trim()}
            onPress={() => {
              setQty("equipment", newEquipment.trim(), 1);
              setNewEquipment("");
            }}
          />
        </Row>

        <Title>{`Lluvia · ${draft.rain.reduce((s, r) => s + rainMinutes(r), 0)} min`}</Title>
        {draft.rain.map((r, i) => (
          <Row key={`${r.start}-${i}`} style={{ justifyContent: "space-between" }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{`🌧 ${r.start} – ${r.end} (${rainMinutes(r)} min)`}</Text>
            <BigButton title="Quitar" onPress={() => setDraft((d) => ({ ...d, rain: d.rain.filter((_, j) => j !== i) }))} />
          </Row>
        ))}
        <Row>
          <View style={{ flex: 1, gap: 6 }}>
            <Input value={rainStart} onChangeText={setRainStart} placeholder="Inicio 10:15" keyboardType="numbers-and-punctuation" />
            <BigButton title="Empezó ahora" onPress={() => setRainStart(nowColombia())} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Input value={rainEnd} onChangeText={setRainEnd} placeholder="Fin 11:40" keyboardType="numbers-and-punctuation" />
            <BigButton title="Paró ahora" onPress={() => setRainEnd(nowColombia())} />
          </View>
        </Row>
        <BigButton title="＋ Agregar lluvia" disabled={!rainStart || !rainEnd} onPress={addRain} />

        <Title>Observaciones</Title>
        <Input
          value={draft.observations}
          onChangeText={(s) => setDraft((d) => ({ ...d, observations: s }))}
          placeholder="Novedades del día (opcional)"
          multiline
          style={{ minHeight: 96, textAlignVertical: "top", paddingTop: 12 }}
        />

        <BigButton title={submittedAt ? "Enviar corrección" : "Enviar parte"} variant="primary" large onPress={() => void send()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
