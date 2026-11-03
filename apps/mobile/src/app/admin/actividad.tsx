import { useQuery } from "@powersync/react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { UNIT_OPTIONS, validateActivity, type ActivityInput } from "../../core/catalog";
import { createActivity, updateActivity } from "../../services/catalog";
import { useSession } from "../../state/session";
import { BigButton, Body, Chips, Input, Label, Screen } from "../../ui/components";

const EMPTY: ActivityInput = { code: "", name: "", unit: "", contractQty: "", plannedStart: "", plannedFinish: "" };

/** Crear o editar una actividad: código, nombre, unidad, cantidad contractual y fechas. */
export default function AdminActivity() {
  const p = useLocalSearchParams<{ frontId: string; activityId?: string; tplCode?: string; tplName?: string; tplUnit?: string }>();
  const { projectId, role } = useSession();
  const [form, setForm] = useState<ActivityInput>({
    ...EMPTY,
    code: p.tplCode ?? "",
    name: p.tplName ?? "",
    unit: p.tplUnit ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ActivityInput, string>>>({});
  const [loaded, setLoaded] = useState(!p.activityId);

  const { data: siblings } = useQuery<{ id: string; code: string }>("SELECT id, code FROM activities WHERE front_id = ?", [p.frontId]);
  const { data: current } = useQuery<{
    code: string; name: string; unit: string; contract_qty: number; planned_start: string | null; planned_finish: string | null; executed: number;
  }>(
    `SELECT a.code, a.name, a.unit, a.contract_qty, a.planned_start, a.planned_finish,
            COALESCE((SELECT SUM(quantity) FROM progress_entries e WHERE e.activity_id = a.id AND e.status IN ('submitted','approved')), 0) AS executed
     FROM activities a WHERE a.id = ?`,
    [p.activityId ?? ""],
  );
  const existing = current[0];

  useEffect(() => {
    if (existing && !loaded) {
      setForm({
        code: existing.code,
        name: existing.name,
        unit: existing.unit,
        contractQty: String(existing.contract_qty),
        plannedStart: existing.planned_start ?? "",
        plannedFinish: existing.planned_finish ?? "",
      });
      setLoaded(true);
    }
  }, [existing, loaded]);

  if (role !== "admin") return <Screen><Body>Solo el administrador puede editar actividades.</Body></Screen>;

  const set = (k: keyof ActivityInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: keyof ActivityInput) => (errors[k] ? <Body>{`⚠ ${errors[k]}`}</Body> : null);

  async function save() {
    if (!projectId) return;
    const v = validateActivity(
      form,
      siblings.filter((s) => s.id !== p.activityId).map((s) => s.code),
      existing?.code,
      existing?.executed ?? 0,
    );
    setErrors(v.errors);
    if (!v.ok) return;
    if (p.activityId) await updateActivity(p.activityId, form);
    else await createActivity(projectId, p.frontId, form);
    Alert.alert("✓ Actividad guardada", "Ya aparece para registrar avance en este frente.");
    router.back();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: p.activityId ? "Editar actividad" : "Nueva actividad" }} />
      <Label>Nombre</Label>
      <Input value={form.name} onChangeText={set("name")} placeholder="Hincado de pilotes" />
      {err("name")}
      <Label>Código</Label>
      <Input value={form.code} onChangeText={set("code")} autoCapitalize="characters" maxLength={20} placeholder="BC-HIN" />
      {err("code")}
      <Label>Unidad</Label>
      <Chips options={UNIT_OPTIONS.map((u) => ({ value: u, label: u }))} value={form.unit} onChange={set("unit")} />
      <Input value={form.unit} onChangeText={set("unit")} placeholder="u otra unidad" />
      {err("unit")}
      <Label>Cantidad contractual</Label>
      <Input value={form.contractQty} onChangeText={set("contractQty")} keyboardType="decimal-pad" placeholder="1.000" />
      {err("contractQty")}
      {existing && existing.executed > 0 ? <Body muted>{`Ya ejecutado: ${existing.executed.toLocaleString("es-CO")} ${existing.unit}`}</Body> : null}
      <Label>Inicio programado (AAAA-MM-DD, opcional)</Label>
      <Input value={form.plannedStart} onChangeText={set("plannedStart")} placeholder="2026-10-20" keyboardType="numbers-and-punctuation" />
      {err("plannedStart")}
      <Label>Fin programado (AAAA-MM-DD, opcional)</Label>
      <Input value={form.plannedFinish} onChangeText={set("plannedFinish")} placeholder="2026-11-30" keyboardType="numbers-and-punctuation" />
      {err("plannedFinish")}
      <BigButton title="Guardar actividad" variant="primary" large onPress={save} />
    </Screen>
  );
}
