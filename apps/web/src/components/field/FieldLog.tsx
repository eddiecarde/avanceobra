"use client";

import { useMemo, useState } from "react";
import { chip, Counter, fieldInput, QueueStatus } from "./FieldKit";
import type { Go } from "./FieldApp";
import { bogota, useCatalog, enqueue, newId } from "@/lib/field";
import { useCurrentProject, useSession } from "@/lib/session";

const DEFAULT_ROLES = ["Director de obra", "Residente", "Supervisor SST", "Maestro de obra", "Oficial de obra", "Auxiliar de obra", "Operador de equipo", "Soldador", "Conductor"];
const DEFAULT_EQUIPMENT = ["Retroexcavadora", "Vibrocompactador", "Motoniveladora", "Volqueta", "Mezcladora de concreto", "Vibrador de concreto", "Hincadora", "Canguro"];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Parte diario en el navegador: personal por cargo, equipos (y en qué actividad trabajaron) y lluvia. */
export function FieldLog({ go }: { go: Go }) {
  const { memberships } = useSession();
  const [picked] = useCurrentProject();
  const projectId = picked || memberships.find((m) => m.project)?.project_id || "";
  const today = bogota().slice(0, 10);
  const cat = useCatalog(projectId);

  const [date, setDate] = useState(today);
  const [front, setFront] = useState<string | null>(null);
  const [people, setPeople] = useState<Record<string, number>>({});
  const [equip, setEquip] = useState<Record<string, number>>({});
  const [equipAct, setEquipAct] = useState<Record<string, string>>({});
  const [rain, setRain] = useState<{ start: string; end: string }[]>([]);
  const [rs, setRs] = useState("");
  const [re, setRe] = useState("");
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const roles = cat?.roles.length ? cat.roles : DEFAULT_ROLES;
  const equipment = cat?.equipment.length ? cat.equipment : DEFAULT_EQUIPMENT;
  const acts = useMemo(() => (cat?.activities ?? []).filter((a) => (front ? a.front_id === front : true)).slice(0, 200), [cat, front]);
  const totalPeople = Object.values(people).reduce((s, n) => s + n, 0);

  async function send() {
    if (!totalPeople && !Object.values(equip).some(Boolean) && !rain.length && !obs.trim()) return setMsg("El parte está vacío: registra al menos el personal.");
    const id = newId();
    await enqueue({
      id,
      kind: "log",
      projectId,
      label: `Parte diario del ${date}${front ? ` · ${cat?.fronts.find((f) => f.id === front)?.code ?? ""}` : ""}`,
      photos: [],
      row: {
        id,
        project_id: projectId,
        front_id: front,
        log_date: date,
        personnel: Object.entries(people)
          .filter(([, n]) => n > 0)
          .map(([role, qty]) => ({ role, qty })),
        equipment: Object.entries(equip)
          .filter(([, n]) => n > 0)
          .map(([name, qty]) => (equipAct[name] ? { name, qty, activity_id: equipAct[name] } : { name, qty })),
        rain,
        observations: obs.trim(),
        client_created_at: new Date().toISOString(),
      },
    });
    go({ v: "inicio", saved: `Parte diario del ${date}` });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
<button type="button" onClick={() => go({ v: "inicio" })} className="font-semibold text-blue-700 dark:text-blue-400">
        ← Campo
      </button>
      <h1 className="text-2xl font-extrabold">Parte diario</h1>
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
      <div>
        <p className="font-semibold">¿De qué frente es este parte?</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" className={chip(front === null)} onClick={() => setFront(null)}>
            Toda la obra
          </button>
          {(cat?.fronts ?? []).map((f) => (
            <button key={f.id} type="button" className={chip(front === f.id)} onClick={() => setFront(f.id)}>
              {f.code}
            </button>
          ))}
        </div>
      </div>

      <section>
        <h2 className="text-xl font-bold">Personal · {totalPeople}</h2>
        {roles.map((r) => (
          <Counter key={r} label={r} value={people[r] ?? 0} onChange={(n) => setPeople((p) => ({ ...p, [r]: n }))} />
        ))}
      </section>

      <section>
        <h2 className="text-xl font-bold">Equipos · {Object.values(equip).reduce((s, n) => s + n, 0)}</h2>
        {equipment.map((e) => (
          <div key={e}>
            <Counter label={e} value={equip[e] ?? 0} onChange={(n) => setEquip((p) => ({ ...p, [e]: n }))} />
            {(equip[e] ?? 0) > 0 && acts.length ? (
              <label className="mb-2 block text-sm">
                ¿En qué actividad trabajó {e}?
                <select
                  value={equipAct[e] ?? ""}
                  onChange={(ev) => setEquipAct((p) => ({ ...p, [e]: ev.target.value }))}
                  className="mt-1 w-full rounded-lg border-2 border-zinc-300 bg-white px-2 py-2 dark:border-zinc-600 dark:bg-zinc-900"
                >
                  <option value="">Sin indicar</option>
                  {acts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-xl font-bold">Lluvia</h2>
        {rain.map((r, i) => (
          <div key={i} className="flex items-center justify-between py-1">
            <span className="font-semibold">
              🌧 {r.start} – {r.end}
            </span>
            <button type="button" className="font-semibold text-red-700" onClick={() => setRain((xs) => xs.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
        <div className="mt-1 flex gap-2">
          <input type="time" value={rs} onChange={(e) => setRs(e.target.value)} className={fieldInput} aria-label="Inicio de la lluvia" />
          <input type="time" value={re} onChange={(e) => setRe(e.target.value)} className={fieldInput} aria-label="Fin de la lluvia" />
        </div>
        <button
          type="button"
          className="mt-2 rounded-lg border-2 border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700"
          onClick={() => {
            if (!rs || !re || rs >= re) return setMsg("La lluvia necesita hora de inicio y de fin, y el fin después del inicio.");
            setRain((xs) => [...xs, { start: rs, end: re }].sort((a, b) => a.start.localeCompare(b.start)));
            setRs("");
            setRe("");
            setMsg(null);
          }}
        >
          + Agregar lluvia
        </button>
      </section>

      <label className="block">
        <span className="text-xl font-bold">Observaciones</span>
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} placeholder="Novedades del día (opcional)" className={fieldInput} />
      </label>
      {msg ? <p className="font-semibold text-red-700">{msg}</p> : null}
      <button type="button" className="w-full rounded-xl bg-[#1f3a5f] px-4 py-4 text-xl font-extrabold text-white" onClick={() => void send()}>
        Enviar parte
      </button>
      <QueueStatus />
    </div>
  );
}
