-- AvanceObra · avisos de vencimiento en el teléfono (requiere la migración 20261023000031)
-- Todos los días a las 6:10 a. m. de Colombia (11:10 UTC): hallazgos que vencen hoy o ya vencieron, a su responsable.
select cron.unschedule('avisos-vencimientos') where exists (select 1 from cron.job where jobname = 'avisos-vencimientos');
select cron.schedule('avisos-vencimientos', '10 11 * * *', $$ select generate_due_notifications() $$);
