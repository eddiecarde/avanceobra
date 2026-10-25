"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { geocode } from "@/lib/weather";

/** Código sugerido a partir del nombre: iniciales en mayúsculas ("Parque Solar Sur" → "PSS"). */
const suggestCode = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 || /\d/.test(w))
    .map((w) => (/\d/.test(w) ? w.replace(/\D/g, "") : w[0]!))
    .join("")
    .toUpperCase()
    .slice(0, 12);

/** Crear una obra nueva: datos básicos; la programación se carga después en Programación. */
export default function NuevoProyecto() {
  const { isAdmin, orgId, reloadMemberships, setCurrentProjectId } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", code: "", client: "", location: "", zone: "", start: "", end: "" });
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return <p className="text-zinc-600">Solo el administrador de una obra puede crear obras nuevas.</p>;
  const code = codeTouched ? form.code : suggestCode(form.name);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const missing = [
      form.name.trim().length < 3 ? "el nombre" : null,
      code.trim().length < 2 ? "el código" : null,
      !form.start ? "la fecha de inicio" : null,
      !form.end ? "la fecha de terminación" : null,
    ].filter(Boolean);
    if (missing.length) return setError(`Falta ${missing.join(", ")}.`);
    if (form.end <= form.start) return setError("La terminación debe ser posterior al inicio.");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("create_project", {
      p_code: code,
      p_name: form.name,
      p_start: form.start,
      p_end: form.end,
      p_client: form.client || null,
      p_location: form.location || null,
      p_zone_label: form.zone || null,
      p_org: orgId,
    });
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    const id = data as string;
    // Coordenadas del municipio para el clima (si no se encuentran, se puede corregir en Proyecto)
    const geo = form.location.trim() ? await geocode(form.location) : null;
    if (geo) await supabase.from("projects").update({ lat: geo.lat, lon: geo.lon }).eq("id", id);
    setCurrentProjectId(id);
    reloadMemberships();
    router.push("/importar?nuevo=1");
  }

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Nuevo proyecto</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Crea la obra con sus datos básicos. Quedas como administrador. Después cargas la programación (Excel, MS Project o Primavera) y agregas al equipo.
        </p>
      </div>
      <Card>
        <form onSubmit={(e) => void create(e)} className="grid gap-3 md:grid-cols-2">
          <Field label="Nombre de la obra" className="md:col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="p. ej. Parque Solar Sur 80 MW" />
          </Field>
          <Field label="Código" hint="(corto, sin espacios; aparece en informes)">
            <Input
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                set("code", e.target.value.toUpperCase());
              }}
              placeholder="p. ej. PSS-80"
            />
          </Field>
          <Field label="Cliente" hint="(a quién se le reporta)">
            <Input value={form.client} onChange={(e) => set("client", e.target.value)} placeholder="p. ej. Helios" />
          </Field>
          <Field label="Ubicación" hint="(municipio, departamento: para el clima)">
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="p. ej. Valledupar, Cesar" />
          </Field>
          <Field label="Cómo se llaman las zonas" hint="(opcional)">
            <Input value={form.zone} onChange={(e) => set("zone", e.target.value)} placeholder="Subcampo, Tramo, Bloque, Piso…" list="zone-labels" />
            <datalist id="zone-labels">
              {["Subcampo", "Tramo", "Bloque", "Piso", "Sector", "Frente", "Zona"].map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label="Inicio de la obra">
            <Input type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field label="Terminación contractual">
            <Input type="date" value={form.end} onChange={(e) => set("end", e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creando…" : "Crear obra y cargar la programación"}
            </Button>
            {error ? (
              <span role="alert" className="font-semibold text-red-700 dark:text-red-400">
                {error}
              </span>
            ) : null}
          </div>
        </form>
      </Card>
      <Card>
        <h2 className="text-lg font-bold">Después de crearla</h2>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            <b>Programación:</b> sube el Excel (hojas Actividades y Frentes), el XML de MS Project o el XER de Primavera. Ves los cambios antes de guardar.
          </li>
          <li>
            <b>Proyecto:</b> días hábiles, festivos, jornada, pesos del contrato y empresa de cada actividad.
          </li>
          <li>
            <b>Equipo:</b> agrega supervisores, residentes y, si quieres, el acceso del cliente.
          </li>
          <li>
            <b>Actas de cobro:</b> precios unitarios cuando vayas a cobrar.
          </li>
        </ol>
      </Card>
    </div>
  );
}
