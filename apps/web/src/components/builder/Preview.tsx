"use client";

import { computeFormulas, isVisible, validateAnswers, type Answers, type ColumnField, type Field, type FormDefinition } from "@avanceobra/forms";
import { useMemo, useState } from "react";
import { Button, Input, Label, Select } from "../ui";

const fmt = (v: unknown, d?: number) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("es-CO", { maximumFractionDigits: d ?? 4 }) : "—");
const parse = (s: string) => {
  const n = Number(s.replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : s;
};

/** Vista previa interactiva: se llena como en el teléfono para probar fórmulas, condiciones y validaciones. */
export function Preview({ definition }: { definition: FormDefinition }) {
  const [values, setValues] = useState<Answers>({});
  const computed = useMemo(() => {
    try {
      return computeFormulas(definition, values);
    } catch {
      return values;
    }
  }, [definition, values]);
  const check = useMemo(() => {
    try {
      return validateAnswers(definition, values);
    } catch {
      return null;
    }
  }, [definition, values]);
  const set = (id: string, v: unknown) => setValues((x) => ({ ...x, [id]: v }));

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-[28px] border-8 border-zinc-800 bg-white p-4 dark:bg-zinc-950">
      <div className="text-center text-xs font-bold uppercase tracking-wide text-zinc-500">Vista previa · como en el teléfono</div>
      {definition.fields
        .filter((f) => isVisible(f, computed))
        .map((f) =>
          f.type === "section" ? (
            <h3 key={f.id} className="pt-2 text-xl font-extrabold">
              {f.label}
            </h3>
          ) : (
            <div key={f.id}>
              <Label>{`${f.label}${"unit" in f && f.unit ? ` (${f.unit})` : ""}${f.required ? " *" : ""}`}</Label>
              {f.help ? <p className="mb-1 text-sm text-zinc-500">{f.help}</p> : null}
              {f.type === "table" ? (
                <TablePreview f={f} rows={(values[f.id] as Answers[]) ?? []} computedRows={(computed[f.id] as Answers[]) ?? []} onChange={(r) => set(f.id, r)} check={check} />
              ) : (
                <Control f={f} value={computed[f.id]} raw={values[f.id]} onChange={(v) => set(f.id, v)} />
              )}
              {check?.errors[f.id] ? <p className="mt-1 text-sm font-bold text-red-700">⚠ {check.errors[f.id]}</p> : null}
              {check?.warnings[f.id] ? <p className="mt-1 text-sm font-bold text-amber-700">⚠ {check.warnings[f.id]}</p> : null}
            </div>
          ),
        )}
      <div className="flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <span className={check?.ok ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
          {check ? (check.ok ? "✓ Se puede guardar" : `${Object.keys(check.errors).length} campo(s) por corregir`) : "Formato con errores"}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setValues({})}>
          Limpiar
        </Button>
      </div>
    </div>
  );
}

function Control({ f, value, raw, onChange }: { f: Field | ColumnField; value: unknown; raw: unknown; onChange: (v: unknown) => void }) {
  switch (f.type) {
    case "number":
      return <Input inputMode="decimal" value={raw === undefined ? "" : String(raw)} onChange={(e) => onChange(parse(e.target.value))} />;
    case "select":
      return (
        <Select value={String(raw ?? "")} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "multiselect":
      return (
        <div className="flex flex-wrap gap-2">
          {f.options.map((o) => {
            const arr = (raw as string[]) ?? [];
            const on = arr.includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-1">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} />
                {o.label}
              </label>
            );
          })}
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={raw === true} onChange={(e) => onChange(e.target.checked)} /> Sí
        </label>
      );
    case "date":
      return <Input type="date" value={String(raw ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "formula":
      return <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xl font-extrabold dark:bg-zinc-800">{`${fmt(value, f.decimals)}${f.unit ? ` ${f.unit}` : ""}`}</div>;
    case "photo":
      return <Button size="sm" onClick={() => onChange(["foto-demo"])}>{raw ? "📷 1 foto" : "📷 Tomar foto"}</Button>;
    case "signature":
      return <Button size="sm" onClick={() => onChange("firma-demo")}>{raw ? "✓ Firmado" : "✍ Firmar"}</Button>;
    case "gps":
      return <Button size="sm" onClick={() => onChange({ lat: 9.95, lon: -73.65, accuracy: 4 })}>{raw ? "📍 9.950000, -73.650000" : "📍 Capturar ubicación"}</Button>;
    default:
      return <Input value={String(raw ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

function TablePreview({
  f,
  rows,
  computedRows,
  onChange,
  check,
}: {
  f: Extract<Field, { type: "table" }>;
  rows: Answers[];
  computedRows: Answers[];
  onChange: (r: Answers[]) => void;
  check: ReturnType<typeof validateAnswers> | null;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
          <div className="flex justify-between text-sm font-bold">
            #{i + 1}
            <button className="text-red-700" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
          {f.columns.map((c) => {
            const key = `${f.id}[${i}].${c.id}`;
            return (
              <div key={c.id}>
                <Label>{`${c.label}${"unit" in c && c.unit ? ` (${c.unit})` : ""}`}</Label>
                <Control f={c} value={computedRows[i]?.[c.id]} raw={r[c.id]} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.id]: v } : x)))} />
                {check?.errors[key] ? <p className="text-sm font-bold text-red-700">⚠ {check.errors[key]}</p> : null}
                {check?.warnings[key] ? <p className="text-sm font-bold text-amber-700">⚠ {check.warnings[key]}</p> : null}
              </div>
            );
          })}
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...rows, {}])}>
        ＋ Agregar fila
      </Button>
    </div>
  );
}
