-- Programación de alertas (ejecutar en Supabase > SQL Editor DESPUÉS de desplegar las Edge Functions).
-- 1) Reemplaza PEGA_AQUI_EL_SECRETO por el mismo valor que pusiste en el secreto DISPATCH_SECRET
--    de las Edge Functions (Edge Functions > Secrets). No lo compartas.
-- 2) Ejecuta. Puedes ver los jobs en Integrations > Cron.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secretos en Vault (cifrados en la base; el job los lee al ejecutarse)
select vault.create_secret('https://jxhewajalkuarupdwwiq.supabase.co', 'project_url');
select vault.create_secret('PEGA_AQUI_EL_SECRETO', 'dispatch_secret');

-- Despacho: cada minuto toma las alertas nuevas y las envía
select cron.schedule('alertas-despacho', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/alerts-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);

-- Pendientes vencidos y por vencer: 6:00 a. m. de Colombia (11:00 UTC)
select cron.schedule('alertas-vencimientos', '0 11 * * *', $$ select generate_finding_due_alerts() $$);

-- Frentes sin reporte del día: 5:00 p. m. de Colombia (22:00 UTC), lunes a sábado
select cron.schedule('alertas-sin-reporte', '0 22 * * 1-6', $$ select generate_no_report_alerts() $$);

-- Verificación
select jobname, schedule, active from cron.job order by jobname;
