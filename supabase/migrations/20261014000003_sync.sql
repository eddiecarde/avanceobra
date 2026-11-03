-- AvanceObra · soporte de sincronización offline (PowerSync)
--
-- Política de conflictos:
--  * progress_entries, progress_areas, entry_elements, photos: append-only -> sin conflictos.
--  * findings: "última modificación gana", pero si otro usuario cambió el hallazgo después de la
--    versión que el dispositivo leyó (base_version) y el cambio toca campos sensibles, se registra
--    en sync_conflicts y se avisa a ambos usuarios.

alter table findings add column updated_by uuid references auth.users(id);

create or replace function set_finding_updated_by() returns trigger language plpgsql as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger findings_updated_by before insert or update on findings
  for each row execute function set_finding_updated_by();

create table sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  table_name text not null,
  row_id uuid not null,
  base_version int not null,
  server_version int not null,
  server_values jsonb not null,
  client_values jsonb not null,
  client_user uuid not null references auth.users(id),
  server_user uuid references auth.users(id),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table sync_conflicts enable row level security;
create policy conflicts_read on sync_conflicts for select using (has_project_role(project_id));
create policy conflicts_insert on sync_conflicts for insert with check (client_user = auth.uid() and has_project_role(project_id));
create policy conflicts_resolve on sync_conflicts for update using (client_user = auth.uid() or has_project_role(project_id, '{resident,admin}'));

-- Campos cuyo cambio concurrente se considera "conflicto real"
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
    due_date            = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else due_date end
  where id = p_id;

  return jsonb_build_object('conflict', is_conflict);
end $$;

-- Ubicación como lat/lon simples para el cliente (SQLite no maneja geometrías)
alter table progress_entries add column lat double precision generated always as (st_y(location)) stored;
alter table progress_entries add column lon double precision generated always as (st_x(location)) stored;
alter table findings add column lat double precision generated always as (st_y(location)) stored;
alter table findings add column lon double precision generated always as (st_x(location)) stored;
alter table elements add column geojson text generated always as (st_asgeojson(geom)) stored;
alter table progress_areas add column geojson text generated always as (st_asgeojson(geom)) stored;

-- project_id desnormalizado en tablas hijas: las reglas de PowerSync no admiten subconsultas
alter table progress_areas  add column project_id uuid references projects(id);
alter table entry_elements  add column project_id uuid references projects(id);
alter table entry_resources add column project_id uuid references projects(id);
alter table photos          add column project_id uuid references projects(id);
alter table entry_elements  add column id uuid not null default gen_random_uuid() unique;

-- Nombre del miembro desnormalizado para elegir responsables offline
alter table memberships add column member_name text;
-- Id propio: PowerSync necesita una columna id en cada tabla sincronizada
alter table memberships add column id uuid not null default gen_random_uuid() unique;

-- El cliente envía la geometría como EWKT ('SRID=4326;POINT(lon lat)'), que PostGIS acepta directamente.

-- Bucket de fotos privado: ruta {project_id}/{entry_or_finding_id}/{photo_id}.jpg
insert into storage.buckets (id, name, public) values ('photos', 'photos', false), ('plans', 'plans', false)
on conflict (id) do nothing;

create policy photos_bucket_read on storage.objects for select
  using (bucket_id in ('photos','plans') and has_project_role(((storage.foldername(name))[1])::uuid));
create policy photos_bucket_write on storage.objects for insert
  with check (bucket_id = 'photos' and has_project_role(((storage.foldername(name))[1])::uuid));
create policy plans_bucket_write on storage.objects for insert
  with check (bucket_id = 'plans' and has_project_role(((storage.foldername(name))[1])::uuid, '{admin}'));

-- Publicación lógica que replica PowerSync
create publication powersync for table
  projects, memberships, fronts, activities, elements, site_plans, form_templates, form_template_versions,
  progress_entries, entry_resources, entry_elements, progress_areas, photos, findings, finding_events,
  resource_catalog, alerts, sync_conflicts, profiles;
