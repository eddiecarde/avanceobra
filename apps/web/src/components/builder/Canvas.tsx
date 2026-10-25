"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FIELD_TYPE_LABEL, FIELD_TYPES, type Field, type FieldType } from "@avanceobra/forms";
import { Badge, cx } from "../ui";

const ICON: Record<FieldType, string> = {
  section: "§",
  text: "Aa",
  number: "123",
  select: "▾",
  multiselect: "☑",
  date: "📅",
  checkbox: "✓",
  photo: "📷",
  signature: "✍",
  gps: "📍",
  qr: "⌗",
  formula: "ƒx",
  table: "▦",
};

/** Paleta: se arrastra al lienzo o se agrega al final con un clic. */
export function Palette({ onAdd, disabled }: { onAdd: (t: FieldType) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Tipos de campo</div>
      {FIELD_TYPES.map((t) => (
        <PaletteItem key={t} type={t} onAdd={onAdd} disabled={disabled} />
      ))}
      <p className="pt-2 text-xs text-zinc-500">Arrastra al formato o haz clic para agregar al final.</p>
    </div>
  );
}

function PaletteItem({ type, onAdd, disabled }: { type: FieldType; onAdd: (t: FieldType) => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, disabled });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      disabled={disabled}
      onClick={() => onAdd(type)}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left text-sm font-semibold hover:border-blue-400 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900",
        isDragging && "opacity-50",
      )}
    >
      <span className="w-7 shrink-0 text-center text-xs text-zinc-500">{ICON[type]}</span>
      {FIELD_TYPE_LABEL[type]}
    </button>
  );
}

export function PaletteGhost({ type }: { type: FieldType }) {
  return (
    <div className="rounded-lg border-2 border-blue-500 bg-white px-3 py-2 text-sm font-bold shadow-lg dark:bg-zinc-900">
      {ICON[type]} {FIELD_TYPE_LABEL[type]}
    </div>
  );
}

/** Lienzo ordenable: un renglón por campo. */
export function Canvas({
  fields,
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
  issuesByField,
  readOnly,
}: {
  fields: Field[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  issuesByField: Map<string, string[]>;
  readOnly?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas" });
  return (
    <div
      ref={setNodeRef}
      className={cx("min-h-[300px] space-y-2 rounded-xl border-2 border-dashed p-3 transition", isOver ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30" : "border-transparent")}
    >
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        {fields.map((f) => (
          <SortableRow
            key={f.id}
            field={f}
            selected={f.id === selectedId}
            issues={issuesByField.get(f.id) ?? []}
            onSelect={() => onSelect(f.id)}
            onRemove={() => onRemove(f.id)}
            onDuplicate={() => onDuplicate(f.id)}
            readOnly={readOnly}
          />
        ))}
      </SortableContext>
      {fields.length === 0 ? <div className="py-16 text-center text-zinc-500">Arrastra campos aquí</div> : null}
    </div>
  );
}

function SortableRow({
  field: f,
  selected,
  issues,
  onSelect,
  onRemove,
  onDuplicate,
  readOnly,
}: {
  field: Field;
  selected: boolean;
  issues: string[];
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: f.id, disabled: readOnly });
  const isSection = f.type === "section";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      className={cx(
        "group flex cursor-pointer items-start gap-2 rounded-lg border bg-white p-2.5 dark:bg-zinc-900",
        selected ? "border-blue-600 ring-2 ring-blue-600/20" : issues.length ? "border-red-400" : "border-zinc-200 dark:border-zinc-800",
        isDragging && "z-10 opacity-70 shadow-lg",
        isSection && "bg-zinc-100 dark:bg-zinc-800",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Mover ${f.label}`}
        className="mt-0.5 cursor-grab touch-none rounded px-1 text-zinc-400 hover:bg-zinc-100 active:cursor-grabbing dark:hover:bg-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx("font-semibold", isSection && "text-lg font-extrabold")}>
          {f.label}
          {f.required ? <span className="text-red-600"> *</span> : null}
          {"unit" in f && f.unit ? <span className="ml-1 font-normal text-zinc-500">({f.unit})</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge>{FIELD_TYPE_LABEL[f.type]}</Badge>
          <code className="text-xs text-zinc-500">{f.id}</code>
          {f.showIf ? <Badge tone="amber">condicional</Badge> : null}
          {f.type === "formula" ? <code className="truncate text-xs text-blue-700 dark:text-blue-400">= {f.expression}</code> : null}
          {"tolerance" in f && f.tolerance ? <Badge tone="green">tolerancia</Badge> : null}
          {f.type === "table" ? <Badge tone="blue">{f.columns.length} columnas</Badge> : null}
        </div>
        {issues.length ? <div className="mt-1 text-xs font-semibold text-red-700">⚠ {issues.join(" · ")}</div> : null}
      </div>
      {!readOnly ? (
        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
          <button type="button" className="rounded px-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Duplicar" onClick={(e) => (e.stopPropagation(), onDuplicate())}>
            ⧉
          </button>
          <button type="button" className="rounded px-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950" title="Eliminar" onClick={(e) => (e.stopPropagation(), onRemove())}>
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
