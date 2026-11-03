import { useQuery } from "@powersync/react";
import { router, Stack } from "expo-router";
import { useSession } from "../../state/session";
import { BigButton, Body, Screen, Title } from "../../ui/components";

/** Administración del proyecto desde el teléfono: frentes y actividades. */
export default function AdminHome() {
  const { projectId, role } = useSession();
  const { data: fronts } = useQuery<{ id: string; code: string; name: string; activities: number }>(
    `SELECT f.id, f.code, f.name, (SELECT COUNT(*) FROM activities a WHERE a.front_id = f.id) AS activities
     FROM fronts f WHERE f.project_id = ? ORDER BY f.code`,
    [projectId ?? ""],
  );

  if (role !== "admin")
    return (
      <Screen>
        <Body>Solo el administrador del proyecto puede crear o editar frentes y actividades.</Body>
      </Screen>
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: "Administrar" }} />
      <Title>Frentes</Title>
      {fronts.map((f) => (
        <BigButton
          key={f.id}
          large
          title={`${f.code} · ${f.name}`}
          subtitle={`${f.activities} actividad(es)`}
          onPress={() => router.push({ pathname: "/admin/frente", params: { frontId: f.id } })}
        />
      ))}
      <BigButton title="＋ Nuevo frente" variant="primary" large onPress={() => router.push("/admin/frente")} />
      <Body muted>Los cambios se guardan en el teléfono y se sincronizan cuando haya señal.</Body>
    </Screen>
  );
}
