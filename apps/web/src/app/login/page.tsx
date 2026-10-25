"use client";

import { useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/** Mismo usuario y contraseña que en la app móvil. */
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-extrabold">
          Avance<span className="text-blue-700">Obra</span>
        </h1>
        <p className="mb-5 text-sm text-zinc-500">Administración: formatos, biblioteca y seguimiento.</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Correo">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Contraseña">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
