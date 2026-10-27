-- AvanceObra · alertas diarias de seguridad social y SST
-- Documentos obligatorios (PILA, ARL, EPS, examen médico, inducción, alturas) que vencen en los
-- próximos 15 días o ya vencieron. Se despachan por Telegram con el job alertas-despacho.
-- 6:20 a. m. hora de Colombia (11:20 UTC).
select cron.unschedule('alertas-sst') where exists (select 1 from cron.job where jobname = 'alertas-sst');
select cron.schedule('alertas-sst', '20 11 * * *', $$ select generate_compliance_alerts() $$);
