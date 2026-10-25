"use client";

import {
  evaluateFormula,
  FIELD_TYPE_LABEL,
  FormulaError,
  parseFormula,
  slugId,
  type ColumnField,
  type Condition,
  type ConditionOp,
  type Field,
  type Option,
} from "@avanceobra/forms";
import { useState } from "react";
import { Button, Field as FormRow, Input, Select, Textarea } from "../ui";

type AnyField = Field | ColumnField;
type Patch = (p: Record<string, unknown>) => void;

const OPS: { value: ConditionOp; label: string }[] = [
  { value: "eq", label: "es igual a" },
  { value: "neq", label: "es distinto de" },
  { value: "gt", label: "es mayor que" },
  { value: "gte", label: "es mayor o igual a" },
  { value: "lt", label: "es menor que" },
  { value: "lte", label: "es menor o igual a" },
  { value: "truthy", label: "está marcado / tiene valor" },
  { value: "falsy", label: "está vacío / no marcado" },
];

const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));

/** Panel derecho: propiedades del campo seleccionado. */
export function Properties({
  field,
  previous,
  allIds,
  onChange,
  onRename,
}: {
  field: Field;
  /** Campos anteriores (para condiciones) */
  previous: Field[];
  allIds: string[];
  onChange: (f: Field) => void;
  onRename: (oldId: string, newId: string) => void;
}) {
  const patch: Patch = (p) => onChange({ ...field, ...p } as Field);
  const [idDraft, setIdDraft] = useState(field.id);
  const [lastId, setLastId] = useState(field.id);
  if (lastId !== field.id) {
    setLastId(field.id);
    setIdDraft(field.id);
  }

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">{FIELD_TYPE_LABEL[field.type]}</div>
      <FormRow label="Etiqueta">
        <Input value={field.label} onChange={(e) => patch({ label: e.target.value })} />
      </FormRow>
      <FormRow label="Identificador" hint="(se usa en fórmulas y condiciones)">
        <div className="flex gap-2">
          <Input value={idDraft} onChange={(e) => setIdDraft(e.target.value)} className="font-mono text-sm" />
          <Button
            size="sm"
            disabled={idDraft === field.id}
            onClick={() => {
              const clean = slugId(idDraft, allIds.filter((x) => x !== field.id));
              onRename(field.id, clean);
              setIdDraft(clean);
            }}
          >
            Aplicar
          </Button>
        </div>
      </FormRow>
      {field.type !== "section" ? (
        <>
          <FormRow label="Ayuda" hint="(opcional, se ve debajo de la etiqueta)">
            <Input value={field.help ?? ""} onChange={(e) => patch({ help: e.target.value || undefined })} />
          </FormRow>
          {field.type !== "formula" ? (
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => patch({ required: e.target.checked || undefined })} />
              Obligatorio
            </label>
          ) : null}
        </>
      ) : null}

      <TypeSpecific field={field} patch={patch} allIds={allIds} />

      {field.type !== "section" ? <ConditionEditor value={field.showIf} previous={previous} onChange={(c) => patch({ showIf: c })} /> : null}
    </div>
  );
}

