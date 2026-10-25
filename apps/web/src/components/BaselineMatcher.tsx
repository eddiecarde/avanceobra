"use client";

import { matchBaselines, suggestGroup, type ImportPlan } from "@avanceobra/importers";
import { useMemo, useState } from "react";
import { Button, Card, Select } from "@/components/ui";
import type { Existing } from "@/lib/importer";
import { supabase } from "@/lib/supabase";

/**
 * Línea base de MS Project para una obra que ya existe con otros códigos (la creada desde el
 * informe del contratista): se empareja cada grupo de trabajo de la obra con el del cronograma
 * (con sugerencias) y la línea base se asigna subcampo por subcampo.
 */
export function BaselineMatcher({ plan, existing, projectId, onDone }: { plan: ImportPlan; existing: Existing; projectId: string; onDone: (text: string) => void }) {
  const scheduleGroups = useMemo(() => [...new Set(plan.activities.filter((a) => a.baselines?.length).map((a) => a.workGroup).filter(Boolean) as string[])].sort(), [plan]);
  const groups = useMemo(() => [...new Set(existing.zones.map((z) => z.workGroup).filter(Boolean) as string[])].sort(), [existing]);
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g, suggestGroup(g, scheduleGroups) ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => matchBaselines(plan.activities, existing.zones, Object.fromEntries(Object.entries(map).filter(([, v]) => v))), [plan, existing, map]);

  async function save() {
    setBusy(true);
    setError(null);
    const payload = rows.map((r) => ({ activity_id: r.activityId, project_id: projectId, baseline: r.baseline, start: r.start, finish: r.finish }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error: e } = await supabase.from("activity_baselines").upsert(payload.slice(i, i + 500), { onConflict: "activity_id,baseline" });
      if (e) {
        setBusy(false);
        return setError(e.message);
      }
    }
    setBusy(false);
    onDone(`Línea base guardada en ${new Set(rows.map((r) => r.activityId)).size} actividad(es) de la obra.`);
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Línea base para la obra existente</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        La obra ya tiene actividades con otros códigos (por ejemplo, las del informe del contratista). Empareja cada grupo de trabajo con el del cronograma; la
        línea base se asigna subcampo por subcampo. Las sugerencias se pueden cambiar.
      </p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
            <tr>
              <th className="px-2 py-1">Grupo de la obra</th>
              <th className="px-2">Grupo del cronograma</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-2 py-1">{g}</td>
                <td className="px-2 py-1">
                  <Select aria-label={`Grupo del cronograma para ${g}`} value={map[g] ?? ""} onChange={(e) => setMap({ ...map, [g]: e.target.value })} className="py-1">
                    <option value="">Sin línea base</option>
                    {scheduleGroups.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" disabled={busy || !rows.length} onClick={() => void save()}>
          {busy ? "Guardando…" : `Guardar línea base (${new Set(rows.map((r) => r.activityId)).size} actividades)`}
        </Button>
        {error ? <span className="font-semibold text-red-700 dark:text-red-400">{error}</span> : null}
      </div>
    </Card>
  );
}
