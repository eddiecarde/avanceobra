"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoxedPhoto } from "@/components/AiCheck";
import { Badge, Button, Card, Field, Select, Textarea } from "@/components/ui";
import { callAi, shrinkImage, toWav16k, type AiBox } from "@/lib/ai";
import { localToday } from "@/lib/dashboard";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

interface ParsedReport {
  front_code: string | null;
  progress: { activity_code: string; quantity: number; note: string }[];
  personnel: { role: string; qty: number }[];
  equipment: { name: string; qty: number }[];
  rain: { start: string; end: string }[];
  findings: { description: string; type: string; severity: string }[];
  observations: string;
  unmatched: string[];
}
interface Defect {
  analysis: { is_defect: boolean; type: string; severity: string; title: string; description: string; corrective_action: string; sam_concept: string };
  marks: { width: number | null; height: number | null; boxes: AiBox[] };
}

const TYPE: Record<string, string> = { quality: "Calidad", safety: "Seguridad", environment: "Ambiente", operation: "Operación" };
const SEV: Record<string, { label: string; tone: "neutral" | "amber" | "red" }> = {
  low: { label: "Baja", tone: "neutral" },
  medium: { label: "Media", tone: "amber" },
  high: { label: "Alta", tone: "red" },
  critical: { label: "Crítica", tone: "red" },
};

/** Asistente con modelos de Meta: parte diario por voz (Muse Voice Transcribe + Muse Spark) y análisis de defectos (Muse Spark + SAM 3.1). */
export default function Asistente() {
  const { memberships, canUseAi } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useState("");
  const projectId = picked || projects[0]?.id || "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold">Asistente IA</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Con modelos de Meta: dicta el parte del día y la IA lo llena; sube la foto de un defecto y la IA lo clasifica, lo marca y redacta la acción correctiva. Tú revisas
            antes de guardar.
          </p>
        </div>
        {projects.length > 1 ? (
          <Field label="Obra">
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
      {projectId && !canUseAi(projectId) ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No tienes activado el asistente con IA en esta obra. Pídele al administrador que te lo active en Equipo.
        </p>
      ) : projectId ? (
        <>
          <VoiceReport key={`v-${projectId}`} projectId={projectId} />
          <DefectPhoto key={`d-${projectId}`} projectId={projectId} />
        </>
      ) : null}
    </div>
  );
}

