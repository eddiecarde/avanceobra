"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/** Mi cuenta: cambiar la contraseña (obligatorio la primera vez, si se entró con una temporal). */
export default function Cuenta() {
  const { session } = useSession();
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const mustChange = Boolean(session?.user.user_metadata?.must_change_password);
  const weak = pwd.length > 0 && (pwd.length < 10 || !/[A-Za-z]/.test(pwd) || !/\d/.test(pwd));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (weak || pwd !== again) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd, data: { must_change_password: false } });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setPwd("");
    setAgain("");
    setMsg({ tone: "ok", text: "Contraseña cambiada. Úsala también en la app del teléfono." });
    if (mustChange) router.replace("/dashboard");
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-extrabold">Mi cuenta</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{session?.user.email}</p>
      {mustChange ? (
        <p className="rounded-lg bg-amber-50 px-4 py-2 font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Entraste con una contraseña temporal: crea la tuya para continuar.
        </p>
      ) : null}
      <Card>
        <form onSubmit={(e) => void save(e)} className="space-y-3">
          <Field label="Contraseña nueva" hint="(mín. 10, letras y números)">
            <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" required />
          </Field>
          {weak ? <p className="text-sm font-semibold text-red-700 dark:text-red-400">Debe tener al menos 10 caracteres, con letras y números.</p> : null}
          <Field label="Repítela">
            <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
          </Field>
          {again && pwd !== again ? <p className="text-sm font-semibold text-red-700 dark:text-red-400">No coinciden.</p> : null}
          <Button variant="primary" type="submit" disabled={busy || weak || !pwd || pwd !== again}>
            {busy ? "Guardando…" : "Cambiar contraseña"}
          </Button>
        </form>
        {msg ? <p className={msg.tone === "ok" ? "mt-3 font-semibold text-green-700 dark:text-green-400" : "mt-3 font-semibold text-red-700 dark:text-red-400"}>{msg.text}</p> : null}
      </Card>
    </div>
  );
}
