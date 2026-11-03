-- El teléfono cierra hallazgos sin señal: la nota de verificación viaja en el mismo cambio que
-- sincroniza el estado, para que el cierre de una no conformidad o un punch pase la validación.
create or replace function update_finding_synced(p_id uuid, p_patch jsonb, p_base_version int)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  cur findings%rowtype;
  sensitive text[] := array['status','severity','responsible_user_id','due_date'];
  k text;
  is_conflict boolean := false;
begin
  select * into cur from findings where id = p_id for update;
  if not found then
    raise exception 'Hallazgo % no existe', p_id using errcode = 'P0002';
  end if;

  if p_base_version is not null and cur.version <> p_base_version
     and cur.updated_by is distinct from auth.uid() then
    foreach k in array sensitive loop
      if p_patch ? k and (to_jsonb(cur) -> k) is distinct from (p_patch -> k) then
        is_conflict := true;
      end if;
    end loop;
  end if;

  if is_conflict then
    insert into sync_conflicts (project_id, table_name, row_id, base_version, server_version,
                                server_values, client_values, client_user, server_user)
    values (cur.project_id, 'findings', p_id, p_base_version, cur.version,
            to_jsonb(cur), p_patch, auth.uid(), cur.updated_by);
  end if;

  -- Última modificación gana (el conflicto queda registrado para revisión)
  update findings set
    status              = coalesce((p_patch->>'status')::finding_status, status),
    severity            = coalesce((p_patch->>'severity')::severity, severity),
    description         = coalesce(p_patch->>'description', description),
    responsible_user_id = case when p_patch ? 'responsible_user_id' then (p_patch->>'responsible_user_id')::uuid else responsible_user_id end,
    due_date            = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end,
    verification_note   = case when p_patch ? 'verification_note' then nullif(trim(p_patch->>'verification_note'), '') else verification_note end,
    corrective_action   = case when p_patch ? 'corrective_action' then nullif(trim(p_patch->>'corrective_action'), '') else corrective_action end
  where id = p_id;

  return jsonb_build_object('conflict', is_conflict);
end $$;
