import { useQuery } from "@powersync/react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { cumulativePct, rankActivities, type RecentEntry } from "../../../core/recent";
import { todayLocal } from "../../../services/ids";
import { useSession } from "../../../state/session";
import { BigButton, Screen, Title } from "../../../ui/components";

/** Toque 2 de 3: elegir la actividad. Las que el usuario usa más arriba, con % acumulado. */
export default function Activities() {
  const { frontId } = useLocalSearchParams<{ frontId: string }>();
  const { userId } = useSession();
  const today = todayLocal();

  const { data: front } = useQuery<{ name: string; code: string }>("SELECT name, code FROM fronts WHERE id = ?", [frontId]);
  const { data: activities } = useQuery<{ id: string; code: string; name: string; unit: string; contract_qty: number; executed: number }>(
    `SELECT a.id, a.code, a.name, a.unit, a.contract_qty,
            COALESCE((SELECT SUM(e.quantity) FROM progress_entries e
                      WHERE e.activity_id = a.id AND e.status IN ('submitted','approved')), 0) AS executed
     FROM activities a WHERE a.front_id = ?`,
    [frontId],
  );
  const { data: recent } = useQuery<RecentEntry>(
    `SELECT activity_id, work_date, client_created_at, quantity, effective_hours, crew_size, weather
     FROM progress_entries WHERE created_by = ? AND work_date >= date(?, '-14 day')`,
    [userId ?? "", today],
  );

  const { data: drafts } = useQuery<{ activity_id: string }>(
    "SELECT activity_id FROM capture_drafts WHERE user_id = ? AND front_id = ?",
    [userId ?? "", frontId],
  );
  const withDraft = useMemo(() => new Set(drafts.map((d) => d.activity_id)), [drafts]);

  const ranked = useMemo(() => rankActivities(activities, recent, today), [activities, recent, today]);

  return (
    <Screen>
      <Stack.Screen options={{ title: front[0] ? `${front[0].code} · ${front[0].name}` : "Actividad" }} />
      <Title>¿Qué actividad?</Title>
      {ranked.map((a) => (
        <BigButton
          key={a.id}
          large
          title={a.name}
          variant={withDraft.has(a.id) ? "primary" : "secondary"}
          subtitle={`${withDraft.has(a.id) ? "✎ Borrador sin guardar · " : ""}${cumulativePct(a.executed, a.contract_qty)} % · ${a.executed.toLocaleString("es-CO")} de ${a.contract_qty.toLocaleString("es-CO")} ${a.unit}`}
          onPress={() =>
            router.push({ pathname: "/registro/[frontId]/[activityId]", params: { frontId, activityId: a.id } })
          }
        />
      ))}
      <BigButton title="⌗ Escanear código QR" onPress={() => router.push("/escanear")} />
    </Screen>
  );
}
