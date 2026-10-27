/** Planes de la plataforma (los mismos de la función platform-create-company). null = sin límite. */
export const PLANS = {
  prueba: { label: "Prueba", maxProjects: 1, maxUsers: 10, days: 30 },
  basico: { label: "Básico", maxProjects: 1, maxUsers: 15, days: null },
  profesional: { label: "Profesional", maxProjects: 5, maxUsers: 60, days: null },
  empresa: { label: "Empresa", maxProjects: null, maxUsers: null, days: null },
} as const;
export type Plan = keyof typeof PLANS;