function VoiceReport({ projectId }: { projectId: string }) {
  const [fronts, setFronts] = useState<{ id: string; code: string; name: string }[]>([]);
  const [front, setFront] = useState("");
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const rec = useRef<{ media: MediaRecorder; chunks: Blob[] } | null>(null);

  useEffect(() => {
    void supabase
      .from("fronts")
      .select("id, code, name")
      .eq("project_id", projectId)
      .order("code")
      .then(({ data }) => setFronts((data ?? []) as typeof fronts));
  }, [projectId]);

  async function startRec() {
    setMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (e) => chunks.push(e.data);
      media.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void transcribe(new Blob(chunks, { type: media.mimeType }));
      };
      media.start();
      rec.current = { media, chunks };
      setRecording(true);
      // Máximo 3 minutos por grabación
      setTimeout(() => rec.current?.media.state === "recording" && stopRec(), 180_000);
    } catch {
      setMsg({ tone: "error", text: "No se pudo usar el micrófono: dale permiso al navegador o escribe el parte." });
    }
  }
  function stopRec() {
    rec.current?.media.stop();
    rec.current = null;
    setRecording(false);
  }
  async function transcribe(audio: Blob) {
    setBusy("Transcribiendo con Muse Voice Transcribe…");
    try {
      const wav = await toWav16k(audio);
      const b64 = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.readAsDataURL(wav);
      });
      const r = await callAi<{ text: string }>("transcribe", { project_id: projectId, audio_base64: b64 });
      if (r.data === null) return setMsg({ tone: "error", text: r.error });
      setText((t) => [t.trim(), r.data.text].filter(Boolean).join(" "));
    } catch (e) {
      setMsg({ tone: "error", text: `No se pudo leer la grabación: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }
  async function fill() {
    setMsg(null);
    setBusy("Muse Spark está llenando el parte…");
    const r = await callAi<{ report: ParsedReport }>("parse_report", { project_id: projectId, text, front_id: front || null });
    setBusy(null);
    if (r.data === null) return setMsg({ tone: "error", text: r.error });
    setReport(r.data.report);
    if (!front && r.data.report.front_code) setFront(fronts.find((f) => f.code === r.data.report.front_code)?.id ?? "");
  }
  async function save() {
    if (!report) return;
    setBusy("Guardando…");
    const { error } = await supabase.from("daily_logs").insert({
      id: crypto.randomUUID(),
      project_id: projectId,
      front_id: front || null,
      log_date: localToday(),
      personnel: report.personnel,
      equipment: report.equipment,
      rain: report.rain,
      observations: [report.observations, ...report.findings.map((f) => `Hallazgo: ${f.description}`)].filter(Boolean).join("\n"),
      client_created_at: new Date().toISOString(),
    });
    setBusy(null);
    if (error) return setMsg({ tone: "error", text: `No se pudo guardar: ${error.message}` });
    setMsg({ tone: "ok", text: "Parte diario guardado. Los avances regístralos con su foto desde el teléfono (o ya quedan en el parte dictado del teléfono)." });
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Parte diario por voz</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Graba o escribe cómo fue el día: qué hicieron y cuánto, cuánta gente y qué equipos, si llovió (de qué hora a qué hora) y los problemas.
      </p>
      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <Field label="Lo que pasó hoy">
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ej.: hoy en el subcampo 3 hincamos 120 pilotes con 2 hincadoras, 4 oficiales y 6 auxiliares; llovió de 10 a 11 y media; hay un pilote torcido en la fila 4"
          />
        </Field>
        <Field label="Frente">
          <Select value={front} onChange={(e) => setFront(e.target.value)}>
            <option value="">Toda la obra</option>
            {fronts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} · {f.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {recording ? (
          <Button variant="danger" onClick={stopRec}>
            ■ Detener y transcribir
          </Button>
        ) : (
          <Button onClick={() => void startRec()} disabled={!!busy}>
            🎙 Grabar
          </Button>
        )}
        <Button variant="primary" onClick={() => void fill()} disabled={!!busy || recording || text.trim().length < 8}>
          ✨ Llenar el parte con IA
        </Button>
        {busy ? (
          <span role="status" className="text-sm text-zinc-500">
            {busy}
          </span>
        ) : null}
        {recording ? <Badge tone="red">Grabando…</Badge> : null}
      </div>
      {msg ? (
        <p role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "mt-2 font-semibold text-red-700 dark:text-red-400" : "mt-2 font-semibold text-green-700 dark:text-green-400"}>
          {msg.text}
        </p>
      ) : null}
      {report ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Section title="Avance">
            {report.progress.length ? (
              report.progress.map((p) => (
                <li key={p.activity_code}>
                  <b>{p.activity_code}</b>: {p.quantity.toLocaleString("es-CO")}
                  {p.note ? <span className="text-zinc-500"> · {p.note}</span> : null}
                </li>
              ))
            ) : (
              <li className="text-zinc-500">Sin cantidades</li>
            )}
          </Section>
          <Section title="Personal y equipos">
            {[...report.personnel.map((p) => `${p.qty} ${p.role}`), ...report.equipment.map((e) => `${e.qty} ${e.name}`)].map((x) => (
              <li key={x}>{x}</li>
            ))}
            {!report.personnel.length && !report.equipment.length ? <li className="text-zinc-500">No se mencionaron</li> : null}
          </Section>
          <Section title="Lluvia">
            {report.rain.length ? report.rain.map((r) => <li key={r.start}>{`🌧 ${r.start} – ${r.end}`}</li>) : <li className="text-zinc-500">Sin lluvia</li>}
          </Section>
          <Section title="Hallazgos">
            {report.findings.length ? (
              report.findings.map((f) => (
                <li key={f.description}>
                  <Badge tone={SEV[f.severity]?.tone ?? "neutral"}>{`${TYPE[f.type] ?? f.type} · ${SEV[f.severity]?.label ?? f.severity}`}</Badge> {f.description}
                </li>
              ))
            ) : (
              <li className="text-zinc-500">Ninguno</li>
            )}
          </Section>
          {report.observations ? <p className="md:col-span-2">Observaciones: {report.observations}</p> : null}
          {report.unmatched.length ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2 dark:bg-amber-950 dark:text-amber-200">
              No se pudo ubicar: {report.unmatched.join("; ")}. Regístralo a mano.
            </p>
          ) : null}
          <div className="md:col-span-2">
            <Button variant="primary" onClick={() => void save()} disabled={!!busy}>
              Guardar parte diario
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">{title}</div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function DefectPhoto({ projectId }: { projectId: string }) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ url: string; b64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Defect | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setRes(null);
    setError(null);
    const b64 = await shrinkImage(file);
    setPhoto({ url: `data:image/jpeg;base64,${b64}`, b64 });
  }
  async function analyze() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    const r = await callAi<Defect>("defect", { project_id: projectId, image_base64: photo.b64, note });
    setBusy(false);
    if (r.data === null) return setError(r.error);
    setRes(r.data);
  }
  const a = res?.analysis;

  return (
    <Card>
      <h2 className="text-lg font-bold">Asistente de defectos</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Sube la foto de un punch o una no conformidad: Muse Spark la clasifica y SAM 3.1 marca dónde está el defecto.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Field label="Foto">
            <input type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])} className="block w-full text-sm" />
          </Field>
          <Field label="Nota del inspector" hint="(opcional)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: revisar torque de pernos en la mesa 12" />
          </Field>
          <Button variant="primary" onClick={() => void analyze()} disabled={!photo || busy}>
            {busy ? "Analizando…" : "✨ Analizar con IA"}
          </Button>
          {error ? (
            <p role="alert" className="font-semibold text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
        <div>
          {photo && res?.marks.width && res.marks.height ? (
            <BoxedPhoto src={photo.url} width={res.marks.width} height={res.marks.height} boxes={res.marks.boxes} alt={`Foto con ${res.marks.boxes.length} zona(s) marcadas`} />
          ) : photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt="Foto del defecto" className="max-h-80 rounded-lg" />
          ) : null}
        </div>
      </div>
      {a ? (
        <div className="mt-4 space-y-2">
          {a.is_defect ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold">{a.title}</h3>
                <Badge tone="blue">{TYPE[a.type] ?? a.type}</Badge>
                <Badge tone={SEV[a.severity]?.tone ?? "neutral"}>{`Severidad ${SEV[a.severity]?.label ?? a.severity}`}</Badge>
                {res!.marks.boxes.length ? <Badge tone="neutral">{`${res!.marks.boxes.length} zona(s) marcadas («${a.sam_concept}»)`}</Badge> : null}
              </div>
              <p>{a.description}</p>
              <div>
                <div className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Acción correctiva sugerida</div>
                <p className="whitespace-pre-wrap">{a.corrective_action}</p>
              </div>
              <Button
                size="sm"
                onClick={() => void navigator.clipboard.writeText(`${a.title}\n${a.description}\nAcción correctiva: ${a.corrective_action}`)}
              >
                Copiar para el hallazgo
              </Button>
            </>
          ) : (
            <p>
              <b>La IA no ve un defecto en la foto.</b> {a.description}
            </p>
          )}
          <p className="text-xs text-zinc-500">Sugerencia de Muse Spark y SAM 3.1 (Meta): el inspector decide.</p>
        </div>
      ) : null}
    </Card>
  );
}
