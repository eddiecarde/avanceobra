-- AvanceObra · etapa 4: formatos editables versionados y biblioteca de rendimientos y costos
--
-- * Solo el administrador de la empresa edita formatos y la biblioteca (antes bastaba con ser
--   miembro: un supervisor podía cambiar costos o formatos).
-- * Publicar un formato crea una versión nueva inmutable; los registros guardan la versión
--   con que se llenaron (progress_entries.template_version_id).
-- * Cada actividad puede tener un formato y recursos de la biblioteca asignados, con la opción
--   de proyectar con el rendimiento real (histórico) o el de referencia.

create or replace function is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = p_org and m.role = 'admin');
$$;

-- ---------- Formatos ----------
alter table form_templates add column description text;
alter table form_templates add column template_key text;      -- plantilla precargada de origen
alter table form_templates add column updated_at timestamptz not null default now();
alter table form_template_versions add column published_by_name text;
alter table form_template_versions add column changelog text;

drop policy if exists templates_admin on form_templates;
create policy templates_insert on form_templates for insert with check (is_org_admin(org_id));
create policy templates_update on form_templates for update using (is_org_admin(org_id)) with check (is_org_admin(org_id));
-- Sin DELETE: un formato con registros no se borra, se archiva (archived = true).

drop policy if exists tv_insert on form_template_versions;
create policy tv_insert on form_template_versions for insert
  with check (exists (select 1 from form_templates t where t.id = template_id and is_org_admin(t.org_id)));
-- Sin UPDATE ni DELETE: las versiones publicadas son inmutables.

/**
 * Publica una versión nueva de un formato de forma atómica: número = actual + 1.
 * Si el contenido es idéntico a la última versión, no crea otra y devuelve la existente.
 */
create or replace function publish_form_version(p_template uuid, p_schema jsonb, p_changelog text default null)
returns table (version_id uuid, version int, created boolean)
language plpgsql security invoker set search_path = public as $$
declare
  t form_templates%rowtype;
  last form_template_versions%rowtype;
  v_id uuid;
begin
  select * into t from form_templates where id = p_template for update;
  if not found then raise exception 'Formato % no existe', p_template; end if;
  if not is_org_admin(t.org_id) then raise exception 'Solo el administrador publica formatos' using errcode = '42501'; end if;
  if jsonb_typeof(p_schema -> 'fields') <> 'array' then raise exception 'El formato no tiene campos'; end if;

  select * into last from form_template_versions where template_id = p_template order by version desc limit 1;
  if found and last.schema = p_schema then
    return query select last.id, last.version, false;
    return;
  end if;

  insert into form_template_versions (template_id, version, schema, created_by, published_by_name, changelog)
  values (p_template, coalesce(last.version, 0) + 1, p_schema, auth.uid(),
          (select full_name from profiles where id = auth.uid()), p_changelog)
  returning id into v_id;
  update form_templates
     set current_version = coalesce(last.version, 0) + 1, updated_at = now(),
         name = coalesce(p_schema ->> 'name', name), category = coalesce(p_schema ->> 'category', category),
         work_type = coalesce(p_schema ->> 'workType', work_type)
   where id = p_template;
  return query select v_id, coalesce(last.version, 0) + 1, true;
end $$;

-- Formato asignado a cada actividad (se llena al registrar avance)
alter table activities add column template_id uuid references form_templates(id);

-- ---------- Biblioteca ----------
drop policy if exists catalog_write on resource_catalog;
create policy catalog_insert on resource_catalog for insert with check (is_org_admin(org_id));
create policy catalog_update on resource_catalog for update using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy catalog_delete on resource_catalog for delete using (is_org_admin(org_id));
alter table resource_catalog add column notes text;
alter table resource_catalog add column archived boolean not null default false;

/** Recursos de la biblioteca asignados a una actividad (para la calculadora y la proyección). */
create table activity_resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  resource_id uuid not null references resource_catalog(id),
  units numeric(8,2) not null default 1 check (units >= 0),
  -- true = proyectar con el rendimiento real del histórico; false = con el de referencia
  use_real_rate boolean not null default false,
  rate_override numeric(12,3),
  updated_at timestamptz not null default now(),
  unique (activity_id, resource_id)
);
alter table activity_resources enable row level security;
create policy activity_resources_read on activity_resources for select using (has_project_role(project_id));
create policy activity_resources_admin on activity_resources for all
  using (has_project_role(project_id, '{admin}')) with check (has_project_role(project_id, '{admin}'));

/**
 * Rendimiento real por actividad y día (para contrastar con la referencia):
 * cantidad del día, horas efectivas y personal, solo registros enviados o aprobados.
 */
create or replace view activity_daily_output as
select e.project_id, e.activity_id, e.work_date,
       sum(e.quantity)::float8 as quantity,
       sum(e.effective_hours)::float8 as effective_hours,
       sum(e.lost_hours)::float8 as lost_hours,
       max(e.crew_size) as crew_size,
       count(*)::int as entries
from progress_entries e
where e.status in ('submitted', 'approved')
group by e.project_id, e.activity_id, e.work_date;
alter view activity_daily_output set (security_invoker = true);

create trigger form_templates_audit after insert or update on form_templates for each row execute function audit_row();

alter publication powersync add table activity_resources;
