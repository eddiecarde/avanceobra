import { computeFormulas, isVisible, type Answers, type AnswerCheck, type ColumnField, type Field, type FormDefinition } from "@avanceobra/forms";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PhotoDraft } from "../services/entries";
import { getFix } from "../services/location";
import { saveSignature } from "../services/photos";
import { todayLocal } from "../services/ids";
import { BigButton, Body, Card, Chips, Input, Label, Row } from "./components";
import { PhotoStrip } from "./PhotoStrip";
import { QrModal } from "./QrModal";
import { SignaturePad } from "./SignaturePad";
import { useTheme } from "./theme";

const fmtNum = (v: unknown, decimals?: number) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("es-CO", { maximumFractionDigits: decimals ?? 4 }) : "—";

const toInput = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const parseNum = (s: string): number | string => {
  const t = s.trim().replace(",", ".");
  if (t === "" || t === "-" || t.endsWith(".")) return s; // se deja escribir "12," o "-"
  const n = Number(t);
  return Number.isFinite(n) ? n : s;
};

export interface DynamicFormProps {
  definition: FormDefinition;
  values: Answers;
  onChange: (values: Answers) => void;
  /** Resultado de validateAnswers; se muestra después del primer intento de guardar. */
  check?: AnswerCheck | null;
  photos: PhotoDraft[];
  onCapturePhoto: (fieldId: string) => Promise<string | null>;
  onRemovePhoto: (id: string) => void;
  /** Para nombrar las firmas de este registro. */
  draftKey: string;
}

/**
 * Formato dinámico: dibuja cualquier formato publicado con botones grandes,
 * lógica condicional y fórmulas recalculadas en vivo. Funciona sin señal.
 */
export function DynamicForm(p: DynamicFormProps) {
  const computed = useMemo(() => computeFormulas(p.definition, p.values), [p.definition, p.values]);
  const set = (id: string, v: unknown) => p.onChange({ ...p.values, [id]: v });

  return (
    <View style={{ gap: 10 }}>
      {p.definition.fields
        .filter((f) => isVisible(f, computed))
        .map((f) => (
          <FieldView key={f.id} field={f} value={computed[f.id]} onChange={(v) => set(f.id, v)} form={p} computed={computed} />
        ))}
    </View>
  );
}

function Feedback({ form, id }: { form: DynamicFormProps; id: string }) {
  const t = useTheme();
  const err = form.check?.errors[id];
  const warn = form.check?.warnings[id];
  if (!err && !warn) return null;
  return <Text style={{ color: err ? t.danger : t.warning, fontSize: 16, fontWeight: "700" }}>{`⚠ ${err ?? warn}`}</Text>;
}

function FieldLabel({ f }: { f: Field | ColumnField }) {
  const unit = "unit" in f && f.unit ? ` (${f.unit})` : "";
  return <Label>{`${f.label}${unit}${f.required ? " *" : ""}`}</Label>;
}

function FieldView({
  field: f,
  value,
  onChange,
  form,
  computed,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  form: DynamicFormProps;
  computed: Answers;
}) {
  const t = useTheme();
  const [qr, setQr] = useState(false);
  const [signing, setSigning] = useState(false);
  const [locating, setLocating] = useState(false);

  if (f.type === "section")
    return <Text style={{ color: t.text, fontSize: 22, fontWeight: "800", marginTop: 8 }}>{f.label}</Text>;

  if (f.type === "table") return <TableView field={f} rows={(value as Answers[]) ?? []} onChange={onChange} form={form} computed={computed} />;

  const body = (() => {
    switch (f.type) {
      case "text":
        return <Input value={toInput(value)} onChangeText={onChange} multiline={f.multiline} style={f.multiline ? { minHeight: 90, textAlignVertical: "top" } : undefined} />;
      case "number":
        return <Input value={toInput(value)} onChangeText={(s) => onChange(parseNum(s))} keyboardType="decimal-pad" />;
      case "select":
        return <Chips options={f.options} value={(value as string) ?? null} onChange={onChange} />;
      case "multiselect": {
        const arr = Array.isArray(value) ? (value as string[]) : [];
        return (
          <Row style={{ flexWrap: "wrap" }}>
            {f.options.map((o) => {
              const on = arr.includes(o.value);
              return (
                <BigButton
                  key={o.value}
                  title={`${on ? "☑" : "☐"} ${o.label}`}
                  variant={on ? "primary" : "secondary"}
                  onPress={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                />
              );
            })}
          </Row>
        );
      }
      case "date":
        return (
          <Row>
            <Input value={toInput(value)} onChangeText={onChange} placeholder="AAAA-MM-DD" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
            <BigButton title="Hoy" onPress={() => onChange(todayLocal())} />
          </Row>
        );
      case "checkbox":
        return (
          <Chips
            options={[
              { value: "si", label: "Sí" },
              { value: "no", label: "No" },
            ]}
            value={value === true ? "si" : value === false ? "no" : null}
            onChange={(v) => onChange(v === "si")}
          />
        );
      case "formula":
        return (
          <Card>
            <Text style={{ color: t.text, fontSize: 28, fontWeight: "800" }}>{`${fmtNum(value, f.decimals)}${f.unit ? ` ${f.unit}` : ""}`}</Text>
            <Body muted>Calculado automáticamente</Body>
          </Card>
        );
      case "photo": {
        const mine = form.photos.filter((ph) => ph.annotation === f.id);
        const max = f.maxPhotos ?? 3;
        return (
          <>
            <BigButton
              title={`📷 Tomar foto (${mine.length}/${max})`}
              disabled={mine.length >= max}
              onPress={async () => {
                const id = await form.onCapturePhoto(f.id);
                if (id) onChange([...((value as string[]) ?? []), id]);
              }}
            />
            <PhotoStrip
              photos={mine}
              onRemove={(id) => {
                form.onRemovePhoto(id);
                onChange(((value as string[]) ?? []).filter((x) => x !== id));
              }}
            />
          </>
        );
      }
      case "signature":
        return (
          <>
            <BigButton title={value ? "✓ Firmado (tocar para repetir)" : "✍ Firmar"} onPress={() => setSigning(true)} />
            <SignaturePad
              visible={signing}
              title={f.label}
              onCancel={() => setSigning(false)}
              onSave={(b64) => {
                onChange(saveSignature(`${form.draftKey}-${f.id}`, b64).uri);
                setSigning(false);
              }}
            />
          </>
        );
      case "gps": {
        const g = value as { lat: number; lon: number; accuracy: number | null } | undefined;
        return (
          <BigButton
            title={g ? `📍 ${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}${g.accuracy ? ` ±${Math.round(g.accuracy)} m` : ""}` : "📍 Capturar ubicación"}
            loading={locating}
            onPress={async () => {
              setLocating(true);
              const fix = await getFix().catch(() => null);
              setLocating(false);
              if (fix) onChange(fix);
            }}
          />
        );
      }
      case "qr":
        return (
          <>
            <Row>
              <Input value={toInput(value)} onChangeText={onChange} placeholder="Código" style={{ flex: 1 }} autoCapitalize="characters" />
              <BigButton title="⌗ Escanear" onPress={() => setQr(true)} />
            </Row>
            <QrModal
              visible={qr}
              onClose={() => setQr(false)}
              onCode={(c) => {
                onChange(c);
                setQr(false);
              }}
            />
          </>
        );
    }
  })();

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel f={f} />
      {f.help ? <Body muted>{f.help}</Body> : null}
      {body}
      <Feedback form={form} id={f.id} />
    </View>
  );
}

