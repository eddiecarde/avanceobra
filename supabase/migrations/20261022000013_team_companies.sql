-- AvanceObra · empresas del proyecto (contratista y subcontratistas) para agrupar al equipo
-- Es una lista propia del proyecto: memberships.org_id sigue siendo la organización dueña (formatos,
-- catálogos), así que clasificar a alguien como subcontratista no le quita acceso a nada.

create table project_companies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  kind text not null check (kind in ('contratista', 'subcontratista')),
  tax_id text,
  created_at timestamptz not null default now()
);
create unique index project_companies_name on project_companies (project_id, lower(trim(name)));

alter table project_companies enable row level security;
create policy companies_read on project_companies for select using (has_project_role(project_id));
create policy companies_admin on project_companies for all
  using (has_project_role(project_id, '{admin}')) with check (has_project_role(project_id, '{admin}'));
create trigger project_companies_audit after insert or update or delete on project_companies for each row execute function audit_row();

-- Al borrar una empresa sus personas quedan "sin empresa", no se retiran del proyecto
alter table memberships add column company_id uuid references project_companies(id) on delete set null;

/** La empresa asignada debe ser del mismo proyecto. */
create or replace function memberships_company_check() returns trigger language plpgsql as $$
begin
  if new.company_id is not null and not exists (
    select 1 from project_companies c where c.id = new.company_id and c.project_id = new.project_id) then
    raise exception 'La empresa no pertenece a este proyecto';
  end if;
  if new.member_name is not null and length(trim(new.member_name)) < 2 then
    raise exception 'El nombre debe tener al menos 2 letras';
  end if;
  new.member_name := nullif(trim(new.member_name), '');
  return new;
end $$;
create trigger memberships_company_check before insert or update on memberships for each row execute function memberships_company_check();

-- Punto de partida: el contratista que ya figura en la cabecera del informe
insert into project_companies (project_id, name, kind)
select id, trim(contractor_name), 'contratista' from projects where length(trim(coalesce(contractor_name, ''))) >= 2
on conflict do nothing;

-- El equipo ahora trae su empresa (cambia el tipo de retorno: hay que recrear la función)
drop function project_team(uuid);
create function project_team(p_project uuid)
returns table (user_id uuid, name text, email text, role app_role, telegram_linked boolean, last_sign_in_at timestamptz,
               must_change_password boolean, company_id uuid, company_name text, company_kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_project_role(p_project, '{admin}') then
    raise exception 'Solo el administrador del proyecto ve el equipo' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(m.member_name, p.full_name, u.email::text), u.email::text, m.role,
         p.telegram_chat_id is not null, u.last_sign_in_at,
         coalesce((u.raw_user_meta_data ->> 'must_change_password')::boolean, false),
         c.id, c.name, c.kind
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  left join project_companies c on c.id = m.company_id
  where m.project_id = p_project
  order by m.role, 2;
end $$;
revoke all on function project_team(uuid) from public, anon;
