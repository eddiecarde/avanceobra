"use client";

import { fitAffine, imageCorners, pointResiduals, type LonLat } from "@avanceobra/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnchorMap } from "@/components/plans/AnchorMap";
import { ComparePlans, type ComparablePlan } from "@/components/plans/ComparePlans";
import { DxfImport } from "@/components/plans/DxfImport";
import { Badge, Button, Card, cx, Field, Input, Select } from "@/components/ui";
import { CRS, guessCrs, toLonLat, type CrsCode } from "@/lib/crs";
import { isGeoreferenced, quadToLonLat, readGeoreferenced, type GeoPlan } from "@/lib/georefFiles";
import { planImageFrom, type PlanImage } from "@/lib/plans";
import { useCurrentProject, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface SavedPlan {
  id: string;
  name: string;
  version: number;
  source_format: string;
  storage_path: string;
  corners: unknown;
  company_id: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface Company {
  id: string;
  name: string;
  kind: "contratista" | "subcontratista";
}

interface Pt {
  px?: [number, number];
  /** Puede quedar a medias (NaN) mientras se escribe a mano. */
  geo?: LonLat;
}

const hasGeo = (p: Pt) => !!p.geo && Number.isFinite(p.geo[0]) && Number.isFinite(p.geo[1]);
const isDone = (p: Pt): p is Required<Pt> => !!p.px && hasGeo(p);

type FC = GeoJSON.FeatureCollection;

const mb = (n: number | null) => (n == null ? "—" : `${(n / 1_048_576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`);
/** "4,6012" o "4.6012" → número; vacío o inválido → null. */
const coord = (s: string) => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};

/** Límites de una colección GeoJSON (para encuadrar el mapa en la obra). */
function bounds(fc: FC): [LonLat, LonLat] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      x0 = Math.min(x0, c[0] as number); x1 = Math.max(x1, c[0] as number);
      y0 = Math.min(y0, c[1] as number); y1 = Math.max(y1, c[1] as number);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  fc.features.forEach((f) => "coordinates" in f.geometry && visit(f.geometry.coordinates));
  return Number.isFinite(x0) ? [[x0, y0], [x1, y1]] : null;
}

const SOURCE_LABEL: Record<GeoPlan["source"], string> = {
  geotiff: "GeoTIFF",
  kml: "Google Earth (KMZ/KML)",
  worldfile: "Imagen con archivo de mundo",
  geopdf: "PDF georreferenciado",
};

/**
 * Planos del proyecto: se sube el PDF (o una imagen), se ancla al mapa con 3 o más puntos que se
 * reconozcan en el plano y en el satélite, y queda disponible en los teléfonos para marcar avance.
 * Si el archivo ya trae su ubicación (PDF georreferenciado, GeoTIFF, KMZ/KML, archivo de mundo) no
 * hace falta anclarlo. Cada plano es general o de una empresa: las demás empresas no lo ven.
 */
