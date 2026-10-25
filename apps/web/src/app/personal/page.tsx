"use client";

import { addDays } from "@avanceobra/engine";
import { useEffect, useMemo, useState } from "react";
import { DailyBarsChart } from "@/components/dash/Charts";
import { Button, Card, downloadBlob, Field, Input, Select } from "@/components/ui";
import { localToday } from "@/lib/dashboard";
import { DEFAULT_WORKDAY } from "@/lib/library";
import { loadParte, type ParteData } from "@/lib/parte";
import { useCurrentProject, useSession } from "@/lib/session";

const n1 = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const hours = (n: number) => `${n1(n)} h`;
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });

interface Tally {
  name: string;
  total: number;
  days: number;
  max: number;
}

/** Suma por cargo o equipo: días-persona (o días-máquina), promedio de los días en que hubo y máximo. */
function tally(rows: Record<string, number>[]): Tally[] {
  const out = new Map<string, Tally>();
  for (const r of rows)
    for (const [name, qty] of Object.entries(r)) {
      const t = out.get(name) ?? { name, total: 0, days: 0, max: 0 };
      t.total += qty;
      t.days += 1;
      t.max = Math.max(t.max, qty);
      out.set(name, t);
    }
  return [...out.values()].sort((a, b) => b.total - a.total);
}

