import type { MetadataRoute } from "next";

/** Web instalable (PWA): se agrega a la pantalla de inicio del iPhone o Android y abre como una app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AvanceObra",
    short_name: "AvanceObra",
    description: "Avance de obra desde el campo, aun sin señal: registros con foto y GPS, parte diario, hallazgos e informes.",
    lang: "es-CO",
    start_url: "/campo",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1f3a5f",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Registrar avance", url: "/campo" },
      { name: "Parte diario", url: "/campo/parte" },
      { name: "Reportar hallazgo", url: "/campo/hallazgo" },
    ],
  };
}
