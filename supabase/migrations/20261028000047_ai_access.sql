-- Acceso al asistente con IA solo para quien lo autorice el administrador de la obra (persona por
-- persona). Nadie lo tiene por defecto; el dueño de la plataforma siempre puede usarlo.

alter table memberships add column ai_enabled boolean not null default false;

create or replace function can_use_ai(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.project_id = p_project and not m.org_suspended and m.ai_enabled
  );
$$;
grant execute on function can_use_ai(uuid) to authenticated;

-- El equipo muestra quién tiene el asistente (lo activa el administrador con la política de memberships)
drop function project_team(uuid);
create function project_team(p_project uuid)
 returns table(user_id uuid, name text, email text, role app_role, telegram_linked boolean, last_sign_in_at timestamp with time zone,
               must_change_password boolean, company_id uuid, company_name text, company_kind text, ai_enabled boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not has_project_role(p_project, '{admin}') then
    raise exception 'Solo el administrador del proyecto ve el equipo' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(m.member_name, p.full_name, u.email::text), u.email::text, m.role,
         p.telegram_chat_id is not null, u.last_sign_in_at,
         coalesce((u.raw_user_meta_data ->> 'must_change_password')::boolean, false),
         c.id, c.name, c.kind, m.ai_enabled
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  left join project_companies c on c.id = m.company_id
  where m.project_id = p_project
  order by m.role, 2;
end $function$;
grant execute on function project_team(uuid) to authenticated;
