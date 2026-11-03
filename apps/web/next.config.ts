import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las pruebas de punta a punta compilan en otra carpeta para no pisar el servidor de desarrollo
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Panel de administración: todo se carga en el cliente con la sesión del usuario (RLS),
  // así que no se usa el prerenderizado de Cache Components.
  // El service worker siempre fresco (si no, una versión vieja seguiría sirviendo la app)
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
