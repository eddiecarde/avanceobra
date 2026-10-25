-- AvanceObra · planos por empresa
-- Un plano general (sin empresa) lo ve todo el proyecto. El de una empresa lo ven esa empresa, el
-- personal del contratista principal y el administrador; las demás empresas no lo ven ni en la web
-- ni en el teléfono (ni sus filas ni el archivo). El administrador sube planos para cualquier
-- empresa; el director o residente de una empresa, solo los de la suya.

alter table site_plans add column company_id uuid references project_companies(id) on delete set null;
alter table site_plans add column uploaded_by uuid references auth.users(id) default auth.uid();

/** La empresa del plano debe ser del mismo proyecto. */
create or replace function site_plans_company_check() returns trigger language plpgsql as $$
begin
  if new.company_id is not null and not exists (
    select 1 from project_companies c where c.id = new.company_id and c.project_id = new.project_id) then
    raise exception 'La empresa no pertenece a este proyecto';
  end if;
  return new;
end $$;
create trigger site_plans_company_check before insert or update of company_id on site_plans
  for each row execute function site_plans_company_check();

/** ¿El usuario actual puede ver un plano de esta empresa en este proyecto? */
create or replace function can_see_plan(p_project uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    left join project_companies c on c.id = m.company_id
    where m.user_id = auth.uid() and m.project_id = p_project
      and (m.role = 'admin' or p_company is null or m.company_id = p_company or c.kind = 'contratista')
  );
$$;

/** Empresa del usuario actual en el proyecto (para que director y residente suban los de la suya). */
create or replace function my_company(p_project uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from memberships where user_id = auth.uid() and project_id = p_project;
$$;

drop policy site_plans_read on site_plans;
create policy site_plans_read on site_plans for select using (can_see_plan(project_id, company_id));
-- site_plans_admin (todo para el administrador) se mantiene
create policy site_plans_company_insert on site_plans for insert
  with check (has_project_role(project_id, '{director,resident}') and company_id is not null and company_id = my_company(project_id));
create policy site_plans_company_delete on site_plans for delete
  using (has_project_role(project_id, '{director,resident}') and company_id is not null and company_id = my_company(project_id));

-- Archivos: el bucket "plans" se lee solo si el usuario ve la fila del plano (la consulta respeta RLS).
-- objects.name va calificado: site_plans también tiene una columna name.
drop policy photos_bucket_read on storage.objects;
create policy photos_bucket_read on storage.objects for select
  using (bucket_id = 'photos' and has_project_role(((storage.foldername(name))[1])::uuid));
create policy plans_bucket_read on storage.objects for select
  using (bucket_id = 'plans' and exists (select 1 from public.site_plans sp where sp.storage_path = objects.name));
drop policy plans_bucket_write on storage.objects;
create policy plans_bucket_write on storage.objects for insert
  with check (bucket_id = 'plans' and has_project_role(((storage.foldername(name))[1])::uuid, '{admin,director,resident}'));

-- ---------- Acceso para la sincronización del teléfono ----------
-- PowerSync filtra con consultas simples por usuario: esta tabla dice qué planos ve cada uno y se
-- recalcula sola cuando cambian planos, membresías o empresas.
create table plan_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references site_plans(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  primary key (user_id, plan_id)
);
alter table plan_access enable row level security;
create policy plan_access_read on plan_access for select using (user_id = auth.uid());

create or replace function private.refresh_plan_access(p_project uuid) returns void
language sql security definer set search_path = public as $$
  delete from plan_access where project_id = p_project;
  insert into plan_access (user_id, plan_id, project_id)
  select m.user_id, sp.id, sp.project_id
  from site_plans sp
  join memberships m on m.project_id = sp.project_id
  left join project_companies c on c.id = m.company_id
  where sp.project_id = p_project
    and (m.role = 'admin' or sp.company_id is null or m.company_id = sp.company_id or c.kind = 'contratista');
$$;

create or replace function private.plan_access_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then perform private.refresh_plan_access(old.project_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    perform private.refresh_plan_access(new.project_id);
  end if;
  return null;
end $$;
create trigger site_plans_access after insert or update or delete on site_plans for each row execute function private.plan_access_trigger();
create trigger memberships_plan_access after insert or update or delete on memberships for each row execute function private.plan_access_trigger();
create trigger companies_plan_access after insert or update or delete on project_companies for each row execute function private.plan_access_trigger();

-- Planos existentes
select private.refresh_plan_access(id) from projects;

-- PowerSync replica la tabla de acceso para filtrar los planos de cada usuario
alter publication powersync add table plan_access;
