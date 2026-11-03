-- Cómo se llaman las zonas de la obra (Subcampo, Tramo, Bloque, Piso…): rótulo de la matriz por zona.
alter table projects add column zone_label text check (zone_label is null or length(trim(zone_label)) between 1 and 30);

/**
 * Historial de avance traído del cronograma (MS Project / Primavera): el administrador lo carga al
 * importar y queda aprobado, marcado como "import-cronograma". Cada fila: {activity_id, work_date, quantity}.
 */
create or replace function import_progress_history(p_project uuid, p_rows jsonb, p_note text default 'Del cronograma')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_project_role(p_project, '{admin}') then
    raise exception 'Solo el administrador del proyecto carga el avance del cronograma' using errcode = '42501';
  end if;
  insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, status, created_by, approved_by, approved_at, device_id, client_created_at, notes)
  select gen_random_uuid(), p_project, a.front_id, a.id, (r->>'work_date')::date, (r->>'quantity')::numeric, 'approved', auth.uid(), auth.uid(), now(),
         'import-cronograma', now(), left(coalesce(p_note, 'Del cronograma'), 200)
  from jsonb_array_elements(p_rows) r
  join activities a on a.id = (r->>'activity_id')::uuid and a.project_id = p_project
  where (r->>'quantity')::numeric > 0;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function import_progress_history(uuid, jsonb, text) from public;
grant execute on function import_progress_history(uuid, jsonb, text) to authenticated;

update projects set zone_label = 'Subcampo' where code = 'PFV-ATL';
