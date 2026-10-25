"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-2.5 py-1 text-sm" : "px-4 py-2 text-[15px]",
        variant === "primary" && "bg-blue-700 text-white hover:bg-blue-800",
        variant === "secondary" && "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
        variant === "danger" && "bg-red-700 text-white hover:bg-red-800",
        variant === "ghost" && "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        className,
      )}
    />
  );
}

const field =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[15px] text-zinc-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, className)} />;

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
      {children}
      {hint ? <span className="ml-1 font-normal normal-case tracking-normal text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900", className)}>{children}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "neutral" && "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        tone === "blue" && "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
        tone === "green" && "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
        tone === "amber" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        tone === "red" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
      )}
    >
      {children}
    </span>
  );
}

/** Etiqueta + control. El <label> envuelve al control para que quede asociado (lectores de pantalla, clic en la etiqueta). */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        {label}
        {hint ? <span className="ml-1 font-normal normal-case tracking-normal text-zinc-500">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** Descarga un archivo generado en el navegador (JSON, Excel). */
export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { cx };
