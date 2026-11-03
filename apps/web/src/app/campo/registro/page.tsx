"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FieldApp } from "@/components/field/FieldApp";

function Registro() {
  const a = useSearchParams().get("a");
  return <FieldApp start={a ? { v: "registro", a } : { v: "inicio" }} />;
}

export default function RegistroCampoPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Registro />
    </Suspense>
  );
}
