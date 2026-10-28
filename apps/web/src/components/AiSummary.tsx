"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { callAi } from "@/lib/ai";

/** Resumen ejecutivo que escribe Muse Spark (Meta) solo con las cifras que calculó el motor. */
export function AiSummary({ projectId, title, facts, onClose }: { projectId: string; title: string; facts: Record<string, unknown>; onClose: () => void }) {
  const [state, setState] = useState<{ text: string; ungrounded: number[] } | { error: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [round, setRound] = useState(0);
  const factsJson = JSON.stringify(facts);

  useEffect(() => {
    let off = false;
    void callAi<{ text: string; ungrounded: number[] }>("summary", { project_id: projectId, facts: JSON.parse(factsJson) }).then(
      (r) => !off && setState(r.data === null ? { error: r.error } : r.data),
    );
    return () => {
      off = true;
    };
  }, [projectId, factsJson, round]);
  const run = () => {
    setState(null);
    setCopied(false);
    setRound((n) => n + 1);
  };

  return (
    <Card className="border-l-4 border-l-blue-600">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">Resumen ejecutivo · {title}</h2>
        {state && "text" in state ? (
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(state.text).then(() => setCopied(true))}>
            {copied ? "Copiado" : "Copiar"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={run} disabled={!state}>
          Otra versión
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      {!state ? (
        <p className="text-zinc-500" role="status">
          Muse Spark está escribiendo el resumen con las cifras del tablero…
        </p>
      ) : "error" in state ? (
        <p role="alert" className="font-semibold text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : (
        <>
          <div className="whitespace-pre-wrap leading-relaxed">{state.text}</div>
          {state.ungrounded.length ? (
            <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Ojo: el resumen menciona cifras que no están en el tablero ({state.ungrounded.join("; ")}). Verifícalas antes de enviarlo.
            </p>
          ) : null}
        </>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Escrito por Muse Spark (Meta) solo con las cifras de esta tabla: el atraso, la multa y la decisión de acelerar los calcula el motor de AvanceObra, no la IA.
        Si aparece una cifra que no está en los datos, se avisa.
      </p>
    </Card>
  );
}
