import { useQuery } from "@powersync/react";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { inspectionErrors, type ChecklistItem, type InspectionAnswer } from "../core/quality";
import { queueInspection } from "../services/findings";
import { todayLocal } from "../services/ids";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Screen, Title } from "../ui/components";
import { useTheme } from "../ui/theme";

interface Checklist {
  id: string;
  name: string;
  activity_id: string | null;
  items: ChecklistItem[];
}

const EMPTY: InspectionAnswer = { result: "", note: "", impeditive: false };

/**
 * Inspección con lista de chequeo, también sin señal: cada punto se marca Cumple / No cumple / No
 * aplica; al sincronizar, cada "no cumple" abre una no conformidad ligada a la actividad y al elemento.
 */
export default function Inspeccion() {
  const t = useTheme();
  const { projectId } = useSession();
  const { data: activities } = useQuery<{ id: string; code: string; name: string }>("SELECT id, code, name FROM activities WHERE project_id = ? ORDER BY code", [projectId ?? ""]);
  const { data: rawLists } = useQuery<{ id: string; name: string; activity_id: string | null; items: string }>(
    "SELECT id, name, activity_id, items FROM checklists WHERE project_id = ? AND active = 1 ORDER BY name",
    [projectId ?? ""],
  );
  const lists = useMemo<Checklist[]>(
    () =>
      rawLists.flatMap((l) => {
        try {
          return [{ ...l, items: JSON.parse(l.items) as ChecklistItem[] }];
        } catch {
          return [];
        }
      }),
    [rawLists],
  );
  const { data: elements } = useQuery<{ id: string; code: string }>("SELECT id, code FROM elements WHERE project_id = ?", [projectId ?? ""]);
  const [list, setList] = useState<Checklist | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [element, setElement] = useState("");
  const [location, setLocation] = useState("");
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [busy, setBusy] = useState(false);

  const set = (id: string, patch: Partial<InspectionAnswer>) => setAnswers((a) => ({ ...a, [id]: { ...(a[id] ?? EMPTY), ...patch } }));

  async function submit() {
    if (!list || !projectId) return;
    const errors = inspectionErrors(list.items, answers);
    if (errors.length) return Alert.alert("Falta completar", errors.slice(0, 4).join("\n"));
    let elementId: string | null = null;
    if (element.trim()) {
      const found = elements.find((e) => e.code.toUpperCase() === element.trim().toUpperCase());
      if (!found) return Alert.alert("Elemento no encontrado", `No hay un elemento con el código ${element.trim().toUpperCase()} en el plano.`);
      elementId = found.id;
    }
    setBusy(true);
    try {
      await queueInspection(projectId, {
        project_id: projectId,
        checklist_id: list.id,
        activity_id: activity ?? list.activity_id,
        element_id: elementId,
        location_note: location,
        inspected_on: todayLocal(),
        answers: list.items.map((it) => ({ id: it.id, ...(answers[it.id] ?? EMPTY) })),
      });
      const nc = list.items.filter((it) => answers[it.id]?.result === "no_ok").length;
      Alert.alert(
        nc ? "Inspección rechazada" : "Inspección aprobada",
        `${nc ? `Al sincronizar se abren ${nc} no conformidad(es) y las verás en Calidad.` : "Todos los puntos cumplen."} Se registra cuando el teléfono tenga señal.`,
      );
      router.back();
    } catch (e) {
      Alert.alert("No se pudo guardar", String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Inspección" }} />
      {lists.length === 0 ? <Body muted>No hay listas de chequeo activas: las crea el residente en la web (Campo → Calidad) y llegan al sincronizar.</Body> : null}

      {!list ? (
        <>
          <Title>¿Qué lista de chequeo?</Title>
          {lists.map((l) => (
            <BigButton
              key={l.id}
              title={l.name}
              subtitle={`${l.items.length} punto(s)`}
              onPress={() => {
                setList(l);
                setActivity(l.activity_id);
                setAnswers({});
              }}
            />
          ))}
        </>
      ) : (
        <>
          <Title>{list.name}</Title>
          <Label>Actividad</Label>
          <Chips options={activities.map((a) => ({ value: a.id, label: a.code }))} value={activity} onChange={setActivity} />
          <Label>Elemento del plano (código, opcional)</Label>
          <Input value={element} onChangeText={setElement} placeholder="TRK-001" autoCapitalize="characters" />
          <Label>Ubicación (opcional)</Label>
          <Input value={location} onChangeText={setLocation} placeholder="Fila 12, subcampo 3" />

          {list.items.map((it, i) => {
            const a = answers[it.id] ?? EMPTY;
            return (
              <Card key={it.id} accent={a.result === "no_ok" ? t.danger : a.result ? t.success : undefined}>
                <Body>{`${i + 1}. ${it.text}`}</Body>
                <Chips
                  options={[
                    { value: "ok", label: "Cumple" },
                    { value: "no_ok", label: "No cumple" },
                    { value: "na", label: "No aplica" },
                  ]}
                  value={a.result || null}
                  onChange={(v) => set(it.id, { result: v })}
                />
                {a.result === "no_ok" ? (
                  <>
                    <Input value={a.note} onChangeText={(v) => set(it.id, { note: v })} placeholder="Qué no cumple" />
                    <Chips
                      options={[
                        { value: "no", label: "No impeditivo" },
                        { value: "si", label: "Impeditivo" },
                      ]}
                      value={a.impeditive ? "si" : "no"}
                      onChange={(v) => set(it.id, { impeditive: v === "si" })}
                    />
                  </>
                ) : null}
              </Card>
            );
          })}
          <BigButton title="Registrar inspección" variant="primary" large loading={busy} onPress={() => void submit()} />
          <BigButton title="Elegir otra lista" onPress={() => setList(null)} />
        </>
      )}
    </Screen>
  );
}