/** Tabla repetible: una tarjeta por fila (más legible que columnas en un teléfono). */
function TableView({
  field: f,
  rows,
  onChange,
  form,
  computed,
}: {
  field: Extract<Field, { type: "table" }>;
  rows: Answers[];
  onChange: (rows: Answers[]) => void;
  form: DynamicFormProps;
  computed: Answers;
}) {
  const t = useTheme();
  const [qrRow, setQrRow] = useState<{ row: number; col: string } | null>(null);
  const computedRows = (computed[f.id] as Answers[]) ?? rows;
  const setCell = (i: number, col: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [col]: v } : r)));
  const canAdd = f.maxRows === undefined || rows.length < f.maxRows;

  return (
    <View style={{ gap: 8 }}>
      <FieldLabel f={f} />
      {rows.map((row, i) => (
        <Card key={i} accent={t.primary}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: "800" }}>{`#${i + 1}`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Quitar fila ${i + 1}`} onPress={() => onChange(rows.filter((_, j) => j !== i))} hitSlop={12}>
              <Text style={{ color: t.danger, fontSize: 16, fontWeight: "700" }}>Quitar</Text>
            </Pressable>
          </Row>
          {f.columns.map((c) => {
            const v = computedRows[i]?.[c.id] ?? row[c.id];
            const key = `${f.id}[${i}].${c.id}`;
            return (
              <View key={c.id} style={{ gap: 4 }}>
                <FieldLabel f={c} />
                {c.type === "number" ? (
                  <Input value={toInput(v)} onChangeText={(s) => setCell(i, c.id, parseNum(s))} keyboardType="decimal-pad" />
                ) : c.type === "select" ? (
                  <Chips options={c.options} value={(v as string) ?? null} onChange={(x) => setCell(i, c.id, x)} />
                ) : c.type === "checkbox" ? (
                  <Chips
                    options={[
                      { value: "si", label: "Sí" },
                      { value: "no", label: "No" },
                    ]}
                    value={v === true ? "si" : v === false ? "no" : null}
                    onChange={(x) => setCell(i, c.id, x === "si")}
                  />
                ) : c.type === "formula" ? (
                  <Body>{`${fmtNum(v, c.decimals)}${c.unit ? ` ${c.unit}` : ""}`}</Body>
                ) : c.type === "qr" ? (
                  <Row>
                    <Input value={toInput(v)} onChangeText={(s) => setCell(i, c.id, s)} style={{ flex: 1 }} autoCapitalize="characters" />
                    <BigButton title="⌗" onPress={() => setQrRow({ row: i, col: c.id })} />
                  </Row>
                ) : c.type === "date" ? (
                  <Row>
                    <Input value={toInput(v)} onChangeText={(s) => setCell(i, c.id, s)} placeholder="AAAA-MM-DD" style={{ flex: 1 }} />
                    <BigButton title="Hoy" onPress={() => setCell(i, c.id, todayLocal())} />
                  </Row>
                ) : (
                  <Input value={toInput(v)} onChangeText={(s) => setCell(i, c.id, s)} />
                )}
                <Feedback form={form} id={key} />
              </View>
            );
          })}
        </Card>
      ))}
      {canAdd ? (
        <BigButton
          title={`＋ Agregar ${f.label.toLowerCase()}`}
          onPress={() => {
            // La fila nueva copia los valores de lista de la anterior (p. ej. la misma edad de ensayo)
            const prev = rows[rows.length - 1] ?? {};
            const seed: Answers = {};
            for (const c of f.columns) if (c.type === "select" && prev[c.id] !== undefined) seed[c.id] = prev[c.id];
            onChange([...rows, seed]);
          }}
        />
      ) : null}
      <Feedback form={form} id={f.id} />
      <QrModal
        visible={qrRow !== null}
        onClose={() => setQrRow(null)}
        onCode={(code) => {
          if (qrRow) setCell(qrRow.row, qrRow.col, code);
          setQrRow(null);
        }}
      />
    </View>
  );
}
