import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { todayLocal } from "../services/ids";
import { supabase } from "../services/supabase";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Chips, Input, Label, Row, Screen, Title } from "../ui/components";
import { useTheme } from "../ui/theme";

type TestStatus = "pendiente" | "enviado" | "aprobado" | "rechazado" | "no_aplica";
const STATUS: { value: TestStatus; label: string }[] = [
  { value: "pendiente", label: "Pendiente" },
  { value: "enviado", label: "Enviado" },
  { value: "aprobado", label: "Aprobado" },
  { value: "rechazado", label: "Rechazado" },
];

interface LabTest {
  id: string;
  name: string;
  standard: string | null;
  sample_date: string | null;
  lab: string | null;
  status: TestStatus;
}

interface Constraint {
  id: string;
  description: string;
  responsible: string | null;
  need_by: string | null;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Ensayos y restricciones desde el teléfono. Se leen y escriben en línea (no se guardan para
 * trabajar sin señal): el residente los registra en obra y todos ven qué está pendiente.
 */
export default function Control() {
  const t = useTheme();
  const { projectId, role } = useSession();
  const canWrite = role === "resident" || role === "director" || role === "admin";
  const [tests, setTests] = useState<LabTest[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "offline">("loading");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState({ name: "", standard: "", sample_date: todayLocal() });
  const [cons, setCons] = useState({ description: "", responsible: "", need_by: "" });

  const load = useCallback(async () => {
    if (!projectId) return;
    setState("loading");
    const [a, b] = await Promise.all([
      supabase.from("lab_tests").select("id, name, standard, sample_date, lab, status").eq("project_id", projectId).in("status", ["pendiente", "enviado", "rechazado"]).order("sample_date"),
      supabase.from("project_constraints").select("id, description, responsible, need_by").eq("project_id", projectId).eq("status", "abierta").order("need_by"),
    ]);
    if (a.error || b.error) return setState("offline");
    setTests((a.data ?? []) as LabTest[]);
    setConstraints((b.data ?? []) as Constraint[]);
    setState("ok");
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Escritura en línea con aviso claro si no hay señal. */
  async function write(run: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    const { error } = await run();
    setBusy(false);
    if (error) {
      Alert.alert("No se pudo guardar", `${error.message}\n\nEsta pantalla necesita señal.`);
      return false;
    }
    Alert.alert("Listo", done);
    await load();
    return true;
  }

  async function addTest() {
    if (test.name.trim().length < 3) return Alert.alert("Falta el ensayo", "Escribe qué ensayo o prueba es, por ejemplo: Densidad en campo.");
    if (test.sample_date && !isDate(test.sample_date)) return Alert.alert("Fecha no válida", "Usa el formato AAAA-MM-DD, por ejemplo 2026-10-22.");
    const ok = await write(
      () =>
        supabase.from("lab_tests").insert({
          project_id: projectId,
          name: test.name.trim(),
          standard: test.standard.trim() || null,
          sample_date: test.sample_date || null,
          status: "pendiente",
        }),
      "Ensayo registrado. Sale en el informe semanal.",
    );
    if (ok) setTest({ name: "", standard: "", sample_date: todayLocal() });
  }

  async function addConstraint() {
    if (cons.description.trim().length < 5) return Alert.alert("Falta la restricción", "Describe qué impide avanzar, por ejemplo: Falta permiso de servidumbre.");
    if (cons.need_by && !isDate(cons.need_by)) return Alert.alert("Fecha no válida", "Usa el formato AAAA-MM-DD, por ejemplo 2026-10-30.");
    const ok = await write(
      () =>
        supabase.from("project_constraints").insert({
          project_id: projectId,
          description: cons.description.trim(),
          responsible: cons.responsible.trim() || null,
          need_by: cons.need_by || null,
        }),
      "Restricción registrada.",
    );
    if (ok) setCons({ description: "", responsible: "", need_by: "" });
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Ensayos y restricciones" }} />
      {state === "offline" ? (
        <Card accent={t.warning}>
          <Body>Sin señal: esta pantalla necesita conexión para leer y guardar.</Body>
          <BigButton title="Reintentar" onPress={() => void load()} />
        </Card>
      ) : null}
      {state === "loading" ? <Body muted>Cargando…</Body> : null}

      <Title>{`Restricciones abiertas (${constraints.length})`}</Title>
      {state === "ok" && constraints.length === 0 ? <Body muted>No hay restricciones abiertas.</Body> : null}
      {constraints.map((c) => (
        <Card key={c.id} accent={c.need_by && c.need_by < todayLocal() ? t.danger : t.warning}>
          <Body>{c.description}</Body>
          <Body muted>{[c.responsible ? `Responsable: ${c.responsible}` : null, c.need_by ? `Para el ${c.need_by}` : null].filter(Boolean).join(" · ") || "Sin responsable ni fecha"}</Body>
          {canWrite ? (
            <BigButton
              title="✓ Liberar"
              disabled={busy}
              onPress={() => void write(() => supabase.from("project_constraints").update({ status: "liberada" }).eq("id", c.id), "Restricción liberada.")}
            />
          ) : null}
        </Card>
      ))}

      <Title>{`Ensayos en curso (${tests.length})`}</Title>
      {state === "ok" && tests.length === 0 ? <Body muted>No hay ensayos pendientes.</Body> : null}
      {tests.map((x) => (
        <Card key={x.id}>
          <Body>{[x.name, x.standard].filter(Boolean).join(" · ")}</Body>
          <Body muted>{[x.sample_date ? `Muestra ${x.sample_date}` : null, x.lab].filter(Boolean).join(" · ") || "Sin fecha de muestra"}</Body>
          {canWrite ? (
            <Chips
              options={STATUS}
              value={x.status}
              onChange={(status) => void write(() => supabase.from("lab_tests").update({ status }).eq("id", x.id), `Estado: ${STATUS.find((s) => s.value === status)?.label}.`)}
            />
          ) : (
            <Body>{`Estado: ${STATUS.find((s) => s.value === x.status)?.label ?? x.status}`}</Body>
          )}
        </Card>
      ))}

      {canWrite ? (
        <>
          <Title>Nueva restricción</Title>
          <Label>Qué impide avanzar</Label>
          <Input value={cons.description} onChangeText={(v) => setCons({ ...cons, description: v })} placeholder="p. ej. Falta permiso de servidumbre" />
          <Row>
            <Input style={{ flex: 1 }} value={cons.responsible} onChangeText={(v) => setCons({ ...cons, responsible: v })} placeholder="Responsable" />
            <Input style={{ flex: 1 }} value={cons.need_by} onChangeText={(v) => setCons({ ...cons, need_by: v })} placeholder="Para (AAAA-MM-DD)" keyboardType="numbers-and-punctuation" />
          </Row>
          <BigButton title="Registrar restricción" variant="primary" loading={busy} onPress={() => void addConstraint()} />

          <Title>Nuevo ensayo</Title>
          <Label>Ensayo o prueba</Label>
          <Input value={test.name} onChangeText={(v) => setTest({ ...test, name: v })} placeholder="p. ej. Densidad en campo" />
          <Row>
            <Input style={{ flex: 1 }} value={test.standard} onChangeText={(v) => setTest({ ...test, standard: v })} placeholder="Norma (INV E-161)" />
            <Input style={{ flex: 1 }} value={test.sample_date} onChangeText={(v) => setTest({ ...test, sample_date: v })} placeholder="Muestra (AAAA-MM-DD)" keyboardType="numbers-and-punctuation" />
          </Row>
          <BigButton title="Registrar ensayo" variant="primary" loading={busy} onPress={() => void addTest()} />
        </>
      ) : (
        <Body muted>Los registra el residente, el director o el administrador.</Body>
      )}
    </Screen>
  );
}
