import { useQuery } from "@powersync/react";
import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { correctionDiff, correctionRequest } from "../core/quality";
import { todayLocal } from "../services/ids";
import { supabase } from "../services/supabase";
import { useSession } from "../state/session";
import { BigButton, Body, Card, Input, Label, Screen, Title } from "../ui/components";
import { useTheme } from "../ui/theme";

interface EntryRow {
  id: string;
  work_date: string;
  quantity: number;
  status: string;
  notes: string | null;
  code: string;
  name: string;
  unit: string;
}

interface CorrectionRow {
  id: string;
  entry_id: string;
  reason: string;
  previous: Record<string, unknown>;
  proposed: Record<string, unknown>;
  requested_by: string;
  status: "pendiente" | "aprobada" | "rechazada" | "anulada";
  decision_note: string | null;
  requested_at: string;
}

const STATUS: Record<string, string> = { submitted: "Enviado", approved: "Aprobado", rejected: "Rechazado", draft: "Borrador" };
const n = (x: number) => x.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/**
 * Mis registros y sus correcciones: lo aprobado no se edita; se pide una corrección con su motivo
 * y la decide el residente, el director o el administrador. Pedirla necesita señal.
 */
export default function Registros() {
  const t = useTheme();
  const { projectId, userId, role } = useSession();
  const seesAll = role === "resident" || role === "director" || role === "admin";
  // Los registros vienen del teléfono (sincronizados); el supervisor ve los suyos
  const { data: entries } = useQuery<EntryRow>(
    `SELECT e.id, e.work_date, e.quantity, e.status, e.notes, a.code, a.name, a.unit
     FROM progress_entries e JOIN activities a ON a.id = e.activity_id
     WHERE e.project_id = ? AND e.status != 'draft' AND (? = 1 OR e.created_by = ?)
     ORDER BY e.work_date DESC LIMIT 80`,
    [projectId ?? "", seesAll ? 1 : 0, userId ?? ""],
  );
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [online, setOnline] = useState(true);
  const [editing, setEditing] = useState<{ entry: EntryRow; quantity: string; work_date: string; notes: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const pendingToDecide = seesAll ? corrections.filter((c) => c.status === "pendiente") : [];

  const load = useCallback(async () => {
    if (!projectId) return;
    const { data, error } = await supabase.from("entry_corrections").select("id, entry_id, reason, previous, proposed, requested_by, status, decision_note, requested_at").eq("project_id", projectId).order("requested_at", { ascending: false }).limit(300);
    setOnline(!error);
    if (!error) setCorrections((data ?? []) as CorrectionRow[]);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** La corrección más reciente de un registro (pendiente, aprobada o rechazada). */
  const lastCorrection = (id: string) => corrections.find((c) => c.entry_id === id);

  async function send() {
    if (!editing) return;
    const r = correctionRequest({ quantity: editing.entry.quantity, work_date: editing.entry.work_date, notes: editing.entry.notes ?? "" }, editing, todayLocal());
    if (r.error) return Alert.alert("Revisa la corrección", r.error);
    setBusy(true);
    const { error } = await supabase.rpc("request_correction", { p_entry: editing.entry.id, p_reason: editing.reason.trim(), p_changes: r.changes });
    setBusy(false);
    if (error) return Alert.alert("No se pudo enviar", `${error.message}\n\nEsta acción necesita señal.`);
    Alert.alert("Corrección enviada", "Queda pendiente hasta que el residente, el director o el administrador la apruebe.");
    setEditing(null);
    await load();
  }

  async function decide(c: CorrectionRow, approve: boolean, note?: string) {
    setDeciding(c.id);
    const { error } = await supabase.rpc("decide_correction", { p_id: c.id, p_approve: approve, p_note: note ?? null });
    setDeciding(null);
    if (error) return Alert.alert("No se pudo decidir", `${error.message}

Esta acción necesita señal.`);
    setRejecting(null);
    Alert.alert(approve ? "Corrección aprobada" : "Corrección rechazada", approve ? "El registro quedó corregido y la versión anterior queda en el historial." : "Quien la pidió verá el motivo.");
    await load();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Mis registros" }} />
      {!online ? (
        <Card accent={t.warning}>
          <Body>Sin señal: puedes ver tus registros, pero pedir correcciones necesita conexión.</Body>
          <BigButton title="Reintentar" onPress={() => void load()} />
        </Card>
      ) : null}

      {editing ? (
        <Card accent={t.primary}>
          <Title>{`Corregir ${editing.entry.code} del ${editing.entry.work_date}`}</Title>
          <Body muted>El registro está aprobado: la corrección la decide otra persona y queda en el historial.</Body>
          <Label>{`Cantidad (${editing.entry.unit})`}</Label>
          <Input value={editing.quantity} onChangeText={(v) => setEditing({ ...editing, quantity: v })} keyboardType="decimal-pad" big />
          <Label>Fecha (AAAA-MM-DD)</Label>
          <Input value={editing.work_date} onChangeText={(v) => setEditing({ ...editing, work_date: v })} keyboardType="numbers-and-punctuation" />
          <Label>Notas</Label>
          <Input value={editing.notes} onChangeText={(v) => setEditing({ ...editing, notes: v })} />
          <Label>Motivo de la corrección</Label>
          <Input value={editing.reason} onChangeText={(v) => setEditing({ ...editing, reason: v })} placeholder="p. ej. Se digitó 10 en vez de 1" multiline />
          <BigButton title="Enviar corrección" variant="primary" loading={busy} onPress={() => void send()} />
          <BigButton title="Cancelar" onPress={() => setEditing(null)} />
        </Card>
      ) : null}

      {pendingToDecide.length ? <Title>{`Correcciones por decidir (${pendingToDecide.length})`}</Title> : null}
      {pendingToDecide.map((c) => {
        const e = entries.find((x) => x.id === c.entry_id);
        const own = c.requested_by === userId && role !== "admin";
        return (
          <Card key={c.id} accent={t.warning}>
            <Body>{e ? `${e.code} · ${e.name} · ${e.work_date}` : "Registro del proyecto"}</Body>
            {correctionDiff(c.previous, c.proposed).map((line) => (
              <Body key={line}>{line}</Body>
            ))}
            <Body muted>{`Motivo: ${c.reason}`}</Body>
            {own ? (
              <Body muted>La pediste tú: la decide otra persona (residente, director o administrador).</Body>
            ) : rejecting?.id === c.id ? (
              <>
                <Label>¿Por qué se rechaza?</Label>
                <Input value={rejecting.note} onChangeText={(v) => setRejecting({ id: c.id, note: v })} placeholder="p. ej. La cantidad sí coincide con el plano" multiline />
                <BigButton
                  title="Rechazar"
                  variant="danger"
                  loading={deciding === c.id}
                  onPress={() =>
                    rejecting.note.trim().length < 5
                      ? Alert.alert("Falta el motivo", "Explica por qué se rechaza (al menos 5 letras).")
                      : void decide(c, false, rejecting.note.trim())
                  }
                />
                <BigButton title="Cancelar" onPress={() => setRejecting(null)} />
              </>
            ) : (
              <>
                <BigButton
                  title="Aprobar corrección"
                  variant="success"
                  loading={deciding === c.id}
                  onPress={() =>
                    Alert.alert("Aprobar corrección", "El registro aprobado cambia y la versión anterior queda en el historial.", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Aprobar", onPress: () => void decide(c, true) },
                    ])
                  }
                />
                <BigButton title="Rechazar…" onPress={() => setRejecting({ id: c.id, note: "" })} />
              </>
            )}
          </Card>
        );
      })}

      <Title>{seesAll ? "Registros del proyecto" : "Mis registros"}</Title>
      {entries.length === 0 ? <Body muted>No hay registros todavía.</Body> : null}
      {entries.map((e) => {
        const c = lastCorrection(e.id);
        const open = c?.status === "pendiente";
        return (
          <Card key={e.id} accent={e.status === "approved" ? t.success : e.status === "rejected" ? t.danger : t.warning}>
            <Body>{`${e.code} · ${e.name}`}</Body>
            <Body muted>{`${e.work_date} · ${n(Number(e.quantity))} ${e.unit} · ${STATUS[e.status] ?? e.status}`}</Body>
            {c ? (
              <Body muted>
                {c.status === "pendiente"
                  ? "Corrección pendiente de aprobación"
                  : c.status === "aprobada"
                    ? "Corrección aprobada"
                    : c.status === "rechazada"
                      ? `Corrección rechazada${c.decision_note ? `: ${c.decision_note}` : ""}`
                      : "Corrección anulada"}
              </Body>
            ) : null}
            {e.status === "approved" && !open && online ? (
              <BigButton
                title="Pedir corrección"
                onPress={() => setEditing({ entry: e, quantity: String(e.quantity).replace(".", ","), work_date: e.work_date, notes: e.notes ?? "", reason: "" })}
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
