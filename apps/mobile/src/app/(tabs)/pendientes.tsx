import type { FindingStatus, Severity } from "@avanceobra/shared";
import { useQuery } from "@powersync/react";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable } from "react-native";
import { ageDays, filterFindings, isOverdue, SEVERITY_LABEL, STATUS_LABEL, TYPE_LABEL, type FindingLike } from "../../core/findings";
import { todayLocal } from "../../services/ids";
import { useSession } from "../../state/session";
import { BigButton, Body, Card, Chips, Label, Screen } from "../../ui/components";
import { severityColor, useTheme } from "../../ui/theme";

type Row = FindingLike & { description: string; front: string | null; responsible: string | null };

/** "Puntos pendientes de revisión" con filtros por área, responsable, severidad y antigüedad. */
export default function Pendientes() {
  const { projectId, userId } = useSession();
  const t = useTheme();
  const today = todayLocal();
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<FindingStatus | "pending">("pending");
  const [frontId, setFrontId] = useState<string>("all");
  const [scope, setScope] = useState<"all" | "mine" | "overdue" | "old">("all");

  const { data } = useQuery<Row>(
    `SELECT f.id, f.severity, f.status, f.type, f.front_id, f.responsible_user_id, f.due_date, f.created_at, f.description,
            fr.code AS front, m.member_name AS responsible
     FROM findings f LEFT JOIN fronts fr ON fr.id = f.front_id
     LEFT JOIN memberships m ON m.user_id = f.responsible_user_id AND m.project_id = f.project_id
     WHERE f.project_id = ?`,
    [projectId ?? ""],
  );
  const { data: fronts } = useQuery<{ id: string; code: string }>("SELECT id, code FROM fronts WHERE project_id = ? ORDER BY code", [projectId ?? ""]);

  const list = useMemo(
    () =>
      filterFindings(
        data,
        {
          severities: severity === "all" ? undefined : [severity],
          statuses: status === "pending" ? undefined : [status],
          frontId: frontId === "all" ? null : frontId,
          responsibleId: scope === "mine" ? userId : null,
          overdueOnly: scope === "overdue",
          minAgeDays: scope === "old" ? 7 : undefined,
        },
        today,
      ),
    [data, severity, status, frontId, scope, userId, today],
  );

  return (
    <Screen>
      <BigButton title="⚑ Nuevo hallazgo" variant="primary" large onPress={() => router.push("/hallazgo/nuevo")} />
      <Label>Ver</Label>
      <Chips
        options={[
          { value: "all", label: "Todos" },
          { value: "mine", label: "Míos" },
          { value: "overdue", label: "Vencidos" },
          { value: "old", label: "> 7 días" },
        ]}
        value={scope}
        onChange={setScope}
      />
      <Label>Severidad</Label>
      <Chips
        options={[{ value: "all" as const, label: "Todas" }, ...(["critical", "high", "medium", "low"] as Severity[]).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))]}
        value={severity}
        onChange={setSeverity}
      />
      <Label>Estado</Label>
      <Chips
        options={[{ value: "pending" as const, label: "Sin cerrar" }, ...(Object.keys(STATUS_LABEL) as FindingStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
        value={status}
        onChange={setStatus}
      />
      {fronts.length > 1 ? (
        <>
          <Label>Frente</Label>
          <Chips options={[{ value: "all", label: "Todos" }, ...fronts.map((f) => ({ value: f.id, label: f.code }))]} value={frontId} onChange={setFrontId} />
        </>
      ) : null}
      <Label>{`${list.length} pendiente(s)`}</Label>
      {list.map((f) => (
        <Pressable key={f.id} onPress={() => router.push({ pathname: "/hallazgo/[id]", params: { id: f.id } })} accessibilityRole="button">
          <Card accent={severityColor(t, f.severity)}>
            <Label>{`${SEVERITY_LABEL[f.severity]} · ${TYPE_LABEL[f.type] ?? f.type} · ${STATUS_LABEL[f.status]}`}</Label>
            <Body>{f.description}</Body>
            <Body muted>
              {`${f.front ?? "Sin frente"} · ${f.responsible ?? "Sin responsable"} · ${ageDays(f.created_at, today)} días`}
              {f.due_date ? ` · vence ${f.due_date}${isOverdue(f, today) ? " ⚠ VENCIDO" : ""}` : ""}
            </Body>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
