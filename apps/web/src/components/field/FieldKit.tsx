"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { listQueue, onQueueChange, processQueue, type QueueItem } from "@/lib/field";
import { isInstalledApp } from "@/lib/pwa";

/** Botón grande para usar con guantes y una mano. */
export function BigLink({ href, children, tone = "default" }: { href: string; children: ReactNode; tone?: "primary" | "default" }) {
  return (
    <Link
      href={href}
      className={cx(
        "block rounded-xl border-2 px-4 py-4 text-lg font-bold",
        tone === "primary" ? "border-[#1f3a5f] bg-[#1f3a5f] text-white" : "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
      )}
    >
      {children}
    </Link>
  );
}

export function BigButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-xl border-2 border-zinc-300 bg-white px-4 py-4 text-left text-lg font-bold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
      {children}
    </button>
  );
}

/** Cuánto falta por subir; sube solo al volver la señal y cada 30 s mientras la app está abierta. */
export function QueueStatus() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    const refresh = () => void listQueue().then((xs) => !off && setItems(xs));
    const sync = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void processQueue();
    };
    refresh();
    sync();
    const unsub = onQueueChange(refresh);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const t = setInterval(sync, 30_000);
    return () => {
      off = true;
      unsub();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      clearInterval(t);
    };
  }, []);

  const errors = items.filter((i) => i.error && i.error !== "Sin señal");
  if (!items.length)
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" role="status">
        ✓ Todo lo registrado aquí ya lo recibió el servidor{online ? "" : " · ahora estás sin señal"}.
      </p>
    );
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950 dark:bg-amber-950 dark:text-amber-100" role="status">
      <div className="font-bold">
        📱 {items.length} pendiente(s) guardado(s) en este teléfono{online ? "" : " · sin señal"}
      </div>
      <ul className="mt-1 text-sm">
        {items.slice(0, 5).map((i) => (
          <li key={i.id}>
            {i.label}
            {i.photos.length ? ` · ${i.photos.length - i.done.length} foto(s) por subir` : ""}
            {i.error ? <span className="font-semibold"> · {i.error}</span> : null}
          </li>
        ))}
      </ul>
      {errors.length ? <p className="mt-1 text-sm font-semibold">Si un error se repite, avísale al residente con el texto que aparece.</p> : null}
      <button
        type="button"
        disabled={busy || !online}
        onClick={() => {
          setBusy(true);
          void processQueue().finally(() => setBusy(false));
        }}
        className="mt-2 rounded-lg border-2 border-amber-700 px-3 py-1.5 font-bold disabled:opacity-50"
      >
        {busy ? "Subiendo…" : "Subir ahora"}
      </button>
    </div>
  );
}

/** Cómo instalarla: botón en Android/Chrome; pasos de Safari en iPhone. Se oculta si ya está instalada. */
export function InstallHint() {
  const [prompt, setPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const mode = useSyncExternalStore(
    () => () => undefined,
    () => (isInstalledApp() ? "instalada" : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "otro"),
    () => "instalada",
  );
  const state = { standalone: mode === "instalada", ios: mode === "ios" };
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as unknown as { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (state.standalone) return null;
  if (prompt)
    return (
      <button type="button" onClick={() => void prompt.prompt()} className="w-full rounded-xl border-2 border-dashed border-[#1f3a5f] px-4 py-3 text-left font-bold text-[#1f3a5f] dark:text-blue-300">
        ⬇ Instalar AvanceObra en este teléfono (sin tienda de apps)
      </button>
    );
  return (
    <details className="rounded-xl border-2 border-dashed border-zinc-300 px-4 py-3 text-sm dark:border-zinc-700">
      <summary className="cursor-pointer font-bold">⬇ Instalar en este teléfono (sin tienda de apps)</summary>
      {state.ios ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Ábrela en Safari.</li>
          <li>Toca el botón Compartir (el cuadro con la flecha hacia arriba).</li>
          <li>Elige «Agregar a pantalla de inicio» y luego «Agregar».</li>
        </ol>
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Ábrela en Chrome.</li>
          <li>Toca el menú ⋮ (arriba a la derecha).</li>
          <li>Elige «Instalar app» o «Agregar a la pantalla principal».</li>
        </ol>
      )}
    </details>
  );
}

/** Fila − cantidad + para contar personal o equipos. */
export function Counter({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const btn = "h-12 w-12 shrink-0 rounded-full border-2 border-zinc-300 text-2xl font-bold dark:border-zinc-600";
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={cx("flex-1 text-base", value > 0 && "font-bold")}>{label}</span>
      <button type="button" aria-label={`Restar ${label}`} className={btn} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <input
        inputMode="numeric"
        aria-label={`Cantidad de ${label}`}
        value={String(value)}
        onChange={(e) => onChange(Math.max(0, Math.min(9999, Number(e.target.value.replace(/\D/g, "")) || 0)))}
        className="h-12 w-16 rounded-lg border-2 border-zinc-300 bg-white text-center text-xl font-bold dark:border-zinc-600 dark:bg-zinc-900"
      />
      <button type="button" aria-label={`Sumar ${label}`} className={btn} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export const chip = (on: boolean) =>
  cx(
    "rounded-full border-2 px-4 py-2 text-base font-semibold",
    on ? "border-[#1f3a5f] bg-[#1f3a5f] text-white" : "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
  );

export const fieldInput = "w-full rounded-lg border-2 border-zinc-300 bg-white px-3 py-3 text-lg dark:border-zinc-600 dark:bg-zinc-900";
