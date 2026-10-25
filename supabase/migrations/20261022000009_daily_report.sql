-- AvanceObra · informe diario automático (6 p. m., lunes a sábado)
-- La Edge Function daily-report arma el informe de cada proyecto con dashboard_json(), genera el PDF
-- y lo envía por Telegram a residente, director y administrador. daily_report_deliveries evita
-- reenvíos si el job se ejecuta dos veces y deja el rastro de cada envío.

-- Esquema no expuesto por la API (PostgREST solo publica "public")
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/**
 * Datos del dashboard de un proyecto (los mismos que ve el enlace de solo lectura, más las notas
 * de campo para el informe interno). Vive en "private": ningún usuario la llama directamente.
 */
create or replace function private.dashboard_data(p_project uuid, p_include_findings boolean, p_include_notes boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'project', (select to_jsonb(x) from (
      select id, name, start_date, contract_end_date, workdays, holidays from projects where id = p_project) x),
    'activities', coalesce((select jsonb_agg(to_jsonb(x) order by x.code) from (
      select a.id, a.code, a.name, a.unit, a.contract_qty, a.planned_start, a.planned_finish, a.front_id,
             jsonb_build_object('code', f.code, 'name', f.name) as front
      from activities a join fronts f on f.id = a.front_id where a.project_id = p_project) x), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(case when p_include_notes then to_jsonb(x) else to_jsonb(x) - 'notes' end order by x.work_date) from (
      select id, activity_id, work_date, quantity, effective_hours, lost_hours, loss_cause, weather, crew_size, status, notes
      from progress_entries where project_id = p_project and status in ('submitted', 'approved')) x), '[]'::jsonb),
    'findings', case when p_include_findings then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id, front_id, type, severity, status, description, lat, lon, due_date, created_at, closed_at
      from findings where project_id = p_project) x), '[]'::jsonb) else '[]'::jsonb end,
    'elements', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, code, kind, qty, activity_id, geojson from elements where project_id = p_project and geojson is not null) x), '[]'::jsonb),
    'element_links', coalesce((select jsonb_agg(jsonb_build_object(
        'element_id', ee.element_id,
        'entry', jsonb_build_object('activity_id', e.activity_id, 'work_date', e.work_date, 'status', e.status)))
      from entry_elements ee join progress_entries e on e.id = ee.entry_id
      where e.project_id = p_project and e.status in ('submitted', 'approved')), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'geojson', a.geojson, 'area_m2', a.area_m2,
        'entry', jsonb_build_object('activity_id', e.activity_id, 'work_date', e.work_date, 'status', e.status)))
      from progress_areas a join progress_entries e on e.id = a.entry_id
      where e.project_id = p_project and e.status in ('submitted', 'approved')), '[]'::jsonb)
  );
end $$;
revoke all on function private.dashboard_data(uuid, boolean, boolean) from public, anon, authenticated;

/** Puerta para la Edge Function: solo el rol de servicio (o una tarea sin JWT, como pg_cron). */
create or replace function dashboard_json(p_project uuid, p_include_notes boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                                nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
  -- No basta con REVOKE: los privilegios por defecto de Supabase pueden volver a otorgar EXECUTE
  if v_role is not null and v_role <> 'service_role' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return private.dashboard_data(p_project, true, p_include_notes);
end $$;
revoke all on function dashboard_json(uuid, boolean) from public, anon, authenticated;

-- El enlace de solo lectura reutiliza la misma consulta (sin notas)
create or replace function shared_dashboard(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l share_links;
begin
  select * into l from share_links
  where token = p_token and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'Enlace no válido, vencido o revocado' using errcode = 'P0002';
  end if;
  update share_links set view_count = view_count + 1, last_viewed_at = now() where id = l.id;
  return private.dashboard_data(l.project_id, l.include_findings, false)
    || jsonb_build_object('link', jsonb_build_object('label', l.label, 'expires_at', l.expires_at, 'include_findings', l.include_findings));
end $$;
revoke all on function shared_dashboard(text) from public;
grant execute on function shared_dashboard(text) to anon, authenticated;

create table daily_report_deliveries (
  project_id uuid not null references projects(id) on delete cascade,
  report_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'email')),
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now(),
  primary key (project_id, report_date, user_id, channel)
);
alter table daily_report_deliveries enable row level security;
-- La escribe solo la función (service_role); el administrador puede revisar los envíos.
create policy daily_report_read on daily_report_deliveries for select using (has_project_role(project_id, '{admin}'));
