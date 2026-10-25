-- Informes que se envían solos: informe semanal en PDF los lunes y resumen corto cada noche.

-- Los informes del servidor agrupan como la web: grupo de trabajo y zona de cada actividad, y la
-- clase e impeditivo de cada hallazgo (para "lo que bloquea")
CREATE OR REPLACE FUNCTION private.dashboard_data(p_project uuid, p_include_findings boolean, p_include_notes boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return jsonb_build_object(
    'project', (select to_jsonb(x) from (
      select id, name, start_date, contract_end_date, workdays, holidays, colombian_holidays from projects where id = p_project) x),
    'activities', coalesce((select jsonb_agg(to_jsonb(x) order by x.code) from (
      select a.id, a.code, a.name, a.unit, a.contract_qty, a.planned_start, a.planned_finish, a.front_id, a.weight, a.work_group, a.subfield,
             jsonb_build_object('code', f.code, 'name', f.name) as front
      from activities a join fronts f on f.id = a.front_id where a.project_id = p_project) x), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(case when p_include_notes then to_jsonb(x) else to_jsonb(x) - 'notes' end order by x.work_date) from (
      select id, activity_id, work_date, quantity, effective_hours, lost_hours, loss_cause, weather, crew_size, status, notes
      from progress_entries where project_id = p_project and status in ('submitted', 'approved')) x), '[]'::jsonb),
    'findings', case when p_include_findings then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id, front_id, type, severity, status, description, lat, lon, due_date, created_at, closed_at, category, impeditive
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
end $function$;


-- Entregas del informe semanal: una por persona, semana y canal (no se repite si el job corre dos veces)
create table weekly_report_deliveries (
  project_id uuid not null references projects(id) on delete cascade,
  week_start date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'email')),
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now(),
  primary key (project_id, week_start, user_id, channel)
);
alter table weekly_report_deliveries enable row level security;
create policy weekly_deliveries_read on weekly_report_deliveries for select using (has_project_role(project_id, '{director,admin}'));
