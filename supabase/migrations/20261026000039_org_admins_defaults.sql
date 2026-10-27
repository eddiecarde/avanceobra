-- AvanceObra · administradores de empresa y valores por defecto de la empresa
-- - Un administrador de empresa entra como administrador a todas las obras de su empresa: las que
--   ya existen y las que se creen después. Gestiona los administradores y los valores por defecto.
-- - Los valores por defecto (cargos, equipos, firmas, calendario, jornada, contratista y tarifas) se
--   copian a cada obra nueva. Los formatos y la biblioteca de rendimientos ya eran de la empresa.

create table org_admins (
  id uuid not null default gen_random_uuid() unique,
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table org_admins enable row level security;

-- Administrador de la empresa: el de la tabla, o (como antes) el administrador de alguna de sus obras
create or replace function is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_admins a join organizations o on o.id = a.org_id
                 where a.org_id = p_org and a.user_id = auth.uid() and o.suspended_at is null)
      or exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = p_org and m.role = 'admin' and not m.org_suspended);
$$;

create policy org_admins_read on org_admins for select using (is_org_member(org_id));
create policy org_admins_insert on org_admins for insert with check (is_org_admin(org_id));
create policy org_admins_delete on org_admins for delete using (is_org_admin(org_id));
create trigger org_admins_audit after insert or update or delete on org_admins for each row execute function audit_row();

-- La empresa no se queda sin administrador
create or replace function org_admins_keep_one() returns trigger language plpgsql as $$
begin
  -- Si se borra la empresa completa (alta fallida), sus administradores se van con ella
  if not exists (select 1 from organizations where id = old.org_id) then return old; end if;
  if not exists (select 1 from org_admins where org_id = old.org_id and user_id <> old.user_id) then
    raise exception 'La empresa debe tener al menos un administrador';
  end if;
  return old;
end $$;
create trigger org_admins_keep_one before delete on org_admins for each row execute function org_admins_keep_one();

-- Nombre y NIT: los cambia el administrador de la empresa
create policy org_update on organizations for update using (is_org_admin(id)) with check (is_org_admin(id));

-- Al nombrar un administrador de empresa entra como administrador a todas sus obras
create or replace function org_admins_join_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into memberships (user_id, project_id, org_id, role, member_name)
  select new.user_id, p.id, p.org_id, 'admin', (select full_name from profiles where id = new.user_id)
  from projects p where p.org_id = new.org_id
  on conflict (user_id, project_id) do update set role = 'admin';
  return new;
end $$;
create trigger org_admins_join after insert on org_admins for each row execute function org_admins_join_projects();

-- Y en cada obra nueva de la empresa entran todos sus administradores
create or replace function projects_add_org_admins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into memberships (user_id, project_id, org_id, role, member_name)
  select a.user_id, new.id, new.org_id, 'admin', (select full_name from profiles where id = a.user_id)
  from org_admins a where a.org_id = new.org_id
  on conflict (user_id, project_id) do nothing;
  return new;
end $$;
create trigger projects_org_admins after insert on projects for each row execute function projects_add_org_admins();

