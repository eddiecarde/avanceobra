"use client";

import { useState } from "react";
import { FieldEntry } from "./FieldEntry";
import { FieldFinding } from "./FieldFinding";
import { FieldHome } from "./FieldHome";
import { FieldLog } from "./FieldLog";

export type View = { v: "inicio"; saved?: string } | { v: "registro"; a: string } | { v: "parte" } | { v: "hallazgo" };
export type Go = (view: View) => void;

/**
 * Campo en el navegador (web instalable): registrar avance, parte diario y hallazgos desde cualquier
 * teléfono, iPhone o Android, sin instalar la app de la tienda. Las pantallas cambian dentro de la
 * misma página (sin pedir nada al servidor), así que una vez abierta funciona completa sin señal:
 * guarda en el teléfono y sube sola al volver la señal.
 */
export function FieldApp({ start }: { start: View }) {
  const [view, setView] = useState<View>(start);
  const go: Go = (v) => {
    setView(v);
    window.scrollTo(0, 0);
  };
  if (view.v === "registro") return <FieldEntry key={view.a} go={go} activityId={view.a} />;
  if (view.v === "parte") return <FieldLog go={go} />;
  if (view.v === "hallazgo") return <FieldFinding go={go} />;
  return <FieldHome go={go} saved={view.saved} />;
}
