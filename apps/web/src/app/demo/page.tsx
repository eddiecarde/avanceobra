"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/** Página pública: una constructora pide una demostración de AvanceObra (sin cuenta). */
export default function Demo() {
  const [f, setF] = useState({ name: "", company: "", email: "", phone: "", city: "", project_type: "Solar fotovoltaica", projects: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 3 || f.company.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()))
      return setError("Escribe tu nombre, tu empresa y un correo válido.");
    setBusy(true);
    const { error: err } = await supabase.rpc("request_demo", {
      p_name: f.name,
      p_company: f.company,
      p_email: f.email,
      p_phone: f.phone || null,
      p_city: f.city || null,
      p_project_type: f.project_type || null,
      p_projects_count: Number(f.projects) || null,
      p_message: f.message || null,
      p_website: f.website || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <span className="mr-auto text-lg font-extrabold tracking-tight">
            Avance<span className="text-blue-700">Obra</span>
          </span>
          <Link href="/login" className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">
            Ya tengo cuenta
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <div>
          <h1 className="text-3xl font-extrabold">Pide una demostración</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Control de avance de obra que funciona sin señal: el supervisor registra en tres toques y el gerente ve curvas S, atrasos, actas de cobro,
            subcontratistas, seguridad social y la decisión de acelerar o pagar la multa. Déjanos tus datos y te mostramos tu obra en AvanceObra.
          </p>
        </div>
        {sent ? (
          <Card className="border-l-4 border-l-green-600">
            <h2 className="text-xl font-bold">¡Recibimos tu solicitud!</h2>
            <p className="text-zinc-600 dark:text-zinc-400">Te escribiremos a {f.email.trim()} para agendar la demostración.</p>
          </Card>
        ) : (
          <Card>
            <form onSubmit={(e) => void send(e)} className="grid gap-3 md:grid-cols-2">
              <Field label="Tu nombre">
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Empresa">
                <Input value={f.company} onChange={(e) => set("company", e.target.value)} autoComplete="organization" />
              </Field>
              <Field label="Correo">
                <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
              </Field>
              <Field label="Teléfono" hint="(opcional)">
                <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
              </Field>
              <Field label="Ciudad" hint="(opcional)">
                <Input value={f.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="Tipo de obra">
                <Select value={f.project_type} onChange={(e) => set("project_type", e.target.value)}>
                  {["Solar fotovoltaica", "Vías", "Edificaciones", "Redes eléctricas", "Movimiento de tierras", "Otra"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="¿Cuántas obras manejan a la vez?" hint="(opcional)">
                <Input inputMode="numeric" value={f.projects} onChange={(e) => set("projects", e.target.value)} />
              </Field>
              <Field label="Cuéntanos qué necesitas" className="md:col-span-2" hint="(opcional)">
                <Textarea rows={3} value={f.message} onChange={(e) => set("message", e.target.value)} />
              </Field>
              {/* Trampa para robots: una persona no ve este campo */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={f.website}
                onChange={(e) => set("website", e.target.value)}
                className="absolute -left-[9999px] h-0 w-0 opacity-0"
              />
              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? "Enviando…" : "Pedir demostración"}
                </Button>
                {error ? (
                  <span role="alert" className="font-semibold text-red-700 dark:text-red-400">
                    {error}
                  </span>
                ) : null}
              </div>
            </form>
          </Card>
        )}
      </main>
    </div>
  );
}
