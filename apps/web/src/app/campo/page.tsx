import { FieldApp } from "@/components/field/FieldApp";

/** Registrar en campo (web instalable): la página de entrada al instalarla en el teléfono. */
export default function CampoPage() {
  return <FieldApp start={{ v: "inicio" }} />;
}
