import { useQuery } from "@powersync/react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { suggestActivityCode, SOLAR_TEMPLATES, validateFront } from "../../core/catalog";
import { createFront, updateFront } from "../../services/catalog";
import { useSession } from "../../state/session";
import { BigButton, Body, Input, Label, Row, Screen, Title } from "../../ui/components";
import { useTheme } from "../../ui/theme";

/** Crear o editar un frente, y ver/crear sus actividades (con plantillas de obra solar). */
export default function AdminFront() {
  const { frontId } = useLocalSearchParams<{ frontId?: string }>();
  const { projectId, role } = useSession();
  const t = useTheme();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({});
  const [loaded, setLoaded] = useState(!frontId);

  const { data: fronts } = useQuery<{ id: string; code: string; name: string }>(
    "SELECT id, code, name FROM fronts WHERE project_id = ?",
    [projectId ?? ""],
  );
  const { data: activities } = useQuery<{ id: string; code: string; name: string; unit: string; contract_qty: number }>(
    "SELECT id, code, name, unit, contract_qty FROM activities WHERE front_id = ? ORDER BY code",
    [frontId ?? ""],
  );
  const current = fronts.find((f) => f.id === frontId);

  useEffect(() => {
    if (current && !loaded) {
      setCode(current.code);
      setName(current.name);
      setLoaded(true);
    }
  }, [current, loaded]);

  if (role !== "admin") return <Screen><Body>Solo el administrador puede editar frentes.</Body></Screen>;

  async function save() {
    if (!projectId) return;
    const v = validateFront({ code, name }, fronts.map((f) => f.code), current?.code);
    setErrors(v.errors);
    if (!v.ok) return;
    if (current) {
      await updateFront(current.id, { code, name });
      Alert.alert("✓ Frente actualizado");
    } else {
      const id = await createFront(projectId, { code, name });
      router.replace({ pathname: "/admin/frente", params: { frontId: id } });
    }
  }

  const existingCodes = activities.map((a) => a.code);
  const used = new Set(activities.map((a) => a.name.toLowerCase()));

  return (
    <Screen>
      <Stack.Screen options={{ title: current ? `Frente ${current.code}` : "Nuevo frente" }} />
      <Label>Código (ej. BC)</Label>
      <Input value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={20} />
      {errors.code ? <Body>{`⚠ ${errors.code}`}</Body> : null}
      <Label>Nombre (ej. Bloque C)</Label>
      <Input value={name} onChangeText={setName} />
      {errors.name ? <Body>{`⚠ ${errors.name}`}</Body> : null}
      <BigButton title={current ? "Guardar cambios" : "Crear frente"} variant="primary" large onPress={save} />

      {current ? (
        <>
          <Title>Actividades</Title>
          {activities.map((a) => (
            <BigButton
              key={a.id}
              title={`${a.code} · ${a.name}`}
              subtitle={`${a.contract_qty.toLocaleString("es-CO")} ${a.unit}`}
              onPress={() => router.push({ pathname: "/admin/actividad", params: { frontId: current.id, activityId: a.id } })}
            />
          ))}
          <BigButton
            title="＋ Actividad en blanco"
            variant="primary"
            onPress={() => router.push({ pathname: "/admin/actividad", params: { frontId: current.id } })}
          />
          <Label>Plantillas de obra solar (un toque)</Label>
          <Row style={{ flexWrap: "wrap" }}>
            {SOLAR_TEMPLATES.filter((tpl) => !used.has(tpl.name.toLowerCase())).map((tpl) => (
              <BigButton
                key={tpl.suffix}
                title={tpl.name}
                subtitle={tpl.unit}
                style={{ borderColor: t.primary }}
                onPress={() =>
                  router.push({
                    pathname: "/admin/actividad",
                    params: {
                      frontId: current.id,
                      tplCode: suggestActivityCode(current.code, tpl.suffix, existingCodes),
                      tplName: tpl.name,
                      tplUnit: tpl.unit,
                    },
                  })
                }
              />
            ))}
          </Row>
        </>
      ) : null}
    </Screen>
  );
}
