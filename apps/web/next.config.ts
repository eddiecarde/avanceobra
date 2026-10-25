import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las pruebas de punta a punta compilan en otra carpeta para no pisar el servidor de desarrollo
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Panel de administración: todo se carga en el cliente con la sesión del usuario (RLS),
  // así que no se usa el prerenderizado de Cache Components.
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
