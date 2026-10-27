-- AvanceObra · lo comercial: solicitudes de demo, planes por empresa y logo en los informes

-- ---------- Solicitudes de demo (página pública /demo) ----------
create table demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  email text not null,
  phone text,
  city text,
  project_type text,
  projects_count int,
  message text,
  status text not null default 'nuevo' check (status in ('nuevo', 'contactado', 'convertido', 'descartado')),
  notes text,
  org_id uuid references organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index demo_requests_created on demo_requests (created_at desc);
alter table demo_requests enable row level security;
-- Solo el dueño de la plataforma las ve y las gestiona; el alta llega por request_demo
create policy demo_requests_owner on demo_requests for select using (is_platform_admin());
create policy demo_requests_owner_update on demo_requests for update using (is_platform_admin()) with check (is_platform_admin());

/** Solicitud de demo desde la página pública (sin sesión). Con trampa para robots y límite por correo. */
create or replace function request_demo(
  p_name text, p_company text, p_email text, p_phone text default null, p_city text default null,
  p_project_type text default null, p_projects_count int default null, p_message text default null, p_website text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  -- Campo oculto: una persona no lo llena, un robot sí (se responde igual para no darle pistas)
  if length(trim(coalesce(p_website, ''))) > 0 then return; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Escribe tu nombre'; end if;
  if length(trim(coalesce(p_company, ''))) < 2 then raise exception 'Escribe el nombre de tu empresa'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'El correo no es válido'; end if;
  if (select count(*) from demo_requests where email = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Ya recibimos tu solicitud: te contactaremos pronto';
  end if;
  if (select count(*) from demo_requests where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Estamos recibiendo muchas solicitudes: intenta de nuevo en un rato';
  end if;
  insert into demo_requests (name, company, email, phone, city, project_type, projects_count, message)
  values (left(trim(p_name), 120), left(trim(p_company), 160), left(v_email, 160), left(nullif(trim(coalesce(p_phone, '')), ''), 40),
          left(nullif(trim(coalesce(p_city, '')), ''), 80), left(nullif(trim(coalesce(p_project_type, '')), ''), 80),
          case when p_projects_count between 1 and 1000 then p_projects_count end, left(nullif(trim(coalesce(p_message, '')), ''), 2000));
end $$;
revoke all on function request_demo(text, text, text, text, text, text, int, text, text) from public;
grant execute on function request_demo(text, text, text, text, text, text, int, text, text) to anon, authenticated;

-- ---------- Planes por empresa ----------
-- Las empresas que ya existen quedan en el plan Empresa (sin límites); las nuevas, en prueba
alter table organizations add column plan text not null default 'empresa' check (plan in ('prueba', 'basico', 'profesional', 'empresa'));
alter table organizations add column max_projects int check (max_projects is null or max_projects > 0);
alter table organizations add column max_users int check (max_users is null or max_users > 0);
alter table organizations add column paid_until date;
alter table organizations add column monthly_fee numeric(14,2) check (monthly_fee is null or monthly_fee >= 0);
alter table organizations add column logo_path text;

/** Cambiar el plan, los límites, la fecha de pago y la tarifa de una empresa. Solo el dueño. */
create or replace function platform_set_plan(p_org uuid, p_plan text, p_max_projects int, p_max_users int, p_paid_until date, p_monthly_fee numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Solo el dueño de la plataforma' using errcode = '42501'; end if;
  update organizations set plan = p_plan, max_projects = p_max_projects, max_users = p_max_users, paid_until = p_paid_until, monthly_fee = p_monthly_fee
  where id = p_org;
  if not found then raise exception 'Empresa no encontrada' using errcode = 'P0002'; end if;
end $$;
revoke all on function platform_set_plan(uuid, text, int, int, date, numeric) from public, anon;
grant execute on function platform_set_plan(uuid, text, int, int, date, numeric) to authenticated;

-- Límite de obras: al crear una obra
create or replace function projects_plan_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int; v_count int;
begin
  select max_projects into v_max from organizations where id = new.org_id;
  if v_max is null then return new; end if;
  select count(*) into v_count from projects where org_id = new.org_id;
  if v_count >= v_max then
    raise exception 'El plan de la empresa permite % obra(s): pide al administrador de AvanceObra ampliar el plan', v_max;
  end if;
  return new;
end $$;
create trigger projects_plan_limit before insert on projects for each row execute function projects_plan_limit();

-- Límite de usuarios: al agregar a alguien que aún no está en ninguna obra de la empresa
create or replace function memberships_plan_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int; v_count int;
begin
  select max_users into v_max from organizations where id = new.org_id;
  if v_max is null then return new; end if;
  if exists (select 1 from memberships where org_id = new.org_id and user_id = new.user_id) then return new; end if;
  select count(distinct user_id) into v_count from memberships where org_id = new.org_id;
  if v_count >= v_max then
    raise exception 'El plan de la empresa permite % usuario(s): pide al administrador de AvanceObra ampliar el plan', v_max;
  end if;
  return new;
end $$;
create trigger memberships_plan_limit before insert on memberships for each row execute function memberships_plan_limit();

-- Panel del dueño: también el plan y el uso frente a sus límites
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
      'last_sign_in', (select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id),
      'last_entry', (select max(e.created_at) from progress_entries e join projects p on p.id = e.project_id where p.org_id = o.id),
      'entries_30d', (select count(*) from progress_entries e join projects p on p.id = e.project_id
                      where p.org_id = o.id and e.created_at > now() - interval '30 days')
    ) order by o.created_at)
    from organizations o
  ), '[]'::jsonb);
end $$;

-- ---------- Logo de la empresa (y de cada obra): bucket público, lo sube el administrador ----------
insert into storage.buckets (id, name, public) values ('logos', 'logos', true) on conflict (id) do nothing;

create or replace function can_upload_logo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  begin v_org := (storage.foldername(p_name))[1]::uuid; exception when others then return false; end;
  return is_org_admin(v_org);
end $$;
revoke all on function can_upload_logo(text) from public, anon;
grant execute on function can_upload_logo(text) to authenticated;
create policy logos_write on storage.objects for insert with check (bucket_id = 'logos' and can_upload_logo(name));
create policy logos_update on storage.objects for update using (bucket_id = 'logos' and can_upload_logo(name));
