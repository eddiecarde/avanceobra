-- AvanceObra · panel del dueño de la plataforma
-- El dueño da de alta empresas (organización + primer administrador + primera obra, por la función
-- platform-create-company), ve todas las empresas con su uso y puede suspenderlas o reactivarlas.
-- Una empresa suspendida conserva sus datos, pero su gente no entra (web, teléfono ni informes).

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- Cada quien solo puede saber si él mismo es dueño; el alta se hace a mano en la base de datos
create policy platform_admins_self on platform_admins for select using (user_id = auth.uid());

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- Suspensión de una empresa: se marca en la organización y se copia a sus membresías y obras, para
-- que los permisos, la sincronización del teléfono y los informes la respeten con un solo filtro
alter table organizations add column suspended_at timestamptz;
alter table organizations add column suspended_reason text;
alter table memberships add column org_suspended boolean not null default false;
alter table projects add column suspended boolean not null default false;

create or replace function organizations_propagate_suspension() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.suspended_at is distinct from old.suspended_at then
    update memberships set org_suspended = (new.suspended_at is not null) where org_id = new.id;
    update projects set suspended = (new.suspended_at is not null) where org_id = new.id;
  end if;
  return new;
end $$;
create trigger organizations_suspension after update of suspended_at on organizations
  for each row execute function organizations_propagate_suspension();
create trigger organizations_audit after insert or update or delete on organizations for each row execute function audit_row();

-- Una membresía nueva en una empresa suspendida nace suspendida
create or replace function memberships_inherit_suspension() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.org_suspended := exists (select 1 from organizations where id = new.org_id and suspended_at is not null);
  return new;
end $$;
create trigger memberships_inherit_suspension before insert on memberships for each row execute function memberships_inherit_suspension();

-- Permisos: una empresa suspendida no ve ni escribe nada de sus obras
create or replace function has_project_role(p_project uuid, p_roles app_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.project_id = p_project and not m.org_suspended
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

-- Crear obras: tampoco desde una empresa suspendida
create or replace function create_project(
  p_code text,
  p_name text,
  p_start date,
  p_end date,
  p_client text default null,
  p_location text default null,
  p_zone_label text default null,
  p_org uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_code text := upper(regexp_replace(trim(coalesce(p_code, '')), '\s+', '-', 'g'));
  v_id uuid;
begin
  select m.org_id into v_org from memberships m
  where m.user_id = auth.uid() and m.role = 'admin' and not m.org_suspended and (p_org is null or m.org_id = p_org)
  group by m.org_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'Solo el administrador de una obra de la empresa puede crear obras nuevas' using errcode = '42501'; end if;
  if p_org is null and (select count(distinct org_id) from memberships where user_id = auth.uid() and role = 'admin' and not org_suspended) > 1 then
    raise exception 'Administras obras de varias empresas: elige en cuál crear la obra';
  end if;

  if length(v_code) < 2 or length(v_code) > 20 then raise exception 'El código de la obra debe tener entre 2 y 20 caracteres'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Escribe el nombre de la obra'; end if;
  if p_start is null or p_end is null then raise exception 'Faltan las fechas de inicio y de terminación'; end if;
  if p_end <= p_start then raise exception 'La terminación debe ser posterior al inicio'; end if;
  if exists (select 1 from projects where org_id = v_org and code = v_code) then raise exception 'Ya existe una obra con el código %', v_code; end if;

  insert into projects (org_id, code, name, start_date, contract_end_date, client_name, location_name, zone_label)
  values (v_org, v_code, trim(p_name), p_start, p_end, nullif(trim(coalesce(p_client, '')), ''), nullif(trim(coalesce(p_location, '')), ''),
          nullif(trim(coalesce(p_zone_label, '')), ''))
  returning id into v_id;

  insert into memberships (user_id, project_id, org_id, role, member_name)
  values (auth.uid(), v_id, v_org, 'admin', (select full_name from profiles where id = auth.uid()));
  return v_id;
end $$;

-- Portal del cliente: tampoco se ve una obra de una empresa suspendida
create or replace function client_projects() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'client_name', p.client_name, 'contractor_name', p.contractor_name) order by p.name), '[]'::jsonb)
  from project_clients c join projects p on p.id = c.project_id
  where c.user_id = auth.uid() and not p.suspended;
$$;

/** Todas las empresas con su uso: obras, usuarios, administradores y última actividad. Solo el dueño. */
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
      'projects', (select count(*) from projects p where p.org_id = o.id),
      'project_names', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb) from projects p where p.org_id = o.id),
      'users', (select count(distinct m.user_id) from memberships m where m.org_id = o.id),
      'admins', (select coalesce(jsonb_agg(distinct coalesce(m.member_name, u.email)), '[]'::jsonb)
                 from memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id and m.role = 'admin'),
      'last_sign_in', (select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id),
      'last_entry', (select max(e.created_at) from progress_entries e join projects p on p.id = e.project_id where p.org_id = o.id),
      'entries_30d', (select count(*) from progress_entries e join projects p on p.id = e.project_id
                      where p.org_id = o.id and e.created_at > now() - interval '30 days')
    ) order by o.created_at)
    from organizations o
  ), '[]'::jsonb);
end $$;

/** Suspender (con motivo) o reactivar una empresa. Solo el dueño. */
create or replace function platform_set_suspended(p_org uuid, p_suspended boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Solo el dueño de la plataforma' using errcode = '42501'; end if;
  if p_suspended and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo de la suspensión'; end if;
  update organizations
  set suspended_at = case when p_suspended then coalesce(suspended_at, now()) else null end,
      suspended_reason = case when p_suspended then trim(p_reason) else null end
  where id = p_org;
  if not found then raise exception 'Empresa no encontrada' using errcode = 'P0002'; end if;
end $$;

-- Alertas: a una empresa suspendida no se le envía nada
create or replace function alert_member_contacts(p_project uuid)
returns table (user_id uuid, role app_role, member_name text, email text, phone text,
               telegram_chat_id text, whatsapp_opt_in boolean, push_tokens text[])
language plpgsql stable security definer set search_path = public as $$
begin
  -- Correos y teléfonos de todo el equipo: solo para el despacho (service_role o job, sin usuario).
  -- No se confía solo en REVOKE porque los privilegios por defecto pueden volver a otorgarlo.
  if auth.uid() is not null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
  select m.user_id, m.role, coalesce(m.member_name, p.full_name, u.email::text), u.email::text, p.phone,
         p.telegram_chat_id, coalesce(p.whatsapp_opt_in, false),
         coalesce((select array_agg(t.token) from device_tokens t where t.user_id = m.user_id), '{}')
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.project_id = p_project and not m.org_suspended;
end $$;

revoke all on function is_platform_admin() from public, anon;
revoke all on function platform_companies() from public, anon;
revoke all on function platform_set_suspended(uuid, boolean, text) from public, anon;
grant execute on function is_platform_admin() to authenticated;
grant execute on function platform_companies() to authenticated;
grant execute on function platform_set_suspended(uuid, boolean, text) to authenticated;

-- El dueño: Eddie Cárdenas (administrador de las obras de prueba)
insert into platform_admins (user_id) values ('c580a23f-093d-4d34-bbe9-546aae4bf298') on conflict do nothing;
