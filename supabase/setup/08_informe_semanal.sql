-- Informe semanal automático en PDF: lunes 7:00 a. m. de Colombia (12:00 UTC), de la semana anterior.
-- Requiere haber ejecutado 04_alertas.sql (usa los secretos project_url y dispatch_secret del Vault)
-- y desplegado la Edge Function weekly-report (con --no-verify-jwt). Se puede ejecutar de nuevo: reemplaza el job.

select cron.unschedule('informe-semanal') where exists (select 1 from cron.job where jobname = 'informe-semanal');

select cron.schedule('informe-semanal', '0 12 * * 1', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$);

-- Verificación
select jobname, schedule, active from cron.job order by jobname;
