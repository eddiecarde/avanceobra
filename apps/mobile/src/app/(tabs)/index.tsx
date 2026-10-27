import { useQuery } from "@powersync/react";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { mondayOf } from "@avanceobra/engine";
import { homeProgress, pctText, todayTasks } from "../../core/home";
import { todayLocal } from "../../services/ids";
import { useSession } from "../../state/session";
import { BigButton, Body, Card, Screen, Title } from "../../ui/components";
import { useTheme } from "../../ui/theme";

/**
 * Toque 1 de 3: elegir el frente. Se muestra si el frente ya tiene reporte hoy,
 * para que el supervisor vea de un vistazo qué le falta, y los borradores sin guardar.
 */
export default function Fronts() {
  const { projectId, setProjectId, userId, role } = useSession();
  const t = useTheme();
  const today = todayLocal();
  const [more, setMore] = useState(false);

  const { data: projects } = useQuery<{ id: string; name: string; code: string }>(
    "SELECT p.id, p.name, p.code FROM projects p JOIN memberships m ON m.project_id = p.id WHERE m.user_id = ? ORDER BY p.name",
    [userId ?? ""],
  );
  const { data: fronts } = useQuery<{ id: string; code: string; name: string; reported_today: number }>(
    `SELECT f.id, f.code, f.name,
            (SELECT COUNT(*) FROM progress_entries e WHERE e.front_id = f.id AND e.work_date = ?) AS reported_today
     FROM fronts f WHERE f.project_id = ?
       -- Un subcontratista solo recibe las actividades de su empresa: sin ellas, el frente no se muestra
       AND EXISTS (SELECT 1 FROM activities a WHERE a.front_id = f.id)
     ORDER BY f.code`,
    [today, projectId ?? ""],
  );
  const { data: drafts } = useQuery<{ activity_id: string; front_id: string; name: string; front: string; updated_at: string }>(
    `SELECT d.activity_id, d.front_id, a.name, f.code AS front, d.updated_at
     FROM capture_drafts d JOIN activities a ON a.id = d.activity_id JOIN fronts f ON f.id = d.front_id
     WHERE d.user_id = ? AND a.project_id = ? ORDER BY d.updated_at DESC`,
    [userId ?? "", projectId ?? ""],
  );

  // Resumen de la obra con lo que hay en el teléfono: funciona sin señal
  const { data: acts } = useQuery<{ id: string; code: string; name: string; unit: string; contract_qty: number; planned_start: string | null; planned_finish: string | null }>(
    "SELECT id, code, name, unit, contract_qty, planned_start, planned_finish FROM activities WHERE project_id = ?",
    [projectId ?? ""],
  );
  const { data: done } = useQuery<{ activity_id: string; qty: number }>(
    "SELECT activity_id, SUM(quantity) AS qty FROM progress_entries WHERE project_id = ? AND status IN ('submitted', 'approved') AND work_date <= ? GROUP BY activity_id",
    [projectId ?? "", today],
  );
  const { data: open } = useQuery<{ n: number; critical: number }>(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical FROM findings WHERE project_id = ? AND status != 'closed'",
    [projectId ?? ""],
  );
  // Lo que toca hoy: el plan semanal comprometido contra lo registrado esta semana
  const weekStart = mondayOf(today);
  const { data: planItems } = useQuery<{ activity_id: string; code: string; name: string; unit: string; front_id: string; planned_qty: number; responsible: string | null }>(
    `SELECT i.activity_id, a.code, a.name, a.unit, a.front_id, i.planned_qty, i.responsible
     FROM weekly_plan_items i JOIN weekly_plans p ON p.id = i.plan_id JOIN activities a ON a.id = i.activity_id
     WHERE p.project_id = ? AND p.week_start = ? AND p.status = 'comprometido'`,
    [projectId ?? "", weekStart],
  );
  const { data: weekEntries } = useQuery<{ activity_id: string; work_date: string; quantity: number }>(
    "SELECT activity_id, work_date, quantity FROM progress_entries WHERE project_id = ? AND work_date >= ? AND status IN ('submitted', 'approved')",
    [projectId ?? "", weekStart],
  );
  const tasks = useMemo(
    () =>
      todayTasks(
        planItems.map((i) => ({ activityId: i.activity_id, code: i.code, name: i.name, unit: i.unit, frontId: i.front_id, plannedQty: Number(i.planned_qty), responsible: i.responsible })),
        weekEntries.map((e) => ({ activityId: e.activity_id, workDate: e.work_date, quantity: Number(e.quantity) })),
        weekStart,
        today,
      ),
    [planItems, weekEntries, weekStart, today],
  );
  const pendingTasks = tasks.filter((x) => !x.done);
  const { data: unreadNotices } = useQuery<{ n: number }>("SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL", [userId ?? ""]);
  const progress = useMemo(
    () =>
      homeProgress(
        acts.map((a) => ({ id: a.id, code: a.code, name: a.name, unit: a.unit, contractQty: Number(a.contract_qty), plannedStart: a.planned_start, plannedFinish: a.planned_finish })),
        Object.fromEntries(done.map((d) => [d.activity_id, Number(d.qty)])),
        today,
      ),
    [acts, done, today],
  );

  if (!projectId || projects.length === 0) {
    return (
      <Screen>
        <Title>Elige el proyecto</Title>
        {projects.length === 0 ? <Body muted>Descargando proyectos… (requiere señal la primera vez)</Body> : null}
        {projects.map((p) => (
          <BigButton key={p.id} title={p.name} subtitle={p.code} large onPress={() => setProjectId(p.id)} />
        ))}
      </Screen>
    );
  }

  const current = projects.find((p) => p.id === projectId);
  return (
    <Screen>
      <View style={{ backgroundColor: NAVY, borderRadius: 18, padding: 16, gap: 12 }}>
        <View>
          <Text style={{ color: "#BFDBFE", fontSize: 14, fontWeight: "700", letterSpacing: 1 }}>AVANCE DE OBRA · {today}</Text>
          <Text style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "800" }}>{current?.name ?? "Proyecto"}</Text>
        </View>
        {progress ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700" }}>{`Real ${pctText(progress.actual)}`}</Text>
              <Text style={{ color: "#BFDBFE", fontSize: 18 }}>{`Programado ${pctText(progress.planned)}`}</Text>
            </View>
            <View style={{ height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
              <View style={{ width: `${Math.min(100, progress.actual * 100)}%`, height: 12, borderRadius: 6, backgroundColor: progress.actual >= progress.planned ? "#34D27A" : "#60A5FA" }} />
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Stat value={`${fronts.filter((f) => f.reported_today > 0).length}/${fronts.length}`} label="frentes con reporte hoy" />
          <Stat value={`${open[0]?.n ?? 0}`} label={(open[0]?.critical ?? 0) > 0 ? `hallazgos abiertos · ${open[0]!.critical} crítico(s)` : "hallazgos abiertos"} alert={(open[0]?.critical ?? 0) > 0} />
        </View>
      </View>
      {(unreadNotices[0]?.n ?? 0) > 0 ? (
        <BigButton title={`🔔 Avisos (${unreadNotices[0]!.n} sin leer)`} variant="primary" onPress={() => router.push("/avisos")} />
      ) : null}
      {tasks.length > 0 ? (
        <Card accent={t.primary}>
          <Body>{`🎯 Lo que toca hoy · plan semanal (${tasks.length - pendingTasks.length} de ${tasks.length} cumplidas)`}</Body>
          {pendingTasks.map((x) => (
            <BigButton
              key={x.activityId}
              title={`${x.code} · ${x.name}`}
              subtitle={`Hoy: ${qtyText(x.todayQty)} ${x.unit} · faltan ${qtyText(x.remainingQty)} de ${qtyText(x.plannedQty)} en la semana${x.responsible ? ` · ${x.responsible}` : ""}`}
              onPress={() => router.push({ pathname: "/registro/[frontId]/[activityId]", params: { frontId: x.frontId, activityId: x.activityId } })}
            />
          ))}
          {pendingTasks.length === 0 ? <Body muted>✓ Todo lo comprometido para la semana ya está registrado.</Body> : null}
        </Card>
      ) : null}
      {drafts.length > 0 ? (
        <Card accent={t.warning}>
          <Body>{`✎ Tienes ${drafts.length} borrador(es) sin guardar`}</Body>
          {drafts.map((d) => (
            <BigButton
              key={d.activity_id}
              title={`Continuar: ${d.name}`}
              subtitle={d.front}
              onPress={() =>
                router.push({ pathname: "/registro/[frontId]/[activityId]", params: { frontId: d.front_id, activityId: d.activity_id } })
              }
            />
          ))}
        </Card>
      ) : null}
      <Title>¿En qué frente?</Title>
      {fronts.map((f) => (
        <BigButton
          key={f.id}
          large
          title={`${f.code} · ${f.name}`}
          subtitle={f.reported_today > 0 ? `✓ ${f.reported_today} registro(s) hoy` : "Sin reporte hoy"}
          variant={f.reported_today > 0 ? "secondary" : "primary"}
          onPress={() => router.push({ pathname: "/registro/[frontId]", params: { frontId: f.id } })}
        />
      ))}
      {/* Lo diario a la vista; lo ocasional, detrás de "Más opciones" */}
      <BigButton title="📋 Parte diario" subtitle="Personal, equipos y lluvia del día" onPress={() => router.push("/parte")} />
      <BigButton title="⚑ Reportar hallazgo" onPress={() => router.push("/hallazgo/nuevo")} />
      <BigButton title={more ? "▲ Menos opciones" : "▼ Más opciones"} onPress={() => setMore(!more)} />
      {more ? (
        <>
          <BigButton title="⌗ Escanear código QR" onPress={() => router.push("/escanear")} />
          <BigButton title="✅ Calidad: NC, punch e inspecciones" subtitle="Funciona sin señal" onPress={() => router.push("/calidad")} />
          <BigButton title="📦 Entregas de material" subtitle="Remisiones recibidas en obra · sin señal" onPress={() => router.push("/entregas")} />
          <BigButton title="🧾 Mis registros y correcciones" onPress={() => router.push("/registros")} />
          <BigButton title="🔔 Avisos" onPress={() => router.push("/avisos")} />
          <BigButton title="🧪 Ensayos y restricciones" subtitle="Requiere señal" onPress={() => router.push("/control")} />
          {role === "admin" ? <BigButton title="⚙ Administrar frentes y actividades" onPress={() => router.push("/admin")} /> : null}
          {projects.length > 1 ? <BigButton title="Cambiar de proyecto" onPress={() => setProjectId("")} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const NAVY = "#0B2547";
const qtyText = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** Indicador del encabezado: número grande y qué significa. */
function Stat({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: 12, padding: 10 }}>
      <Text style={{ color: alert ? "#FCA5A5" : "#FFFFFF", fontSize: 26, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: "#BFDBFE", fontSize: 15 }}>{label}</Text>
    </View>
  );
}
