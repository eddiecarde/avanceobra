import { Camera, GeoJSONSource, ImageSource, Layer, Map, UserLocation } from "@maplibre/maplibre-react-native";
import { addDays } from "@avanceobra/engine";
import { useQuery } from "@powersync/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { polygonFromTaps, rectangleFromTaps } from "../core/drawing";
import { bboxOf, buildElementsGeoJSON, collectCoords, latestPlans, summarize } from "../core/planStatus";
import { reconcile } from "../core/reconcile";
import { rectangleRing, selectInArea } from "../core/selection";
import { todayLocal } from "../services/ids";
import { downloadBaseMap, syncPlans } from "../services/plans";
import { config } from "../services/supabase";
import { planSelection, usePlanSelection } from "../state/draft";
import { useSession } from "../state/session";
import { BigButton, Chips, Row, useBottomInset } from "./components";
import { sizes, useTheme } from "./theme";

type Mode = "view" | "select";
/** tap: tocar uno a uno · rect/poly: marcar todo lo que cae dentro · area: dibujar el área trabajada */
type Tool = "tap" | "rect" | "poly" | "area";
type LonLat = [number, number];

/**
 * Plano georreferenciado.
 *  - Vista: elementos coloreados por avance (gris / amarillo / verde), áreas trabajadas,
 *    hallazgos abiertos en rojo y "reproducción" del avance día a día.
 *  - Selección (desde el registro): tocar elementos uno a uno, o marcar de una vez todo lo que
 *    cae dentro de un rectángulo o polígono (p. ej. 1.000 hincas), agregando o quitando.
 *    Muestra en vivo el cuadre con la cantidad reportada ("faltan 5 por marcar").
 *  - Área trabajada: tocar vértices del área aproximada (o 2 esquinas para un rectángulo).
 */
