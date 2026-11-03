-- AvanceObra · equipo del proyecto (página Equipo de la web)
-- El administrador ve a todos con su correo, rol y si vincularon Telegram; cambia roles y retira
-- personas. Crear usuarios nuevos lo hace la Edge Function team-create-user (necesita la clave de servicio).

/** Equipo de un proyecto con datos de contacto: solo para su administrador. */
create or replace function project_team(p_project uuid)
returns table (user_id uuid, name text, email text, role app_role, telegram_linked boolean, last_sign_in_at timestamptz, must_change_password boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_project_role(p_project, '{admin}') then
    raise exception 'Solo el administrador del proyecto ve el equipo' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(m.member_name, p.full_name, u.email::text), u.email::text, m.role,
         p.telegram_chat_id is not null, u.last_sign_in_at,
         coalesce((u.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.project_id = p_project
  order by m.role, 2;
end $$;
revoke all on function project_team(uuid) from public, anon;

/** Un proyecto nunca se queda sin administrador (ni por cambio de rol ni por retiro). */
create or replace function memberships_keep_admin() returns trigger language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    select count(*) into remaining from memberships
    where project_id = old.project_id and role = 'admin' and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'El proyecto debe tener al menos un administrador: asigna otro antes de cambiar este rol';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_keep_admin before update or delete on memberships for each row execute function memberships_keep_admin();
create trigger memberships_audit after insert or update or delete on memberships for each row execute function audit_row();

/** Para la Edge Function: id de un usuario por su correo (nunca para usuarios de la web). */
create or replace function auth_user_id_by_email(p_email text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                                nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
  if v_role is not null and v_role <> 'service_role' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return (select id from auth.users where lower(email) = lower(trim(p_email)) limit 1);
end $$;
revoke all on function auth_user_id_by_email(text) from public, anon, authenticated;
