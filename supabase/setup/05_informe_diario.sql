-- Informe diario automático: 6:00 p. m. de Colombia (23:00 UTC), lunes a sábado.
-- Requiere haber ejecutado 04_alertas.sql (usa los secretos project_url y dispatch_secret del Vault)
-- y desplegado la Edge Function daily-report. Se puede ejecutar de nuevo: reemplaza el job.

select cron.unschedule('informe-diario') where exists (select 1 from cron.job where jobname = 'informe-diario');

select cron.schedule('informe-diario', '0 23 * * 1-6', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$);

-- Verificación
select jobname, schedule, active from cron.job order by jobname;
