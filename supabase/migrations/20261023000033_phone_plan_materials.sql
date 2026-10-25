-- AvanceObra · el teléfono recibe el plan semanal comprometido (lo que toca hoy) y los materiales,
-- y registra entregas de material sin señal.
alter publication powersync add table weekly_plans, weekly_plan_items, materials, material_deliveries;