/** Personal y equipos por día desde el parte del teléfono, y la lluvia en la jornada como días reclamables. */
export default function Personal() {
  const { memberships } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const [picked, setPicked] = useCurrentProject();
  const projectId = picked || projects[0]?.id || "";
  const projectName = projects.find((p) => p.id === projectId)?.name ?? "Proyecto";
  const today = localToday();
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const [data, setData] = useState<{ key: string; parte: ParteData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectiveHours = DEFAULT_WORKDAY.effectiveHours;
  const key = `${projectId}|${range.from}|${range.to}`;

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    loadParte(projectId, effectiveHours, { from: range.from || undefined, to: range.to || undefined })
      .then((parte) => !off && setData({ key, parte }))
      .catch((e: Error) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [projectId, range.from, range.to, key, effectiveHours]);

  const parte = data?.key === key ? data.parte : null;
  const roles = useMemo(() => tally(parte?.days.map((d) => d.personnel) ?? []), [parte]);
  const equipment = useMemo(() => tally(parte?.days.map((d) => d.equipment) ?? []), [parte]);
  const claimByDate = useMemo(() => new Map(parte?.claim.days.map((d) => [d.date, d]) ?? []), [parte]);

  if (!projects.length) return <p className="text-zinc-600">No tienes proyectos asignados.</p>;

  const manDays = parte?.days.reduce((s, d) => s + d.totalPersonnel, 0) ?? 0;
  const machineDays = equipment.reduce((s, e) => s + e.total, 0);
  const withStaff = parte?.days.filter((d) => d.totalPersonnel > 0).length ?? 0;

  async function exportClaim() {
    if (!parte) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Reclamo por lluvia");
    ws.addRow([`${projectName}: soporte de días reclamables por lluvia`]).font = { bold: true, size: 13 };
    ws.addRow([`Periodo: ${range.from || "inicio"} a ${range.to || "hoy"} · Jornada ${parte.window.start} a ${parte.window.end} · ${effectiveHours} h efectivas por día`]);
    ws.addRow([]);
    const head = ws.addRow(["Fecha", "Lluvia reportada en el parte", "Horas de lluvia en la jornada", "Horas perdidas por clima en el avance", "Horas reclamables"]);
    head.font = { bold: true };
    for (const d of parte.claim.days)
      ws.addRow([d.date, d.rain.map((r) => `${r.start}–${r.end}`).join(", ") || "—", Number(d.rainHours.toFixed(2)), d.entryHours, Number(d.hours.toFixed(2))]);
    ws.addRow([]);
    ws.addRow(["Total", "", "", "", Number(parte.claim.hours.toFixed(2))]).font = { bold: true };
    ws.addRow(["Días reclamables", "", "", "", parte.claim.claimableDays]).font = { bold: true };
    ws.columns.forEach((c, i) => (c.width = [12, 34, 16, 18, 14][i]));

    const ps = wb.addWorksheet("Personal y equipos");
    const roleNames = roles.map((r) => r.name);
    const eqNames = equipment.map((e) => e.name);
    ps.addRow(["Fecha", ...roleNames, "Total personal", ...eqNames, "Lluvia (h en jornada)"]).font = { bold: true };
    for (const d of parte.days)
      ps.addRow([
        d.date,
        ...roleNames.map((r) => d.personnel[r] ?? 0),
        d.totalPersonnel,
        ...eqNames.map((e) => d.equipment[e] ?? 0),
        Number((claimByDate.get(d.date)?.rainHours ?? 0).toFixed(2)),
      ]);
    ps.columns.forEach((c, i) => (c.width = i === 0 ? 12 : 14));
    downloadBlob(`reclamo_lluvia_${range.from || "inicio"}_${range.to || today}.xlsx`, await wb.xlsx.writeBuffer(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full">
          <h1 className="text-2xl font-extrabold">Personal, equipos y lluvia</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Lo que reportan los supervisores en el parte diario del teléfono y la lluvia que se puede reclamar como ampliación de plazo.</p>
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
        <Field label="Desde">
          <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
        <Button onClick={() => setRange({ from: "", to: "" })}>Toda la obra</Button>
      </div>

      {error ? <p className="font-semibold text-red-700 dark:text-red-400">{error}</p> : null}
      {!parte ? (
        <p className="text-zinc-500">Cargando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Personal promedio por día", value: withStaff ? n1(manDays / withStaff) : "—", hint: `${withStaff} día(s) con parte` },
              { label: "Días-persona", value: n1(manDays), hint: "suma del personal de cada día" },
              { label: "Días-máquina", value: n1(machineDays), hint: `${equipment.length} tipo(s) de equipo` },
              { label: "Lluvia en la jornada", value: hours(parte.claim.days.reduce((s, d) => s + d.rainHours, 0)), hint: `jornada ${parte.window.start} a ${parte.window.end}` },
              { label: "Días reclamables por lluvia", value: String(parte.claim.claimableDays), hint: `${hours(parte.claim.hours)} ÷ ${effectiveHours} h por día` },
            ].map((k) => (
              <Card key={k.label}>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{k.label}</p>
                <p className="mt-1 text-3xl font-extrabold tabular-nums">{k.value}</p>
                <p className="text-sm text-zinc-500">{k.hint}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-lg font-bold">Personal en obra por día</h2>
              <DailyBarsChart
                rows={parte.days.map((d) => ({ date: d.date, value: d.totalPersonnel, detail: `${Object.values(d.equipment).reduce((s, n) => s + n, 0)} equipo(s)` }))}
                label="Personas"
                color="var(--viz-1)"
                format={(v) => n1(v)}
              />
            </Card>
            <Card>
              <h2 className="mb-2 text-lg font-bold">Horas reclamables por clima</h2>
              <DailyBarsChart
                rows={parte.claim.days.map((d) => ({ date: d.date, value: d.hours, detail: d.rain.map((r) => `${r.start}–${r.end}`).join(", ") || "registrado en el avance" }))}
                label="Horas"
                color="var(--viz-2)"
                format={(v) => n1(v)}
              />
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {[
              { title: "Por cargo", unit: "Días-persona", rows: roles },
              { title: "Por equipo", unit: "Días-máquina", rows: equipment },
            ].map((t) => (
              <Card key={t.title}>
                <h2 className="mb-2 text-lg font-bold">{t.title}</h2>
                {t.rows.length ? (
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        <th className="py-1">{t.title === "Por cargo" ? "Cargo" : "Equipo"}</th>
                        <th className="text-right">{t.unit}</th>
                        <th className="text-right">Promedio</th>
                        <th className="text-right">Máximo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((r) => (
                        <tr key={r.name} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1">{r.name}</td>
                          <td className="text-right tabular-nums">{n1(r.total)}</td>
                          <td className="text-right tabular-nums">{n1(r.total / r.days)}</td>
                          <td className="text-right tabular-nums">{n1(r.max)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-zinc-500">Sin datos en el parte de este periodo.</p>
                )}
              </Card>
            ))}
          </div>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <div className="mr-auto">
                <h2 className="text-lg font-bold">Soporte de días reclamables por lluvia</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Por día cuenta la lluvia del parte dentro de la jornada o, si es mayor, lo que registraron como horas perdidas por clima. Las cuadrillas paran a la
                  vez, así que no se suman entre sí. El simulador de multa usa estos días.
                </p>
              </div>
              <Button disabled={!parte.claim.days.length} onClick={() => void exportClaim()}>
                Descargar soporte (Excel)
              </Button>
            </div>
            {parte.claim.days.length ? (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="py-1">Fecha</th>
                      <th>Lluvia del parte</th>
                      <th className="text-right">En la jornada</th>
                      <th className="text-right">Registrado en el avance</th>
                      <th className="text-right">Reclamable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parte.claim.days.map((d) => (
                      <tr key={d.date} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1">{fmtDate(d.date)}</td>
                        <td>{d.rain.map((r) => `${r.start}–${r.end}`).join(", ") || "—"}</td>
                        <td className="text-right tabular-nums">{hours(d.rainHours)}</td>
                        <td className="text-right tabular-nums">{d.entryHours ? hours(d.entryHours) : "—"}</td>
                        <td className="text-right font-semibold tabular-nums">{hours(d.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-300 font-bold dark:border-zinc-700">
                      <td className="py-1" colSpan={4}>
                        Total: {parte.claim.claimableDays} día(s) reclamables
                      </td>
                      <td className="text-right tabular-nums">{hours(parte.claim.hours)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-zinc-500">Sin lluvia reportada en este periodo.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
