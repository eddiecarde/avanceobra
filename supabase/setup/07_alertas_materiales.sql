-- AvanceObra · alerta de materiales por agotarse (requiere la migración 20261022000029)
-- Todos los días a las 6:35 a. m. de Colombia (11:35 UTC). El despacho por Telegram lo hace el job "alertas-despacho".
select cron.unschedule('alertas-materiales') where exists (select 1 from cron.job where jobname = 'alertas-materiales');
select cron.schedule('alertas-materiales', '35 11 * * *', $$ select generate_material_alerts() $$);