export default function Planos() {
  const { memberships, session } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const role = memberships.find((m) => m.project_id === projectId)?.role;
  const isAdmin = role === "admin";
  const [companies, setCompanies] = useState<Company[]>([]);
  const [myCompany, setMyCompany] = useState<string | null>(null);
  // El administrador sube para cualquier empresa; director y residente, solo para la suya
  const canUpload = isAdmin || ((role === "director" || role === "resident") && !!myCompany);
  const [planCompany, setPlanCompany] = useState("");
  const [filter, setFilter] = useState("todas");
  const [plans, setPlans] = useState<{ projectId: string; rows: SavedPlan[] } | null>(null);
  const [reference, setReference] = useState<FC>({ type: "FeatureCollection", features: [] });
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);

  // Plano en edición
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [img, setImg] = useState<PlanImage | null>(null);
  // Plano georreferenciado: esquinas leídas del archivo y su sistema de coordenadas
  const [geo, setGeo] = useState<GeoPlan | null>(null);
  const [geoCrs, setGeoCrs] = useState<CrsCode | null>(null);
  const [name, setName] = useState("");
  const [points, setPoints] = useState<Pt[]>([]);
  const [zoom, setZoom] = useState(0.25);
  const [opacity, setOpacity] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [goTo, setGoTo] = useState("");
  const [focus, setFocus] = useState<{ center: LonLat; zoom: number } | [LonLat, LonLat] | null>(null);
  const planBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void Promise.all([
      supabase
        .from("site_plans")
        .select("id, name, version, source_format, storage_path, corners, company_id, size_bytes, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("elements").select("geojson").eq("project_id", projectId).not("geojson", "is", null).limit(5000),
      supabase.from("project_companies").select("id, name, kind").eq("project_id", projectId).order("kind").order("name"),
      supabase.from("memberships").select("company_id").eq("project_id", projectId).eq("user_id", session?.user.id ?? "").maybeSingle(),
    ]).then(([p, e, c, me]) => {
      if (off) return;
      setPlans({ projectId, rows: (p.data ?? []) as SavedPlan[] });
      setCompanies((c.data ?? []) as Company[]);
      setMyCompany((me.data?.company_id as string | null) ?? null);
      const fc: FC = {
        type: "FeatureCollection",
        features: (e.data ?? []).flatMap((x: { geojson: string | null }) => {
          try {
            return x.geojson ? [{ type: "Feature" as const, geometry: JSON.parse(x.geojson) as GeoJSON.Geometry, properties: {} }] : [];
          } catch {
            return [];
          }
        }),
      };
      setReference(fc);
      const b = bounds(fc);
      if (b) setFocus(b);
    });
    return () => {
      off = true;
    };
  }, [projectId, version, session?.user.id]);

  // Imagen del plano a partir del archivo (y de la página, si el PDF tiene varias)
  useEffect(() => {
    if (!file) return;
    let off = false;
    setMsg({ tone: "info", text: "Convirtiendo el plano…" });
    planImageFrom(file, page).then(
      (r) => {
        if (off) return URL.revokeObjectURL(r.url);
        setImg((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return r;
        });
        setZoom(Math.min(1, 900 / r.width));
        setMsg(null);
        if (r.geoPoints && r.geoPoints.length >= 3) {
          try {
            const c = imageCorners(fitAffine(r.geoPoints), r.width, r.height);
            setGeo({ image: r, quad: c, crs: "EPSG:4326", source: "geopdf", detail: `${r.geoPoints.length} puntos de georreferencia${r.geoEpsg ? ` · EPSG:${r.geoEpsg}` : ""}` });
            setGeoCrs("EPSG:4326");
            setFocus([[Math.min(...c.map((x) => x[0])), Math.min(...c.map((x) => x[1]))], [Math.max(...c.map((x) => x[0])), Math.max(...c.map((x) => x[1]))]]);
          } catch {
            setGeo(null);
          }
        } else setGeo(null);
      },
      (e: Error) => !off && setMsg({ tone: "error", text: e.message }),
    );
    return () => {
      off = true;
    };
  }, [file, page]);

  const complete = points.filter(isDone);
  const fit = useMemo(() => {
    if (complete.length < 3) return null;
    try {
      const t = fitAffine(complete);
      return { t, residuals: pointResiduals(t, complete), error: null as string | null };
    } catch (e) {
      return { t: null, residuals: [], error: (e as Error).message };
    }
  }, [complete]);
  const geoCorners = useMemo(() => {
    if (!geo || !geoCrs) return null;
    const c = quadToLonLat(geo.quad, toLonLat(geoCrs));
    return c.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) ? c : null;
  }, [geo, geoCrs]);
  const corners = geo ? geoCorners : fit?.t && img ? imageCorners(fit.t, img.width, img.height) : null;
  // Un plano que cae fuera de Colombia casi siempre es un sistema de coordenadas mal elegido
  const outside = !!geoCorners && geoCorners.some(([x, y]) => x < -82 || x > -66 || y < -4.5 || y > 13.6);
  // Punto que se está marcando: el último si le falta algo; si no, uno nuevo
  const activeIdx = points.length && !isDone(points.at(-1)!) ? points.length - 1 : points.length;

  const setActive = (patch: Pt) =>
    setPoints((ps) => {
      const i = ps.length && !isDone(ps.at(-1)!) ? ps.length - 1 : ps.length;
      const next = [...ps];
      next[i] = { ...next[i], ...patch };
      return next;
    });

  function onPlanClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!img) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * img.width;
    const y = ((e.clientY - r.top) / r.height) * img.height;
    setActive({ px: [Math.round(x), Math.round(y)] });
  }

  function reset() {
    if (img) URL.revokeObjectURL(img.url);
    setImg(null);
    setGeo(null);
    setGeoCrs(null);
    setFile(null);
    setPoints([]);
    setName("");
    setPage(1);
  }

  async function save() {
    if (!img || !corners) return;
    const label = name.trim();
    if (label.length < 2) return setMsg({ tone: "error", text: "Ponle un nombre al plano (p. ej. Layout general)." });
    setBusy(true);
    setMsg({ tone: "info", text: "Subiendo el plano…" });
    try {
      const path = `${projectId}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("plans").upload(path, img.blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const same = (plans?.rows ?? []).filter((p) => p.name.toLowerCase() === label.toLowerCase());
      const { error } = await supabase.from("site_plans").insert({
        project_id: projectId,
        name: label,
        version: same.reduce((v, p) => Math.max(v, p.version), 0) + 1,
        storage_path: path,
        source_format: geo ? (geo.source === "worldfile" ? img.format : geo.source === "geopdf" ? "pdf" : geo.source) : img.format,
        corners,
        control_points: geo ? null : complete,
        company_id: isAdmin ? planCompany || null : myCompany,
        size_bytes: img.blob.size,
      });
      if (error) throw error;
      setMsg({ tone: "ok", text: `Plano "${label}" guardado. Los teléfonos lo descargan al abrir la pestaña Plano con señal.` });
      reset();
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ tone: "error", text: `No se pudo guardar: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: SavedPlan) {
    if (!window.confirm(`¿Quitar el plano "${p.name}" (versión ${p.version})? Los teléfonos dejarán de mostrarlo.`)) return;
    const { error } = await supabase.from("site_plans").delete().eq("id", p.id);
    setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: `Plano "${p.name}" quitado.` });
    setVersion((v) => v + 1);
  }

  function go() {
    const [a, b] = goTo.split(/[;\s]+|,\s+/).map(coord);
    // Se escribe "latitud, longitud", como lo da Google Maps
    if (a == null || b == null || Math.abs(a) > 90) return setMsg({ tone: "error", text: "Escribe latitud y longitud, por ejemplo: 10.4567, -74.6543" });
    setFocus({ center: [b, a], zoom: 16 });
  }

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;
  const allRows = plans?.projectId === projectId ? plans.rows : [];
  const rows = allRows.filter((p) => filter === "todas" || (filter === "general" ? !p.company_id : p.company_id === filter));
  const companyOf = (id: string | null) => companies.find((c) => c.id === id);
  const canRemove = (p: SavedPlan) => isAdmin || ((role === "director" || role === "resident") && !!p.company_id && p.company_id === myCompany);
  const comparable: ComparablePlan[] = allRows.flatMap((p) =>
    Array.isArray(p.corners) && p.corners.length === 4
      ? [{ id: p.id, label: `${p.name} v${p.version} · ${companyOf(p.company_id)?.name ?? "General"}`, storage_path: p.storage_path, corners: p.corners as ComparablePlan["corners"] }]
      : [],
  );
  // Dónde queda la obra (para adivinar el sistema de coordenadas del DXF)
  const refBounds = bounds(reference);
  const anchored = allRows.find((p) => Array.isArray(p.corners))?.corners as LonLat[] | undefined;
  const near: LonLat | null = refBounds
    ? [(refBounds[0][0] + refBounds[1][0]) / 2, (refBounds[0][1] + refBounds[1][1]) / 2]
    : anchored
      ? [anchored.reduce((t, c) => t + c[0], 0) / anchored.length, anchored.reduce((t, c) => t + c[1], 0) / anchored.length]
      : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Planos</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Sube el plano (PDF, imagen o archivo georreferenciado) y ubícalo en el mapa: así se ve en el teléfono, sin señal, para marcar el avance.
          </p>
        </div>
        {projects.length > 1 ? (
          <Field label="Proyecto">
            <Select value={projectId} onChange={(e) => setPicked(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {msg ? (
        <p
          role={msg.tone === "error" ? "alert" : "status"}
          className={cx(
            "rounded-lg px-4 py-2 font-semibold",
            msg.tone === "ok" && "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200",
            msg.tone === "error" && "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200",
            msg.tone === "info" && "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
          )}
        >
          {msg.text}
        </p>
      ) : null}

      {!img ? (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <h2 className="mr-auto text-lg font-bold">Planos cargados</h2>
            {companies.length ? (
              <Field label="Empresa">
                <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por empresa">
                  <option value="todas">Todas las que puedo ver</option>
                  <option value="general">Generales del proyecto</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] text-left">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-2">Plano</th>
                    <th className="pr-2">Empresa</th>
                    <th className="pr-2">Versión</th>
                    <th className="pr-2">Origen</th>
                    <th className="pr-2">Tamaño</th>
                    <th className="pr-2">Cargado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-2 font-semibold">
                        {p.name} {p.corners ? null : <Badge tone="amber">Sin anclar</Badge>}
                      </td>
                      <td className="pr-2">
                        {companyOf(p.company_id) ? (
                          <>
                            <Badge tone={companyOf(p.company_id)!.kind === "contratista" ? "blue" : "neutral"}>
                              {companyOf(p.company_id)!.kind === "contratista" ? "Contratista" : "Subcontratista"}
                            </Badge>{" "}
                            {companyOf(p.company_id)!.name}
                          </>
                        ) : (
                          <span className="text-zinc-500">General</span>
                        )}
                      </td>
                      <td className="pr-2 tabular-nums">{p.version}</td>
                      <td className="pr-2 uppercase">{p.source_format}</td>
                      <td className="pr-2 tabular-nums">{mb(p.size_bytes)}</td>
                      <td className="pr-2 tabular-nums">{new Date(p.created_at).toLocaleDateString("es-CO")}</td>
                      <td className="py-2 text-right">
                        {canRemove(p) ? (
                          <Button size="sm" variant="ghost" onClick={() => void remove(p)}>
                            Quitar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-zinc-500">{allRows.length ? "Ningún plano con este filtro." : "Todavía no hay planos que puedas ver en este proyecto."}</p>
          )}
          {canUpload ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              {isAdmin ? (
                <Field label="Empresa del plano" hint="(quién lo puede ver)">
                  <Select value={planCompany} onChange={(e) => setPlanCompany(e.target.value)}>
                    <option value="">General: todo el proyecto</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.kind})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Los planos que subas quedan a nombre de <b>{companyOf(myCompany)?.name}</b>: los ven tu empresa, el contratista principal y el administrador.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              {role === "director" || role === "resident"
                ? "Para subir planos, pide al administrador que te asigne a tu empresa en Equipo."
                : "Los planos los suben el administrador y el director o residente de cada empresa."}
            </p>
          )}
          {canUpload ? (
          <label className="mt-4 flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 p-6 text-center hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
            <span className="font-bold">Subir plano</span>
            <span className="text-sm text-zinc-500">
              PDF, PNG o JPG: se ancla con puntos (si el PDF viene georreferenciado desde ArcGIS, QGIS o AutoCAD Map, se ubica solo). GeoTIFF, KMZ/KML de Google Earth o
              imagen con su archivo de mundo (.pgw, .jgw, y el .prj si lo tienes, todos juntos): ya traen su ubicación. Si lo tienes en DWG, guárdalo como PDF desde AutoCAD.
            </span>
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/tiff,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.kml,.kmz,.pgw,.jgw,.pngw,.jpgw,.tfw,.wld,.prj"
              className="sr-only"
              aria-label="Archivo del plano"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (!files.length) return;
                const main = files.find((f) => !/\.(pgw|jgw|pngw|jpgw|tfw|wld|prj)$/i.test(f.name)) ?? files[0]!;
                setName(main.name.replace(/\.[^.]+$/, ""));
                setPoints([]);
                setPage(1);
                if (!isGeoreferenced(files)) return setFile(main);
                setMsg({ tone: "info", text: "Leyendo la ubicación del plano…" });
                readGeoreferenced(files).then(
                  (g) => {
                    const crs = g.crs ?? guessCrs(g.quad[0], near);
                    setGeo(g);
                    setGeoCrs(crs);
                    setImg(g.image);
                    setMsg(crs ? null : { tone: "error", text: "No se reconoce el sistema de coordenadas del archivo: elígelo en la lista." });
                    const c = crs ? quadToLonLat(g.quad, toLonLat(crs)) : null;
                    if (c) setFocus([[Math.min(...c.map((x) => x[0])), Math.min(...c.map((x) => x[1]))], [Math.max(...c.map((x) => x[0])), Math.max(...c.map((x) => x[1]))]]);
                  },
                  (err: Error) => setMsg({ tone: "error", text: err.message }),
                );
              }}
            />
          </label>
          ) : null}
        </Card>
      ) : null}

      {!img && comparable.length >= 2 ? <ComparePlans plans={comparable} reference={reference} /> : null}

      {!img && isAdmin ? (
        <DxfImport
          projectId={projectId}
          near={near}
          onDone={(text) => {
            setMsg({ tone: "ok", text });
            setVersion((v) => v + 1);
          }}
        />
      ) : !img ? null : (
        <>
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Nombre del plano" className="min-w-64 flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Layout general" />
              </Field>
              {img.pages > 1 ? (
                <Field label={`Página (de ${img.pages})`}>
                  <Select value={page} onChange={(e) => setPage(Number(e.target.value))}>
                    {Array.from({ length: img.pages }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <span className="pb-2 text-sm text-zinc-500 tabular-nums">
                {img.width} × {img.height} px · {mb(img.blob.size)}
              </span>
              <Button variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
            {geo ? null : (
            <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              <li>Busca un punto que reconozcas en los dos lados: una esquina del cerramiento, la subestación, un cruce de vías.</li>
              <li>Tócalo en el plano (izquierda) y luego en el satélite (derecha). Si tienes sus coordenadas medidas, escríbelas en la tabla.</li>
              <li>Repite con 3 o 4 puntos bien separados, cerca de las esquinas de la obra. Con 4 o más se detecta un punto mal marcado.</li>
            </ol>
            )}
          </Card>

          {geo ? (
            <Card>
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                  <h2 className="font-bold">Ubicación leída del archivo · {SOURCE_LABEL[geo.source]}</h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{geo.detail}. Revisa que el plano caiga sobre la obra en el satélite.</p>
                </div>
                {geo.source !== "kml" && geo.source !== "geopdf" ? (
                  <Field label="Sistema de coordenadas">
                    <Select value={geoCrs ?? ""} onChange={(e) => setGeoCrs((e.target.value || null) as CrsCode | null)}>
                      <option value="">Elegir…</option>
                      {CRS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
              <AnchorMap points={[]} reference={reference} overlays={corners ? [{ id: "nuevo", url: img.url, corners, opacity }] : []} focus={focus} onPick={() => undefined} />
              {corners ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  Transparencia del plano
                  <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-blue-700" />
                </label>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={busy || !corners} onClick={() => void save()}>
                  {busy ? "Guardando…" : "Guardar plano"}
                </Button>
                {outside ? (
                  <span className="font-semibold text-red-700 dark:text-red-400">El plano queda fuera de Colombia: elige otro sistema de coordenadas.</span>
                ) : corners ? (
                  <span className="font-semibold text-green-700 dark:text-green-400">Ubicado sin puntos de control.</span>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setGeo(null);
                    setGeoCrs(null);
                  }}
                >
                  Prefiero anclarlo con puntos
                </Button>
              </div>
            </Card>
          ) : (
          <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto font-bold">Plano · toca el punto {activeIdx + 1}</h2>
                <Button size="sm" onClick={() => setZoom((z) => Math.max(0.05, z / 1.5))} aria-label="Alejar plano">
                  −
                </Button>
                <span className="w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)} %</span>
                <Button size="sm" onClick={() => setZoom((z) => Math.min(3, z * 1.5))} aria-label="Acercar plano">
                  +
                </Button>
              </div>
              <div ref={planBox} className="h-[60vh] min-h-[360px] overflow-auto rounded-lg border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900">
                <div className="relative cursor-crosshair" style={{ width: img.width * zoom, height: img.height * zoom }} onClick={onPlanClick} data-testid="plano-imagen">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Plano ${name}`} width={img.width * zoom} height={img.height * zoom} draggable={false} className="select-none" />
                  {points.map((p, i) =>
                    p.px ? (
                      <span
                        key={i}
                        className={cx(
                          "pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow",
                          i === activeIdx ? "bg-red-600" : "bg-blue-700",
                        )}
                        style={{ left: p.px[0] * zoom, top: p.px[1] * zoom }}
                      >
                        {i + 1}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto font-bold">Satélite · toca el mismo punto</h2>
                <Input value={goTo} onChange={(e) => setGoTo(e.target.value)} placeholder="Ir a: latitud, longitud" className="w-56 py-1" aria-label="Ir a coordenadas" />
                <Button size="sm" onClick={go}>
                  Ir
                </Button>
              </div>
              <AnchorMap
                points={points.flatMap((p, i) => (hasGeo(p) ? [{ n: i + 1, geo: p.geo!, active: i === activeIdx }] : []))}
                reference={reference}
                overlays={corners ? [{ id: "nuevo", url: img.url, corners, opacity }] : []}
                focus={focus}
                onPick={(geo) => setActive({ geo })}
              />
              {corners ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  Transparencia del plano
                  <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-blue-700" />
                </label>
              ) : null}
            </Card>
          </div>

          <Card>
            <h2 className="mb-2 font-bold">Puntos de control</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-1.5 pr-2">#</th>
                    <th className="pr-2">En el plano (px)</th>
                    <th className="pr-2">Latitud</th>
                    <th className="pr-2">Longitud</th>
                    <th className="pr-2 text-right">Error</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...points, ...(activeIdx === points.length ? [{} as Pt] : [])].map((p, i) => {
                    const ci = complete.indexOf(p as Required<Pt>);
                    const err = ci >= 0 ? fit?.residuals[ci] : undefined;
                    const setGeo = (k: 0 | 1, v: string) => {
                      const n = coord(v);
                      setPoints((ps) => {
                        const next = [...ps];
                        const cur = next[i] ?? {};
                        const g = [...(cur.geo ?? [NaN, NaN])] as LonLat;
                        g[k] = n ?? NaN;
                        next[i] = { ...cur, geo: g };
                        return next;
                      });
                    };
                    return (
                      <tr key={i} className={cx("border-b border-zinc-100 dark:border-zinc-800", i === activeIdx && "bg-red-50/60 dark:bg-red-950/30")}>
                        <td className="py-1.5 pr-2 font-bold">{i + 1}</td>
                        <td className="pr-2 tabular-nums">{p.px ? `${p.px[0]}, ${p.px[1]}` : <span className="text-zinc-500">toca el plano</span>}</td>
                        <td className="pr-2">
                          <Input
                            className="w-36 py-1"
                            aria-label={`Latitud del punto ${i + 1}`}
                            defaultValue={p.geo && Number.isFinite(p.geo[1]) ? p.geo[1].toFixed(7) : ""}
                            key={`lat-${i}-${p.geo?.[1]}`}
                            onBlur={(e) => setGeo(1, e.target.value)}
                            placeholder="toca el satélite"
                          />
                        </td>
                        <td className="pr-2">
                          <Input
                            className="w-36 py-1"
                            aria-label={`Longitud del punto ${i + 1}`}
                            defaultValue={p.geo && Number.isFinite(p.geo[0]) ? p.geo[0].toFixed(7) : ""}
                            key={`lon-${i}-${p.geo?.[0]}`}
                            onBlur={(e) => setGeo(0, e.target.value)}
                          />
                        </td>
                        <td className={cx("pr-2 text-right tabular-nums", err != null && err > 5 && "font-bold text-red-700 dark:text-red-400")}>
                          {err == null ? "—" : `${err.toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`}
                        </td>
                        <td className="text-right">
                          {i < points.length ? (
                            <Button size="sm" variant="ghost" onClick={() => setPoints((ps) => ps.filter((_, j) => j !== i))} aria-label={`Borrar punto ${i + 1}`}>
                              Borrar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={busy || !corners} onClick={() => void save()}>
                {busy ? "Guardando…" : "Guardar plano"}
              </Button>
              {fit?.error ? (
                <span className="font-semibold text-red-700 dark:text-red-400">{fit.error}</span>
              ) : fit?.t ? (
                <span className={cx("font-semibold", fit.t.rmseMeters > 5 || complete.length === 3 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400")}>
                  Error medio {fit.t.rmseMeters.toLocaleString("es-CO", { maximumFractionDigits: 1 })} m
                  {complete.length === 3
                    ? ": con 3 puntos el ajuste siempre cuadra; revisa la vista previa en el satélite o agrega un 4.º punto para comprobarlo"
                    : fit.t.rmseMeters > 5
                      ? ": revisa el punto con más error o agrega otro"
                      : ": el plano queda bien ubicado"}
                </span>
              ) : (
                <span className="text-zinc-500">Faltan {3 - complete.length} punto(s) completos para ubicar el plano.</span>
              )}
            </div>
          </Card>
          </>
          )}
        </>
      )}
    </div>
  );
}
