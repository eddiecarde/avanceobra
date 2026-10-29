-- Varias causas de pérdida de tiempo en un mismo registro de avance (2 h Clima, 1 h Material…).
-- losses guarda el detalle; lost_hours y loss_cause se mantienen calculados (suma de horas y causa
-- con más horas), así lo que ya lee esas columnas sigue funcionando, también teléfonos sin actualizar.

alter table progress_entries add column losses jsonb not null default '[]';

create or replace function private.entry_losses_normalize() returns trigger language plpgsql set search_path = public as $$
declare it jsonb; total numeric := 0; top_cause text := 'none'; top_hours numeric := -1; merged jsonb := '[]';
begin
  if jsonb_typeof(new.losses) <> 'array' then
    raise exception 'Pérdidas de tiempo mal formadas: deben ser una lista';
  end if;
  -- Teléfono viejo o corrección de un campo: la lista sale de horas y causa
  if (tg_op = 'INSERT' and jsonb_array_length(new.losses) = 0)
     or (tg_op = 'UPDATE' and new.losses = old.losses and (new.lost_hours <> old.lost_hours or new.loss_cause <> old.loss_cause)) then
    new.losses := case when new.lost_hours > 0 and new.loss_cause <> 'none'
      then jsonb_build_array(jsonb_build_object('cause', new.loss_cause, 'hours', new.lost_hours)) else '[]'::jsonb end;
    return new;
  end if;
  -- Lista nueva: se valida, se une por causa y se recalculan horas y causa principal
  for it in select jsonb_build_object('cause', x->>'cause', 'hours', sum((x->>'hours')::numeric))
            from jsonb_array_elements(new.losses) x group by x->>'cause' loop
    perform (it->>'cause')::loss_cause;
    if it->>'cause' = 'none' or (it->>'hours')::numeric <= 0 or (it->>'hours')::numeric > 24 then
      raise exception 'Pérdida de tiempo: cada línea necesita una causa y horas entre 0 y 24';
    end if;
    merged := merged || jsonb_build_array(it);
    total := total + (it->>'hours')::numeric;
    if (it->>'hours')::numeric > top_hours then top_hours := (it->>'hours')::numeric; top_cause := it->>'cause'; end if;
  end loop;
  if total > 24 then raise exception 'Las horas perdidas del registro suman más de 24'; end if;
  new.losses := merged;
  new.lost_hours := total;
  new.loss_cause := top_cause::loss_cause;
  return new;
end $$;

create trigger progress_entries_losses before insert or update of losses, lost_hours, loss_cause on progress_entries
  for each row execute function private.entry_losses_normalize();

-- Registros existentes: una línea con su causa. Es la misma información en otra forma, así que no
-- pasa por la protección de aprobados ni por la auditoría (no cambia ningún valor registrado).
alter table progress_entries disable trigger progress_entries_guard;
alter table progress_entries disable trigger progress_entries_audit;
alter table progress_entries disable trigger progress_entries_losses;
update progress_entries set losses = jsonb_build_array(jsonb_build_object('cause', loss_cause, 'hours', lost_hours))
where lost_hours > 0 and loss_cause <> 'none' and losses = '[]';
alter table progress_entries enable trigger progress_entries_guard;
alter table progress_entries enable trigger progress_entries_audit;
alter table progress_entries enable trigger progress_entries_losses;

-- Los informes del servidor reciben el detalle
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
      select id, activity_id, work_date, quantity, effective_hours, lost_hours, loss_cause, losses, weather, crew_size, status, notes
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