-- ---------- Valores por defecto de la empresa ----------
create table org_settings (
  id uuid not null default gen_random_uuid() unique,
  org_id uuid primary key references organizations(id) on delete cascade,
  contractor_name text,
  personnel_roles text[],
  equipment_types text[],
  report_signers text[],
  workdays smallint[] check (workdays is null or workdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  colombian_holidays boolean,
  work_start time,
  work_end time,
  -- {"Oficial de obra": 120000}: pesos por persona-día y por equipo-día (van a cost_rates de cada obra)
  personnel_rates jsonb not null default '{}' check (jsonb_typeof(personnel_rates) = 'object'),
  equipment_rates jsonb not null default '{}' check (jsonb_typeof(equipment_rates) = 'object'),
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  check (work_start is null or work_end is null or work_end > work_start)
);
alter table org_settings enable row level security;
create policy org_settings_read on org_settings for select using (is_org_member(org_id));
create policy org_settings_write on org_settings for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create trigger org_settings_audit after insert or update or delete on org_settings for each row execute function audit_row();

/** Copia los valores por defecto de la empresa a una obra recién creada (solo lo que la empresa definió). */
create or replace function apply_org_defaults(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s org_settings;
begin
  select o.* into s from org_settings o join projects p on p.org_id = o.org_id where p.id = p_project;
  if not found then return; end if;
  update projects set
    contractor_name = coalesce(s.contractor_name, contractor_name),
    personnel_roles = coalesce(s.personnel_roles, personnel_roles),
    equipment_types = coalesce(s.equipment_types, equipment_types),
    report_signers = coalesce(s.report_signers, report_signers),
    workdays = coalesce(s.workdays, workdays),
    colombian_holidays = coalesce(s.colombian_holidays, colombian_holidays),
    work_start = coalesce(s.work_start, work_start),
    work_end = coalesce(s.work_end, work_end)
  where id = p_project;
  if s.personnel_rates <> '{}'::jsonb or s.equipment_rates <> '{}'::jsonb then
    insert into cost_rates (project_id, personnel, equipment)
    values (p_project, s.personnel_rates, s.equipment_rates)
    on conflict (project_id) do nothing;
  end if;
end $$;
revoke all on function apply_org_defaults(uuid) from public, anon, authenticated;

-- Crear obra: también el administrador de empresa (aunque aún no tenga obras), y con los valores de la empresa
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
  v_orgs int;
begin
  with mine as (
    select a.org_id from org_admins a join organizations o on o.id = a.org_id where a.user_id = auth.uid() and o.suspended_at is null
    union
    select m.org_id from memberships m where m.user_id = auth.uid() and m.role = 'admin' and not m.org_suspended
  )
  select count(*), min(org_id::text)::uuid into v_orgs, v_org from mine where p_org is null or org_id = p_org;
  if v_orgs = 0 then raise exception 'Solo el administrador de la empresa puede crear obras nuevas' using errcode = '42501'; end if;
  if v_orgs > 1 then raise exception 'Administras obras de varias empresas: elige en cuál crear la obra'; end if;

  if length(v_code) < 2 or length(v_code) > 20 then raise exception 'El código de la obra debe tener entre 2 y 20 caracteres'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Escribe el nombre de la obra'; end if;
  if p_start is null or p_end is null then raise exception 'Faltan las fechas de inicio y de terminación'; end if;
  if p_end <= p_start then raise exception 'La terminación debe ser posterior al inicio'; end if;
  if exists (select 1 from projects where org_id = v_org and code = v_code) then raise exception 'Ya existe una obra con el código %', v_code; end if;

  insert into projects (org_id, code, name, start_date, contract_end_date, client_name, location_name, zone_label)
  values (v_org, v_code, trim(p_name), p_start, p_end, nullif(trim(coalesce(p_client, '')), ''), nullif(trim(coalesce(p_location, '')), ''),
          nullif(trim(coalesce(p_zone_label, '')), ''))
  returning id into v_id;

  -- Quien la crea queda de administrador (si es administrador de empresa, el trigger ya lo agregó)
  insert into memberships (user_id, project_id, org_id, role, member_name)
  values (auth.uid(), v_id, v_org, 'admin', (select full_name from profiles where id = auth.uid()))
  on conflict (user_id, project_id) do nothing;
  perform apply_org_defaults(v_id);
  return v_id;
end $$;

/** Administradores de la empresa y la gente que puede serlo (quien está en alguna de sus obras), con correo. */
create or replace function org_people(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_org_admin(p_org) then raise exception 'Solo el administrador de la empresa' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'email', x.email, 'admin', x.admin) order by x.admin desc, x.name)
    from (
      select u.id as user_id, coalesce(max(m.member_name), max(pr.full_name), u.email::text) as name, u.email::text as email,
             exists (select 1 from org_admins a where a.org_id = p_org and a.user_id = u.id) as admin
      from auth.users u
      left join memberships m on m.user_id = u.id and m.org_id = p_org
      left join profiles pr on pr.id = u.id
      where exists (select 1 from memberships m2 where m2.user_id = u.id and m2.org_id = p_org)
         or exists (select 1 from org_admins a2 where a2.org_id = p_org and a2.user_id = u.id)
      group by u.id, u.email
    ) x
  ), '[]'::jsonb);
end $$;
revoke all on function org_people(uuid) from public, anon;
grant execute on function org_people(uuid) to authenticated;

-- Punto de partida: los administradores actuales de obras pasan a ser administradores de su empresa
insert into org_admins (org_id, user_id)
select distinct m.org_id, m.user_id from memberships m where m.role = 'admin'
on conflict do nothing;
