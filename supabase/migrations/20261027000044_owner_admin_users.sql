-- AvanceObra · el panel del dueño trae la cuenta de cada administrador de empresa
-- (para restablecerle la contraseña con la función team-reset-password cuando la olvide).
create or replace function platform_companies() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then raise exception 'Solo el dueño de la plataforma' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'tax_id', o.tax_id,
      'created_at', o.created_at,
      'suspended_at', o.suspended_at,
      'suspended_reason', o.suspended_reason,
      'plan', o.plan,
      'max_projects', o.max_projects,
      'max_users', o.max_users,
      'paid_until', o.paid_until,
      'monthly_fee', o.monthly_fee,
      'projects', (select count(*) from projects p where p.org_id = o.id),
      'project_names', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb) from projects p where p.org_id = o.id),
      'users', (select count(distinct m.user_id) from memberships m where m.org_id = o.id),
      'admins', (select coalesce(jsonb_agg(distinct coalesce(m.member_name, u.email)), '[]'::jsonb)
                 from memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id and m.role = 'admin'),
      -- Administradores con su cuenta, para restablecerles la contraseña desde el panel
      'admin_users', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'email', x.email) order by x.name), '[]'::jsonb)
                      from (select distinct on (u.id) u.id as user_id, coalesce(m.member_name, u.email::text) as name, u.email::text as email
                            from memberships m join auth.users u on u.id = m.user_id
                            where m.org_id = o.id and m.role = 'admin' order by u.id) x),
      'last_sign_in', (select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id),
      'last_entry', (select max(e.created_at) from progress_entries e join projects p on p.id = e.project_id where p.org_id = o.id),
      'entries_30d', (select count(*) from progress_entries e join projects p on p.id = e.project_id
                      where p.org_id = o.id and e.created_at > now() - interval '30 days')
    ) order by o.created_at)
    from organizations o
  ), '[]'::jsonb);
end $$;
