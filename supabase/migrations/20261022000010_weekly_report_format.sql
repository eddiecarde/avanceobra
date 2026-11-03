-- AvanceObra · formato de informe semanal del cliente (p. ej. Helios, CNX-PSS-001)
-- 1. Ponderación: cada actividad pesa en el avance general según su peso (en el formato, % del valor).
-- 2. Calendario: los festivos de Colombia se pueden desactivar (el formato del cliente solo descuenta domingos).
-- 3. Cabecera del informe: a quién se reporta, quién reporta, contrato, código del formato y firmas.

alter table activities add column weight numeric(9,6) check (weight is null or (weight >= 0 and weight <= 1));
comment on column activities.weight is 'Fracción del avance general (0–1). Si ninguna actividad tiene peso, todas pesan igual.';

alter table projects add column colombian_holidays boolean not null default true;
alter table projects add column client_name text;          -- "Nombre a quien se le reporta"
alter table projects add column contractor_name text;      -- "Reporta"
alter table projects add column contract_code text;        -- p. ej. CNX-PSS-CIV-001
alter table projects add column report_code text;          -- código del formato, p. ej. CNX-PSS-001
alter table projects add column report_signers text[] not null
  default '{"Residente de obra","Director de obra","Interventoría"}';

-- Los datos del dashboard incluyen ahora el peso y el calendario
create or replace function private.dashboard_data(p_project uuid, p_include_findings boolean, p_include_notes boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'project', (select to_jsonb(x) from (
      select id, name, start_date, contract_end_date, workdays, holidays, colombian_holidays from projects where id = p_project) x),
    'activities', coalesce((select jsonb_agg(to_jsonb(x) order by x.code) from (
      select a.id, a.code, a.name, a.unit, a.contract_qty, a.planned_start, a.planned_finish, a.front_id, a.weight,
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

-- Solo el administrador cambia pesos, calendario y cabecera (las políticas de projects y activities ya lo exigen)
