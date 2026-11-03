"use client";

import { useEffect, useMemo, useState } from "react";
import { chip, fieldInput, QueueStatus } from "./FieldKit";
import type { Go } from "./FieldApp";
import { bogota, useCatalog, enqueue, getFix, newId, photoToJpeg, type Fix, type QueuedPhoto } from "@/lib/field";
import { useCurrentProject, useSession } from "@/lib/session";

const CATEGORIES = [
  ["observacion", "Observación"],
  ["no_conformidad", "No conformidad"],
  ["punch", "Punch list"],
] as const;
const TYPES = [
  ["quality", "Calidad"],
  ["safety", "SST"],
  ["environment", "Ambiental"],
  ["operation", "Operación"],
] as const;
const SEVERITIES = [
  ["low", "Baja"],
  ["medium", "Media"],
  ["high", "Alta"],
  ["critical", "Crítica"],
] as const;
/** Plazo sugerido de corrección según severidad (igual que en el teléfono). */
const DUE_DAYS: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 15 };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Hallazgo en el navegador: clase, tipo, severidad, descripción, fotos y si detiene la obra. */
export function FieldFinding({ go }: { go: Go }) {
  const { session, memberships } = useSession();
  const [picked] = useCurrentProject();
  const projectId = picked || memberships.find((m) => m.project)?.project_id || "";
  const today = bogota().slice(0, 10);
  const cat = useCatalog(projectId);

  const [category, setCategory] = useState("observacion");
  const [type, setType] = useState("quality");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [front, setFront] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const [impeditive, setImpeditive] = useState(false);
  const [photos, setPhotos] = useState<(QueuedPhoto & { url: string })[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void getFix().then(setFix);
  }, []);
  const acts = useMemo(() => (cat?.activities ?? []).filter((a) => (front ? a.front_id === front : true)).slice(0, 200), [cat, front]);
  const due = addDays(today, DUE_DAYS[severity] ?? 7);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next: (QueuedPhoto & { url: string })[] = [];
    setMsg(null);
    for (const file of [...files].slice(0, 5 - photos.length)) {
      let blob: Blob;
      try {
        blob = await photoToJpeg(file, `${bogota().slice(0, 16).replace("T", " ")}${fix ? ` · GPS ${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` : ""}`);
      } catch {
        setMsg("No se pudo leer una de las fotos. Tómala de nuevo.");
        continue;
      }
      next.push({ id: newId(), blob, takenAt: new Date().toISOString(), url: URL.createObjectURL(blob) });
    }
    setPhotos((p) => [...p, ...next]);
  }

  async function save() {
    if (!session) return;
    if (description.trim().length < 5) return setMsg("Describe el hallazgo (al menos 5 letras).");
    if (category !== "observacion" && !activity) return setMsg("Elige la actividad: una no conformidad o un punch va ligado a una actividad.");
    const id = newId();
    await enqueue({
      id,
      kind: "finding",
      projectId,
      label: `Hallazgo: ${description.trim().slice(0, 40)}`,
      photos: photos.map(({ id: pid, blob, takenAt }) => ({ id: pid, blob, takenAt })),
      row: {
        id,
        project_id: projectId,
        front_id: front,
        type,
        severity,
        status: "open",
        description: description.trim(),
        lat: fix?.lat ?? null,
        lon: fix?.lon ?? null,
        due_date: due,
        created_by: session.user.id,
        category,
        impeditive,
        activity_id: activity || null,
      },
    });
    go({ v: "inicio", saved: "Hallazgo" });
  }

  const group = (title: string, options: readonly (readonly [string, string])[], value: string, set: (v: string) => void) => (
    <div>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" className={chip(value === v)} onClick={() => set(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
<button type="button" onClick={() => go({ v: "inicio" })} className="font-semibold text-blue-700 dark:text-blue-400">
        ← Campo
      </button>
      <h1 className="text-2xl font-extrabold">Reportar hallazgo</h1>
      {group("Clase", CATEGORIES, category, setCategory)}
      {group("Tipo", TYPES, type, setType)}
      {group("Severidad", SEVERITIES, severity, setSeverity)}
      <label className="block">
        <span className="font-semibold">Descripción</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={fieldInput} placeholder="Qué pasa, dónde y qué hay que corregir" />
      </label>
      <div>
        <label className={`${chip(false)} inline-block cursor-pointer`}>
          📷 Foto ({photos.length}/5)
          <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={photos.length >= 5} onChange={(e) => void addPhotos(e.target.files)} />
        </label>
        {photos.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((p) => (
              <button key={p.id} type="button" onClick={() => setPhotos((xs) => xs.filter((x) => x.id !== p.id))} aria-label="Quitar foto">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto local del teléfono */}
                <img src={p.url} alt="Foto del hallazgo" className="h-20 w-20 rounded-lg object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div>
        <p className="font-semibold">Frente</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" className={chip(front === null)} onClick={() => setFront(null)}>
            Sin frente
          </button>
          {(cat?.fronts ?? []).map((f) => (
            <button key={f.id} type="button" className={chip(front === f.id)} onClick={() => setFront(f.id)}>
              {f.code}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="font-semibold">{category === "observacion" ? "Actividad (opcional)" : "Actividad"}</span>
        <select value={activity} onChange={(e) => setActivity(e.target.value)} className={fieldInput}>
          <option value="">{category === "observacion" ? "Ninguna" : "Elige la actividad"}</option>
          {acts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <p className="font-semibold">¿Detiene la obra?</p>
        <div className="mt-1 flex gap-2">
          <button type="button" className={chip(!impeditive)} onClick={() => setImpeditive(false)}>
            No
          </button>
          <button type="button" className={chip(impeditive)} onClick={() => setImpeditive(true)}>
            Sí, es impeditivo
          </button>
        </div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Fecha límite sugerida: {due.split("-").reverse().join("/")}</p>
      {msg ? <p className="font-semibold text-red-700">{msg}</p> : null}
      <button
        type="button"
        className={`w-full rounded-xl px-4 py-4 text-xl font-extrabold text-white ${severity === "critical" ? "bg-red-700" : "bg-[#1f3a5f]"}`}
        onClick={() => void save()}
      >
        Guardar hallazgo
      </button>
      <QueueStatus />
    </div>
  );
}