export function PlanScreen(params: { mode?: "view" | "select"; activityId?: string | null }) {
  const t = useTheme();
  const { projectId } = useSession();
  const selection = usePlanSelection();
  const mode: Mode = params.mode === "select" ? "select" : "view";
  const [tool, setTool] = useState<Tool>("tap");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [taps, setTaps] = useState<LonLat[]>([]);
  const [untilDate, setUntilDate] = useState(todayLocal());
  const [downloading, setDownloading] = useState<number | null>(null);
  const activityFilter = params.activityId ?? null;

  useEffect(() => {
    if (projectId) syncPlans(projectId).catch(() => undefined); // sin señal se usan los ya descargados
  }, [projectId]);

  const { data: elements } = useQuery<{ id: string; code: string; kind: string; qty: number; geojson: string | null }>(
    `SELECT id, code, kind, qty, geojson FROM elements
     WHERE project_id = ? AND (? IS NULL OR activity_id = ? OR activity_id IS NULL)`,
    [projectId ?? "", activityFilter, activityFilter],
  );
  const { data: executed } = useQuery<{ element_id: string; executed: number }>(
    `SELECT ee.element_id, SUM(el.qty) AS executed
     FROM entry_elements ee JOIN progress_entries e ON e.id = ee.entry_id JOIN elements el ON el.id = ee.element_id
     WHERE e.project_id = ? AND e.status IN ('submitted','approved') AND e.work_date <= ?
       AND (? IS NULL OR e.activity_id = ?)
     GROUP BY ee.element_id`,
    [projectId ?? "", untilDate, activityFilter, activityFilter],
  );
  const { data: areas } = useQuery<{ id: string; geojson: string; status: string; work_date: string }>(
    `SELECT a.id, a.geojson, e.status, e.work_date FROM progress_areas a JOIN progress_entries e ON e.id = a.entry_id
     WHERE a.project_id = ? AND e.work_date <= ? AND (? IS NULL OR e.activity_id = ?)`,
    [projectId ?? "", untilDate, activityFilter, activityFilter],
  );
  const { data: findings } = useQuery<{ id: string; lat: number; lon: number; severity: string }>(
    "SELECT id, lat, lon, severity FROM findings WHERE project_id = ? AND status != 'closed' AND lat IS NOT NULL",
    [projectId ?? ""],
  );
  const { data: plans } = useQuery<{ id: string; name: string | null; version: number | null; corners: string | null; local_uri: string | null }>(
    `SELECT s.id, s.name, s.version, s.corners, f.local_uri FROM site_plans s LEFT JOIN plan_files f ON f.id = s.id WHERE s.project_id = ?`,
    [projectId ?? ""],
  );
  // Planos apagados por el usuario (se recuerdan en el teléfono, por proyecto)
  const [hiddenPlans, setHiddenPlans] = useState<string[]>([]);
  const hiddenKey = `avanceobra:planos-ocultos:${projectId ?? ""}`;
  useEffect(() => {
    AsyncStorage.getItem(hiddenKey)
      .then((v) => setHiddenPlans(v ? (JSON.parse(v) as string[]) : []))
      .catch(() => setHiddenPlans([]));
  }, [hiddenKey]);
  const togglePlan = (id: string) =>
    setHiddenPlans((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      AsyncStorage.setItem(hiddenKey, JSON.stringify(next)).catch(() => undefined);
      return next;
    });

  const selected = useMemo(() => new Set(selection.elementIds), [selection.elementIds]);
  const executedMap = useMemo(() => new globalThis.Map(executed.map((r) => [r.element_id, r.executed])), [executed]);
  const markedQty = useMemo(() => elements.reduce((acc, e) => acc + (selected.has(e.id) ? e.qty || 1 : 0), 0), [elements, selected]);
  const alreadyDoneSelected = useMemo(
    () => elements.filter((e) => selected.has(e.id) && (executedMap.get(e.id) ?? 0) >= (e.qty || 1)).length,
    [elements, selected, executedMap],
  );
  const check = reconcile(selection.reportedQty, markedQty, selection.unit || "und");

  const elementsFC = useMemo(
    () => buildElementsGeoJSON(elements, executedMap, mode === "view" ? new Set() : selected),
    [elements, executedMap, selected, mode],
  );
  const counts = summarize(elementsFC);

  const areasFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = areas.flatMap((a) => {
      try {
        return [{ type: "Feature" as const, id: a.id, geometry: JSON.parse(a.geojson), properties: { approved: a.status === "approved" } }];
      } catch {
        return [];
      }
    });
    if (selection.area) features.push({ type: "Feature", geometry: JSON.parse(selection.area.geojson), properties: { draft: true } });
    return { type: "FeatureCollection", features };
  }, [areas, selection.area]);

  const findingsFC = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: findings.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: [f.lon, f.lat] }, properties: { severity: f.severity } })),
    }),
    [findings],
  );

  /** Figura que se está dibujando (rectángulo, polígono o área), en azul. */
  const draftFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = taps.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    const ring = tool === "rect" && taps.length >= 2 ? rectangleRing(taps[0]!, taps[1]!) : polygonFromTaps(taps)?.geojson.coordinates[0];
    if (ring && ring.length >= 4) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
    return { type: "FeatureCollection", features };
  }, [taps, tool]);

  // Solo la última versión de cada plano; las anteriores no se dibujan encima
  const availablePlans = useMemo(() => latestPlans(plans.filter((p) => p.local_uri && p.corners)), [plans]);
  const planImages = useMemo(
    () =>
      availablePlans
        .filter((p) => !hiddenPlans.includes(p.id))
        .map((p) => ({ id: p.id, uri: p.local_uri!, corners: JSON.parse(p.corners!) as [LonLat, LonLat, LonLat, LonLat] })),
    [availablePlans, hiddenPlans],
  );

  const bounds = useMemo(() => {
    const coords = [...elementsFC.features.flatMap((f) => collectCoords(f.geometry)), ...planImages.flatMap((p) => p.corners)];
    return bboxOf(coords);
  }, [elementsFC, planImages]);

  function finishDrawing(rect = false) {
    const area = rect && taps.length >= 2 ? rectangleFromTaps(taps[0]!, taps[1]!) : polygonFromTaps(taps);
    if (!area) return Alert.alert("Faltan puntos", "Toca al menos 3 vértices del área trabajada (o 2 esquinas para rectángulo).");
    planSelection.setArea({ geojson: JSON.stringify(area.geojson), areaM2: area.areaM2 });
    setTaps([]);
    setTool("tap");
  }

  /** Marca (o desmarca) de una vez todo lo que cae dentro del rectángulo o polígono. */
  function applyAreaSelection() {
    const ring = tool === "rect" ? (taps.length >= 2 ? rectangleRing(taps[0]!, taps[1]!) : null) : taps.length >= 3 ? taps : null;
    if (!ring) return Alert.alert("Faltan puntos", tool === "rect" ? "Toca 2 esquinas opuestas." : "Toca al menos 3 vértices.");
    const r = selectInArea(
      elements.map((e) => ({ id: e.id, qty: e.qty, geojson: e.geojson, executed: executedMap.get(e.id) ?? 0 })),
      selection.elementIds,
      ring,
      action,
    );
    planSelection.setElements(r.ids);
    setTaps([]);
    Alert.alert(
      `${action === "add" ? "Se marcaron" : "Se quitaron"} ${r.changed.toLocaleString("es-CO")} elementos`,
      r.skippedExecuted > 0
        ? `${r.skippedExecuted.toLocaleString("es-CO")} dentro del área ya estaban ejecutados y no se volvieron a marcar.`
        : `Total marcados: ${r.ids.length.toLocaleString("es-CO")}.`,
    );
  }

  async function cacheBaseMap() {
    if (!bounds) return Alert.alert("Sin zona", "El proyecto no tiene elementos ni planos georreferenciados.");
    setDownloading(0);
    try {
      await downloadBaseMap(`proyecto-${projectId}`, bounds, (p) => setDownloading(Math.round(p)));
      Alert.alert("✓ Mapa descargado", "La zona del proyecto queda disponible sin señal.");
    } catch (e) {
      Alert.alert("No se pudo descargar", String((e as Error).message ?? e));
    } finally {
      setDownloading(null);
    }
  }

  const checkColor = check.state === "match" ? t.success : check.state === "no_quantity" ? t.text : t.warning;
  const bottomInset = useBottomInset();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={config.mapStyleUrl}
        onPress={(e) => {
          if (mode === "select" && tool !== "tap") {
            const { lngLat } = e.nativeEvent;
            setTaps((ts) => (tool === "rect" && ts.length >= 2 ? [[lngLat[0], lngLat[1]]] : [...ts, [lngLat[0], lngLat[1]]]));
          }
        }}
      >
        {/* Se vuelve a montar cuando se conoce la zona, porque la vista inicial solo se aplica al montar */}
        <Camera
          key={bounds ? "zona" : "sin-zona"}
          initialViewState={bounds ? { bounds, padding: { top: 40, bottom: 40, left: 40, right: 40 } } : { zoom: 15 }}
        />
        <UserLocation />

        {planImages.map((p) => (
          <ImageSource key={p.id} id={`plan-${p.id}`} url={p.uri} coordinates={p.corners}>
            <Layer type="raster" id={`plan-layer-${p.id}`} paint={{ "raster-opacity": 0.85 }} />
          </ImageSource>
        ))}

        <GeoJSONSource id="areas" data={areasFC}>
          <Layer
            type="fill"
            id="areas-fill"
            paint={{
              "fill-color": ["case", ["has", "draft"], "#2563EB", ["get", "approved"], "#16A34A", "#F59E0B"],
              "fill-opacity": 0.35,
            }}
          />
          <Layer type="line" id="areas-line" paint={{ "line-color": "#111827", "line-width": 1.5 }} />
        </GeoJSONSource>

        <GeoJSONSource
          id="elements"
          data={elementsFC}
          onPress={(e) => {
            if (mode !== "select" || tool !== "tap") return;
            const f = e.nativeEvent.features[0];
            const id = f?.properties?.id as string | undefined;
            if (id) planSelection.toggleElement(id);
          }}
        >
          <Layer
            type="fill"
            id="elements-fill"
            filter={["==", ["geometry-type"], "Polygon"]}
            paint={{ "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.9, 0.6] }}
          />
          <Layer
            type="line"
            id="elements-outline"
            filter={["==", ["geometry-type"], "Polygon"]}
            paint={{
              "line-color": ["case", ["get", "selected"], "#2563EB", ["get", "hasFinding"], "#DC2626", "#111827"],
              "line-width": ["case", ["get", "selected"], 3, 1],
            }}
          />
          <Layer
            type="circle"
            id="elements-points"
            filter={["==", ["geometry-type"], "Point"]}
            paint={{
              "circle-color": ["case", ["get", "selected"], "#2563EB", ["get", "color"]],
              "circle-radius": ["case", ["get", "selected"], 8, 6],
              "circle-stroke-color": ["case", ["get", "selected"], "#FFFFFF", "#111827"],
              "circle-stroke-width": ["case", ["get", "selected"], 2, 1],
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="findings" data={findingsFC}>
          <Layer
            type="circle"
            id="findings-circle"
            paint={{ "circle-color": "#DC2626", "circle-radius": 8, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="draft" data={draftFC}>
          <Layer
            type="fill"
            id="draft-fill"
            filter={["==", ["geometry-type"], "Polygon"]}
            paint={{ "fill-color": action === "remove" && tool !== "area" ? "#DC2626" : "#2563EB", "fill-opacity": 0.25 }}
          />
          <Layer type="circle" id="draft-pts" filter={["==", ["geometry-type"], "Point"]} paint={{ "circle-color": "#2563EB", "circle-radius": 7 }} />
        </GeoJSONSource>
      </Map>

      {/* Selector de planos sobre el mapa: prender o apagar cada uno */}
      {availablePlans.length ? (
        <ScrollView
          horizontal
          style={{ position: "absolute", top: 8, left: 0, right: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 8 }}
          showsHorizontalScrollIndicator={false}
        >
          {availablePlans.map((p) => {
            const on = !hiddenPlans.includes(p.id);
            return (
              <Pressable
                key={p.id}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Plano ${p.name ?? ""}`}
                onPress={() => togglePlan(p.id)}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 14,
                  justifyContent: "center",
                  borderRadius: 22,
                  borderWidth: 2,
                  borderColor: on ? t.primary : t.border,
                  backgroundColor: on ? t.primary : t.bg,
                  opacity: 0.95,
                }}
              >
                <Text style={{ color: on ? t.primaryText : t.text, fontSize: 15, fontWeight: "700" }}>
                  {`${on ? "✓" : "○"} ${p.name ?? "Plano"}${p.version && p.version > 1 ? ` · v${p.version}` : ""}`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={{ padding: sizes.pad, paddingBottom: sizes.pad + bottomInset, gap: 8, backgroundColor: t.bg }}>
        {mode === "view" ? (
          <>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>
              ● Sin iniciar {counts.not_started}  ● En proceso {counts.in_progress}  ● Terminado {counts.done}
              {findings.length ? `  ● Hallazgos ${findings.length}` : ""}
            </Text>
            <Row>
              <BigButton title="◀" onPress={() => setUntilDate(addDays(untilDate, -1))} style={{ width: 72 }} />
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: "800" }}>Avance hasta {untilDate}</Text>
              </View>
              <BigButton title="▶" disabled={untilDate >= todayLocal()} onPress={() => setUntilDate(addDays(untilDate, 1))} style={{ width: 72 }} />
            </Row>
            <BigButton
              title={downloading !== null ? `Descargando mapa… ${downloading} %` : "⤓ Descargar mapa de la zona (offline)"}
              loading={downloading !== null}
              onPress={cacheBaseMap}
            />
          </>
        ) : (
          <>
            <Text style={{ color: check.message ? checkColor : t.text, fontSize: 17, fontWeight: "800" }}>
              {check.message ||
                `${selection.reportedQty !== null ? `Reportaste ${selection.reportedQty}. ` : ""}Marca en el plano lo ejecutado.`}
            </Text>
            <Text style={{ color: t.muted, fontSize: 15 }}>
              {`${selection.elementIds.length.toLocaleString("es-CO")} marcados`}
              {alreadyDoneSelected ? ` · ⚠ ${alreadyDoneSelected} ya estaban ejecutados` : ""}
              {selection.area ? ` · área ≈ ${Math.round(selection.area.areaM2).toLocaleString("es-CO")} m²` : ""}
            </Text>
            <Chips
              options={[
                { value: "tap", label: "☝ Tocar" },
                { value: "rect", label: "▭ Rectángulo" },
                { value: "poly", label: "⬠ Polígono" },
                { value: "area", label: "✎ Área trabajada" },
              ]}
              value={tool}
              onChange={(v) => {
                setTool(v);
                setTaps([]);
              }}
            />
            {tool === "rect" || tool === "poly" ? (
              <>
                <Chips
                  options={[
                    { value: "add", label: "＋ Agregar" },
                    { value: "remove", label: "－ Quitar" },
                  ]}
                  value={action}
                  onChange={setAction}
                />
                <Text style={{ color: t.text, fontSize: 16 }}>
                  {tool === "rect" ? `Toca 2 esquinas opuestas (${Math.min(taps.length, 2)}/2)` : `Toca los vértices del contorno (${taps.length})`}
                </Text>
                <Row>
                  <BigButton title="↶" disabled={taps.length === 0} onPress={() => setTaps((ts) => ts.slice(0, -1))} style={{ width: 72 }} />
                  <BigButton
                    title={action === "add" ? "Marcar lo de adentro" : "Quitar lo de adentro"}
                    variant={action === "add" ? "primary" : "danger"}
                    disabled={tool === "rect" ? taps.length < 2 : taps.length < 3}
                    onPress={applyAreaSelection}
                    style={{ flex: 1 }}
                  />
                </Row>
              </>
            ) : tool === "area" ? (
              <>
                <Text style={{ color: t.text, fontSize: 16 }}>Toca los vértices del área trabajada ({taps.length} puntos)</Text>
                <Row>
                  <BigButton title="↶" disabled={taps.length === 0} onPress={() => setTaps((ts) => ts.slice(0, -1))} style={{ width: 72 }} />
                  <BigButton title="▭ Rectángulo" disabled={taps.length < 2} onPress={() => finishDrawing(true)} style={{ flex: 1 }} />
                  <BigButton title="✓ Usar" variant="primary" disabled={taps.length < 3} onPress={() => finishDrawing()} style={{ flex: 1 }} />
                </Row>
              </>
            ) : (
              <Row>
                <BigButton
                  title="Limpiar"
                  disabled={selection.elementIds.length === 0 && !selection.area}
                  onPress={() =>
                    Alert.alert("Limpiar selección", "¿Quitar todos los elementos marcados y el área?", [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Limpiar",
                        style: "destructive",
                        onPress: () => {
                          planSelection.setElements([]);
                          planSelection.setArea(null);
                        },
                      },
                    ])
                  }
                  style={{ flex: 1 }}
                />
                <BigButton title="✓ Listo" variant="primary" onPress={() => router.back()} style={{ flex: 1 }} />
              </Row>
            )}
          </>
        )}
      </View>
    </View>
  );
}
