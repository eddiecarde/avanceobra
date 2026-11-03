"use client";

import { useEffect, useMemo, useState } from "react";
import type { Go } from "./FieldApp";
import { chip, fieldInput, QueueStatus } from "./FieldKit";
import { bogota, useCatalog, deviceId, enqueue, getFix, newId, photoToJpeg, type Fix, type QueuedPhoto } from "@/lib/field";
import { useCurrentProject, useSession } from "@/lib/session";

const WEATHER = [
  ["sunny", "☀️ Soleado"],
  ["cloudy", "☁️ Nublado"],
  ["light_rain", "🌦 Llovizna"],
  ["heavy_rain", "🌧 Lluvia"],
  ["storm", "⛈ Tormenta"],
] as const;
const CAUSES = [
  ["weather", "Clima"],
  ["material", "Material"],
  ["equipment", "Equipo"],
  ["permits", "Permisos"],
  ["labor", "Personal"],
  ["design_client", "Diseño/Cliente"],
  ["other", "Otra"],
] as const;
const MAX_PHOTOS = 5;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const num = (s: string) => Number(s.replace(",", ".").trim());

/** Registro de avance en el navegador: cantidad, fotos con marca de agua y GPS, y lo demás opcional. */
export function FieldEntry({ go, activityId }: { go: Go; activityId: string }) {
  const { session, memberships } = useSession();
  const [picked] = useCurrentProject();
  const projectId = picked || memberships.find((m) => m.project)?.project_id || "";
  const today = bogota().slice(0, 10);

  const cat = useCatalog(projectId);
  const act = useMemo(() => cat?.activities.find((a) => a.id === activityId) ?? null, [cat, activityId]);
  const front = cat?.fronts.find((f) => f.id === act?.front_id);

  const [date, setDate] = useState(today);
  const [qty, setQty] = useState("");
  const [photos, setPhotos] = useState<(QueuedPhoto & { url: string })[]>([]);
  const [fix, setFix] = useState<Fix | null | "buscando">("buscando");
  const [more, setMore] = useState(false);
  const [hours, setHours] = useState("8");
  const [crew, setCrew] = useState("");
  const [weather, setWeather] = useState<string | null>(null);
  const [losses, setLosses] = useState<{ hours: string; cause: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getFix().then(setFix);
  }, []);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const f = fix && fix !== "buscando" ? ` · GPS ${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` : "";
    const next: (QueuedPhoto & { url: string })[] = [];
    setMsg(null);
    for (const file of [...files].slice(0, MAX_PHOTOS - photos.length)) {
      const takenAt = new Date().toISOString();
      let blob: Blob;
      try {
        blob = await photoToJpeg(file, `${bogota().slice(0, 16).replace("T", " ")}${f}`);
      } catch {
        setMsg("No se pudo leer una de las fotos. Tómala de nuevo.");
        continue;
      }
      next.push({ id: newId(), blob, takenAt, url: URL.createObjectURL(blob) });
    }
    setPhotos((p) => [...p, ...next]);
  }

  async function save() {
    if (!act || !session) return;
    const q = num(qty);
    if (!(q >= 0) || qty.trim() === "") return setMsg("Escribe la cantidad de hoy.");
    const lines = losses.filter((l) => l.hours.trim() && num(l.hours) > 0);
    if (lines.some((l) => l.cause === "none")) return setMsg("Indica la causa de cada pérdida de tiempo.");
    const lostTotal = lines.reduce((s, l) => s + num(l.hours), 0);
    if (lostTotal > 24 || !(num(hours) >= 0 && num(hours) <= 24)) return setMsg("Las horas deben estar entre 0 y 24.");
    const saldo = act.contract_qty - act.executed;
    if (act.contract_qty > 0 && q > saldo && !window.confirm(`La cantidad (${q}) supera lo que falta del contrato (${Math.max(0, saldo)} ${act.unit}). ¿Guardar igual?`)) return;
    setSaving(true);
    const byCause = new Map<string, number>();
    lines.forEach((l) => byCause.set(l.cause, (byCause.get(l.cause) ?? 0) + num(l.hours)));
    const lossList = [...byCause.entries()].map(([cause, h]) => ({ cause, hours: h })).sort((a, b) => b.hours - a.hours);
    const id = newId();
    const gps = fix && fix !== "buscando" ? fix : null;
    await enqueue({
      id,
      kind: "entry",
      projectId,
      label: `Avance ${act.code}: ${q.toLocaleString("es-CO")} ${act.unit} (${date})`,
      photos: photos.map(({ id: pid, blob, takenAt }) => ({ id: pid, blob, takenAt })),
      row: {
        id,
        project_id: projectId,
        front_id: act.front_id,
        activity_id: act.id,
        work_date: date,
        quantity: q,
        effective_hours: num(hours) || 0,
        lost_hours: lostTotal,
        loss_cause: lossList[0]?.cause ?? "none",
        losses: lossList,
        weather,
        crew_size: Math.max(0, Math.round(num(crew) || 0)),
        notes: notes.trim(),
        lat: gps?.lat ?? null,
        lon: gps?.lon ?? null,
        gps_accuracy_m: gps?.accuracy ?? null,
        status: "submitted",
        created_by: session.user.id,
        device_id: deviceId(),
        client_created_at: new Date().toISOString(),
      },
    });
    setSaving(false);
    go({ v: "inicio", saved: `Avance ${act.code}: ${q.toLocaleString("es-CO")} ${act.unit}` });
  }

  if (!cat) return <p className="text-zinc-500">Cargando la obra… (la primera vez necesita señal)</p>;
  if (!act)
    return (
      <p>
        No se encontró la actividad.{" "}
        <button type="button" onClick={() => go({ v: "inicio" })} className="font-semibold text-blue-700 underline">
          Volver
        </button>
      </p>
    );

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
<button type="button" onClick={() => go({ v: "inicio" })} className="font-semibold text-blue-700 dark:text-blue-400">
        ← Actividades
      </button>
      <div>
        <h1 className="text-xl font-extrabold">
          {act.code} · {act.name}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {front ? `${front.code} · ${front.name} · ` : ""}Acumulado {act.executed.toLocaleString("es-CO")} de {act.contract_qty.toLocaleString("es-CO")} {act.unit} · saldo{" "}
          {Math.max(0, act.contract_qty - act.executed).toLocaleString("es-CO")}
        </p>
        <p className="text-sm text-zinc-500">
          GPS: {fix === "buscando" ? "buscando…" : fix ? `OK ±${Math.round(fix.accuracy ?? 0)} m` : "sin ubicación (permite la ubicación al navegador)"}
        </p>
      </div>

      <div className="flex gap-2">
        {[
          [today, "Hoy"],
          [addDays(today, -1), "Ayer"],
          [addDays(today, -2), "Antier"],
        ].map(([d, l]) => (
          <button key={d} type="button" className={chip(date === d)} onClick={() => setDate(d!)}>
            {l}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-lg font-bold">Cantidad {date === today ? "de hoy" : `del ${date}`} ({act.unit})</span>
        <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={`${fieldInput} mt-1 text-3xl font-extrabold`} aria-label="Cantidad" />
      </label>

      <div>
        <label className={`${chip(false)} inline-block cursor-pointer`}>
          📷 Foto ({photos.length}/{MAX_PHOTOS})
          <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={photos.length >= MAX_PHOTOS} onChange={(e) => void addPhotos(e.target.files)} />
        </label>
        {photos.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((p) => (
              <button key={p.id} type="button" onClick={() => setPhotos((xs) => xs.filter((x) => x.id !== p.id))} aria-label="Quitar foto" className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto local del teléfono */}
                <img src={p.url} alt="Foto del avance" className="h-20 w-20 rounded-lg object-cover" />
                <span className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-xs text-white">✕</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button type="button" className="w-full rounded-xl bg-[#1f3a5f] px-4 py-4 text-xl font-extrabold text-white disabled:opacity-50" disabled={saving || qty.trim() === ""} onClick={() => void save()}>
        {saving ? "Guardando…" : "Guardar"}
      </button>
      {msg ? <p className="font-semibold text-red-700">{msg}</p> : null}

      <button type="button" className="w-full rounded-xl border-2 border-zinc-300 px-4 py-3 font-bold dark:border-zinc-700" onClick={() => setMore(!more)}>
        {more ? "▲ Menos datos" : "▼ Más datos (horas, personal, clima, pérdidas, notas)"}
      </button>
      {more ? (
        <div className="space-y-3">
          <label className="block">
            <span className="font-semibold">Horas efectivas</span>
            <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className={fieldInput} />
          </label>
          <label className="block">
            <span className="font-semibold">Personal (número de personas)</span>
            <input inputMode="numeric" value={crew} onChange={(e) => setCrew(e.target.value)} className={fieldInput} />
          </label>
          <div>
            <span className="font-semibold">Clima</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEATHER.map(([v, l]) => (
                <button key={v} type="button" className={chip(weather === v)} onClick={() => setWeather(weather === v ? null : v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="font-semibold">Pérdidas de tiempo</span>
            {losses.map((l, i) => (
              <div key={i} className="mt-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                <div className="flex gap-2">
                  <input inputMode="decimal" placeholder="Horas" value={l.hours} onChange={(e) => setLosses((ls) => ls.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} className={`${fieldInput} w-28`} aria-label={`Horas perdidas ${i + 1}`} />
                  <button type="button" className="ml-auto font-semibold text-red-700" onClick={() => setLosses((ls) => ls.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CAUSES.map(([v, lbl]) => (
                    <button key={v} type="button" className={chip(l.cause === v)} onClick={() => setLosses((ls) => ls.map((x, j) => (j === i ? { ...x, cause: v } : x)))}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button type="button" className="mt-2 rounded-lg border-2 border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700" onClick={() => setLosses((ls) => [...ls, { hours: "", cause: "none" }])}>
              + Agregar pérdida
            </button>
          </div>
          <label className="block">
            <span className="font-semibold">Observaciones</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={fieldInput} />
          </label>
        </div>
      ) : null}
      <QueueStatus />
    </div>
  );
}
