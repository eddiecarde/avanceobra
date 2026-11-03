import { defineConfig } from "vitest/config";

// Solo la lógica pura (src/core): no depende de React Native ni de módulos nativos.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