function TypeSpecific({ field: f, patch, allIds }: { field: AnyField; patch: Patch; allIds: string[] }) {
  switch (f.type) {
    case "text":
      return (
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={Boolean(f.multiline)} onChange={(e) => patch({ multiline: e.target.checked || undefined })} />
            Varias líneas
          </label>
          <FormRow label="Máx. caracteres">
            <Input type="number" value={f.maxLength ?? ""} onChange={(e) => patch({ maxLength: num(e.target.value) })} />
          </FormRow>
        </div>
      );
    case "number":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Unidad">
              <Input value={f.unit ?? ""} onChange={(e) => patch({ unit: e.target.value || undefined })} placeholder="m³, pilotes, °C…" />
            </FormRow>
            <FormRow label="Decimales">
              <Input type="number" min={0} max={6} value={f.decimals ?? ""} onChange={(e) => patch({ decimals: num(e.target.value) })} />
            </FormRow>
            <FormRow label="Mínimo" hint="(bloquea)">
              <Input value={f.min ?? ""} onChange={(e) => patch({ min: num(e.target.value) })} />
            </FormRow>
            <FormRow label="Máximo" hint="(bloquea)">
              <Input value={f.max ?? ""} onChange={(e) => patch({ max: num(e.target.value) })} />
            </FormRow>
          </div>
          <ToleranceEditor value={f.tolerance} unit={f.unit} onChange={(t) => patch({ tolerance: t })} />
        </div>
      );
    case "select":
    case "multiselect":
      return <OptionsEditor options={f.options} onChange={(o) => patch({ options: o })} />;
    case "photo":
      return (
        <FormRow label="Máximo de fotos">
          <Select value={f.maxPhotos ?? 3} onChange={(e) => patch({ maxPhotos: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </FormRow>
      );
    case "formula":
      return (
        <div className="space-y-3">
          <FormulaEditor expression={f.expression} allIds={allIds.filter((x) => x !== f.id)} onChange={(e) => patch({ expression: e })} />
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Unidad">
              <Input value={f.unit ?? ""} onChange={(e) => patch({ unit: e.target.value || undefined })} />
            </FormRow>
            <FormRow label="Decimales">
              <Input type="number" min={0} max={6} value={f.decimals ?? ""} onChange={(e) => patch({ decimals: num(e.target.value) })} />
            </FormRow>
          </div>
          <ToleranceEditor value={f.tolerance} unit={f.unit} onChange={(t) => patch({ tolerance: t })} />
        </div>
      );
    case "table":
      return <ColumnsEditor field={f} patch={patch} />;
    default:
      return null;
  }
}

function ToleranceEditor({ value, unit, onChange }: { value?: { target: number; minus: number; plus: number }; unit?: string; onChange: (v?: { target: number; minus: number; plus: number }) => void }) {
  if (!value)
    return (
      <Button size="sm" onClick={() => onChange({ target: 0, minus: 0, plus: 0 })}>
        ＋ Tolerancia (advierte sin bloquear)
      </Button>
    );
  const set = (k: "target" | "minus" | "plus", s: string) => onChange({ ...value, [k]: num(s) ?? 0 });
  return (
    <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/40">
      <div className="mb-2 text-sm font-semibold">
        Tolerancia: {value.target - value.minus} a {value.target + value.plus} {unit}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FormRow label="Objetivo">
          <Input value={value.target} onChange={(e) => set("target", e.target.value)} />
        </FormRow>
        <FormRow label="− Menos">
          <Input value={value.minus} onChange={(e) => set("minus", e.target.value)} />
        </FormRow>
        <FormRow label="＋ Más">
          <Input value={value.plus} onChange={(e) => set("plus", e.target.value)} />
        </FormRow>
      </div>
      <button className="mt-2 text-sm text-red-700 underline" onClick={() => onChange(undefined)}>
        Quitar tolerancia
      </button>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: Option[]; onChange: (o: Option[]) => void }) {
  return (
    <FormRow label="Opciones">
      <div className="space-y-1.5">
        {options.map((o, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              value={o.label}
              onChange={(e) => {
                const label = e.target.value;
                const value = slugId(label, options.filter((_, j) => j !== i).map((x) => x.value));
                onChange(options.map((x, j) => (j === i ? { label, value } : x)));
              }}
            />
            <Button size="sm" variant="ghost" disabled={options.length <= 1} onClick={() => onChange(options.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
        <Button size="sm" onClick={() => onChange([...options, { label: `Opción ${options.length + 1}`, value: slugId(`opcion ${options.length + 1}`, options.map((x) => x.value)) }])}>
          ＋ Opción
        </Button>
      </div>
    </FormRow>
  );
}

/** Fórmula con validación en vivo y prueba con valores de ejemplo (todos = 2). */
function FormulaEditor({ expression, allIds, onChange }: { expression: string; allIds: string[]; onChange: (e: string) => void }) {
  let status: { ok: boolean; text: string };
  try {
    parseFormula(expression);
    const sample = Object.fromEntries(allIds.map((id) => [id, 2]));
    const v = evaluateFormula(expression, sample);
    status = { ok: true, text: Number.isFinite(v) ? `✓ Con todos los campos en 2 da ${Math.round(v * 1000) / 1000}` : "✓ Fórmula válida" };
  } catch (e) {
    status = { ok: false, text: e instanceof FormulaError ? e.message : String(e) };
  }
  return (
    <FormRow label="Fórmula">
      <Textarea rows={2} value={expression} onChange={(e) => onChange(e.target.value)} className="font-mono text-sm" />
      <div className={status.ok ? "mt-1 text-sm text-green-700 dark:text-green-400" : "mt-1 text-sm font-semibold text-red-700"}>{status.text}</div>
      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer">Campos y funciones disponibles</summary>
        <div className="mt-1 font-mono">{allIds.join(", ") || "—"}</div>
        <div className="mt-1">
          + − * / ^, comparaciones, min, max, abs, round(x, n), sqrt, if(cond, a, b), sum(tabla.col), avg(tabla.col), count(tabla), minof, maxof
        </div>
      </details>
    </FormRow>
  );
}

/** Condición simple "mostrar si <campo> <operador> <valor>"; las compuestas se conservan como JSON. */
function ConditionEditor({ value, previous, onChange }: { value?: Condition; previous: Field[]; onChange: (c?: Condition) => void }) {
  const candidates = previous.filter((f) => f.type !== "section" && f.type !== "table" && f.type !== "photo" && f.type !== "signature");
  if (value && !("field" in value))
    return (
      <FormRow label="Mostrar solo si (condición compuesta)">
        <code className="block rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">{JSON.stringify(value)}</code>
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
          Quitar condición
        </Button>
      </FormRow>
    );
  if (!value)
    return (
      <Button size="sm" disabled={candidates.length === 0} onClick={() => onChange({ field: candidates[candidates.length - 1]!.id, op: "truthy" })}>
        ＋ Mostrar solo si… (lógica condicional)
      </Button>
    );
  const src = candidates.find((f) => f.id === value.field);
  const needsValue = value.op !== "truthy" && value.op !== "falsy";
  return (
    <div className="space-y-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40">
      <div className="text-sm font-semibold">Mostrar solo si</div>
      <Select value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })}>
        {candidates.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </Select>
      <Select value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as ConditionOp })}>
        {OPS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {needsValue ? (
        src && (src.type === "select" || src.type === "multiselect") ? (
          <Select value={String(value.value ?? "")} onChange={(e) => onChange({ ...value, value: e.target.value })}>
            <option value="">—</option>
            {src.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={String(value.value ?? "")} onChange={(e) => onChange({ ...value, value: num(e.target.value) ?? e.target.value })} placeholder="valor" />
        )
      ) : null}
      <button className="text-sm text-red-700 underline" onClick={() => onChange(undefined)}>
        Quitar condición
      </button>
    </div>
  );
}

const COLUMN_TYPES = ["text", "number", "select", "date", "checkbox", "qr", "formula"] as const;

/** Columnas de una tabla repetible (edición compacta). */
function ColumnsEditor({ field, patch }: { field: Extract<Field, { type: "table" }>; patch: Patch }) {
  const cols = field.columns;
  const setCol = (i: number, c: Record<string, unknown>) => patch({ columns: cols.map((x, j) => (j === i ? ({ ...x, ...c } as ColumnField) : x)) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Mín. filas">
          <Input type="number" value={field.minRows ?? ""} onChange={(e) => patch({ minRows: num(e.target.value) })} />
        </FormRow>
        <FormRow label="Máx. filas">
          <Input type="number" value={field.maxRows ?? ""} onChange={(e) => patch({ maxRows: num(e.target.value) })} />
        </FormRow>
      </div>
      <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">Columnas</div>
      {cols.map((c, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="flex gap-1.5">
            <Input
              value={c.label}
              onChange={(e) =>
                setCol(i, { label: e.target.value, id: slugId(e.target.value, cols.filter((_, j) => j !== i).map((x) => x.id)) })
              }
            />
            <Select
              value={c.type}
              className="w-36"
              onChange={(e) => {
                const type = e.target.value;
                const base = { id: c.id, label: c.label, type };
                setCol(i, type === "select" ? { ...base, options: [{ value: "opcion_1", label: "Opción 1" }] } : type === "formula" ? { ...base, expression: "0" } : base);
              }}
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" disabled={cols.length <= 1} onClick={() => patch({ columns: cols.filter((_, j) => j !== i) })}>
              ✕
            </Button>
          </div>
          <code className="text-xs text-zinc-500">{c.id}</code>
          {c.type === "number" || c.type === "formula" ? (
            <Input value={c.unit ?? ""} placeholder="Unidad" onChange={(e) => setCol(i, { unit: e.target.value || undefined })} />
          ) : null}
          {c.type === "select" ? (
            <Input
              value={c.options.map((o) => o.label).join("; ")}
              placeholder="Opciones separadas por ;"
              onChange={(e) =>
                setCol(i, {
                  options: e.target.value
                    .split(";")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((label, k, arr) => ({ label, value: slugId(label, arr.slice(0, k).map((x) => slugId(x, []))) })),
                })
              }
            />
          ) : null}
          {c.type === "formula" ? (
            <Input className="font-mono text-sm" value={c.expression} onChange={(e) => setCol(i, { expression: e.target.value })} placeholder="ej. largo * ancho" />
          ) : null}
        </div>
      ))}
      <Button
        size="sm"
        onClick={() => patch({ columns: [...cols, { id: slugId("columna", cols.map((c) => c.id)), label: "Columna", type: "text" } as ColumnField] })}
      >
        ＋ Columna
      </Button>
    </div>
  );
}
