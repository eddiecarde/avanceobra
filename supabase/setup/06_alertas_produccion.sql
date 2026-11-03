-- AvanceObra · alertas tempranas de producción (requiere la migración 20261022000019)
-- Todos los días a las 6:30 a. m. de Colombia (11:30 UTC): productividad que cae más del 20 %,
-- restricciones acumuladas o vencidas y terminación en riesgo. El despacho por Telegram lo hace el
-- job "alertas-despacho" (residente y administrador las reciben).
select cron.unschedule('alertas-produccion') where exists (select 1 from cron.job where jobname = 'alertas-produccion');
select cron.schedule('alertas-produccion', '30 11 * * *', $$ select generate_production_alerts() $$);
