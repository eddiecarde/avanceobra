-- GENERADO por supabase/setup/build.mjs — no editar a mano.
-- Pegar completo en Supabase > SQL Editor > New query > Run.

-- >>>>> 20261014000001_core_schema.sql
-- AvanceObra · esquema núcleo
-- Decisiones:
--  * Todas las PK son uuid generados en el dispositivo (UUID v7) para que los registros existan offline.
--  * Multiempresa por org_id + membresías por proyecto; RLS en la migración 0002.
--  * Registros de avance append-only; los aprobados son inmutables (trigger en 0002).
--  * PostGIS para elementos del layout, áreas trabajadas y planos georreferenciados.

create extension if not exists postgis;

create type app_role       as enum ('field','resident','director','admin');
create type entry_status   as enum ('draft','submitted','approved','rejected');
create type loss_cause     as enum ('none','weather','material','equipment','permits','labor','design_client','other');
create type weather_kind   as enum ('sunny','cloudy','light_rain','heavy_rain','storm');
create type finding_type   as enum ('quality','safety','environment','operation');
create type severity       as enum ('low','medium','high','critical');
create type finding_status as enum ('open','in_correction','to_review','closed');
create type element_kind   as enum ('tracker','pile','table','segment','axis','slab','trench','other');
create type ownership      as enum ('own','rented');

-- ---------- Organización y acceso ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  parent_org_id uuid references organizations(id), -- subcontratista -> contratista
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  telegram_chat_id text,
  whatsapp_opt_in boolean not null default false,
  locale text not null default 'es',
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null,
  name text not null,
  project_type text not null default 'solar',
  currency char(3) not null default 'COP',
  start_date date,
  contract_end_date date,
  workdays smallint[] not null default '{1,2,3,4,5,6}', -- ISO: 1=lunes
  holidays date[] not null default '{}',
  bbox geometry(Polygon, 4326),
  logo_path text,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  org_id uuid not null references organizations(id),
  role app_role not null,
  primary key (user_id, project_id)
);

-- ---------- Estructura de obra ----------
create table fronts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code text not null,
  name text not null,
  max_parallel_resources int, -- límite de saturación de espacio
  geom geometry(Polygon, 4326),
  unique (project_id, code)
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  front_id uuid not null references fronts(id) on delete cascade,
  code text not null,
  name text not null,
  unit text not null,
  contract_qty numeric(14,3) not null check (contract_qty >= 0),
  planned_start date,
  planned_finish date,
  predecessors uuid[] not null default '{}',
  catalog_activity_id uuid,
  external_ref text, -- id en MS Project / Primavera
  unique (front_id, code)
);

create table elements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  front_id uuid references fronts(id),
  activity_id uuid references activities(id),
  kind element_kind not null,
  code text not null,
  qr_code text,
  qty numeric(14,3) not null default 1,
  geom geometry(Geometry, 4326),
  unique (project_id, code)
);
create index elements_geom_idx on elements using gist (geom);
create index elements_qr_idx on elements (qr_code);

-- Planos georreferenciados (PDF/imagen con 4 esquinas, o capa vectorial)
create table site_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  front_id uuid references fronts(id),
  name text not null,
  version int not null default 1,
  storage_path text not null,
  source_format text not null check (source_format in ('pdf','png','jpg','geotiff','kml','geojson','dxf')),
  -- esquinas [sup-izq, sup-der, inf-der, inf-izq] en lon/lat, formato de ImageSource de MapLibre
  corners jsonb,
  control_points jsonb, -- [{px:[x,y], geo:[lon,lat]}]
  size_bytes bigint,
  created_at timestamptz not null default now()
);

-- ---------- Formatos versionados ----------
create table form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  category text not null, -- avance, inspección, checklist, informe
  work_type text,         -- solar, vial, civil...
  current_version int not null default 1,
  archived boolean not null default false
);

create table form_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references form_templates(id) on delete cascade,
  version int not null,
  schema jsonb not null, -- definición de campos (inmutable)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

-- ---------- Registros de avance ----------
create table progress_entries (
  id uuid primary key,
  project_id uuid not null references projects(id),
  front_id uuid not null references fronts(id),
  activity_id uuid not null references activities(id),
  template_version_id uuid references form_template_versions(id),
  work_date date not null,
  quantity numeric(14,3) not null check (quantity >= 0),
  effective_hours numeric(5,2) not null default 0,
  lost_hours numeric(5,2) not null default 0,
  loss_cause loss_cause not null default 'none',
  weather weather_kind,
  crew_size int not null default 0,
  notes text not null default '',
  location geometry(Point, 4326),
  gps_accuracy_m real,
  values jsonb not null default '{}',
  status entry_status not null default 'submitted',
  signature_path text,
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  adjusts_entry_id uuid references progress_entries(id), -- corrección de un aprobado
  device_id text not null,
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create index progress_entries_activity_date_idx on progress_entries (activity_id, work_date);
create index progress_entries_project_date_idx on progress_entries (project_id, work_date);

create table entry_resources (
  id uuid primary key,
  entry_id uuid not null references progress_entries(id) on delete cascade,
  resource_id uuid, -- resource_catalog
  description text not null,
  units numeric(8,2) not null default 1,
  hours numeric(6,2) not null default 0
);

create table entry_elements (
  entry_id uuid not null references progress_entries(id) on delete cascade,
  element_id uuid not null references elements(id),
  primary key (entry_id, element_id)
);

create table progress_areas (
  id uuid primary key,
  entry_id uuid not null references progress_entries(id) on delete cascade,
  geom geometry(Polygon, 4326) not null,
  area_m2 numeric(14,2) generated always as (st_area(geom::geography)) stored,
  is_approximate boolean not null default true
);
create index progress_areas_geom_idx on progress_areas using gist (geom);

create table photos (
  id uuid primary key,
  entry_id uuid references progress_entries(id) on delete cascade,
  finding_id uuid,
  storage_path text not null,
  taken_at timestamptz not null,
  location geometry(Point, 4326),
  annotation text,
  uploaded boolean not null default false
);

-- ---------- Hallazgos ----------
create table findings (
  id uuid primary key,
  project_id uuid not null references projects(id),
  front_id uuid references fronts(id),
  type finding_type not null,
  severity severity not null,
  status finding_status not null default 'open',
  description text not null,
  location geometry(Point, 4326),
  responsible_user_id uuid references auth.users(id),
  due_date date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  version int not null default 1
);
alter table photos add constraint photos_finding_fk foreign key (finding_id) references findings(id) on delete cascade;

create table finding_events (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  from_status finding_status,
  to_status finding_status not null,
  comment text,
  by_user uuid references auth.users(id),
  at timestamptz not null default now()
);

-- ---------- Biblioteca de rendimientos y costos ----------
create table resource_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,              -- "Excavadora 20 t", "Cuadrilla montaje trackers"
  kind text not null check (kind in ('equipment','crew')),
  unit text not null,              -- m3, pilotes, m, unid
  ref_rate numeric(12,3) not null, -- rendimiento de referencia por hora
  rate_basis text not null default 'hour' check (rate_basis in ('hour','day')),
  mechanical_availability numeric(4,3) not null default 0.85,
  factors jsonb not null default '{}', -- esponjamiento, suelo, clima, curva aprendizaje...
  ownership ownership not null default 'rented',
  cost_per_hour numeric(14,2) not null default 0,   -- alquiler o costo propio
  operator_cost_per_hour numeric(14,2) not null default 0,
  fuel_cost_per_hour numeric(14,2) not null default 0,
  maintenance_cost_per_hour numeric(14,2) not null default 0,
  mobilization_cost numeric(14,2) not null default 0, -- ida + vuelta
  min_rental_days int not null default 0,
  updated_at timestamptz not null default now()
);

create table cost_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  overtime_surcharge numeric(4,3) not null default 0.25,      -- recargo hora extra diurna (CST)
  night_shift_surcharge numeric(4,3) not null default 0.35,   -- recargo nocturno
  inspection_cost_per_day numeric(14,2) not null default 0,
  expected_rework_pct numeric(4,3) not null default 0.02
);

-- ---------- Contrato y simulaciones ----------
create table contracts (
  project_id uuid primary key references projects(id) on delete cascade,
  contract_value numeric(16,2) not null,
  contract_end_date date not null,
  penalty_mode text not null default 'amount' check (penalty_mode in ('amount','percent')),
  penalty_per_day numeric(16,2) not null default 0,
  penalty_percent_per_day numeric(7,5) not null default 0,
  penalty_cap_percent numeric(5,4), -- p.ej. 0.10 = 10 % del contrato
  early_bonus_per_day numeric(16,2) not null default 0,
  daily_indirect_cost numeric(16,2) not null default 0,
  annual_discount_rate numeric(5,4),
  claimable_causes loss_cause[] not null default '{weather,permits,design_client}'
);

create table simulations (
  id uuid primary key,
  project_id uuid not null references projects(id),
  name text not null,
  assumptions jsonb not null, -- snapshot inmutable de supuestos (marcando real vs. estimado)
  results jsonb not null,
  chosen_scenario text,
  rationale text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- Alertas y auditoría ----------
create table alerts (
  id uuid primary key,
  project_id uuid not null references projects(id),
  kind text not null, -- critical_finding, due_soon, overdue, low_rate, no_report, stale_sync, late_projection
  severity severity not null,
  title text not null,
  body text not null,
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);

create table notification_channels (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('push','email','whatsapp','telegram','sms')),
  address text not null,
  enabled boolean not null default true,
  primary key (user_id, channel)
);

create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  by_user uuid,
  at timestamptz not null default now()
);

-- Vista de avance acumulado por actividad
create view activity_progress as
select a.id as activity_id, a.project_id, a.front_id, a.contract_qty,
       coalesce(sum(pe.quantity) filter (where pe.status in ('submitted','approved')), 0) as executed_qty,
       case when a.contract_qty > 0
            then round(100 * coalesce(sum(pe.quantity) filter (where pe.status in ('submitted','approved')), 0) / a.contract_qty, 2)
            else 0 end as pct
from activities a
left join progress_entries pe on pe.activity_id = a.id
group by a.id;


-- >>>>> 20261014000002_rls_audit.sql
-- AvanceObra · seguridad (RLS), inmutabilidad de aprobados y auditoría

-- ---------- Helpers ----------
create or replace function has_project_role(p_project uuid, p_roles app_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.project_id = p_project
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = p_org);
$$;

-- ---------- RLS ----------
alter table organizations          enable row level security;
alter table profiles               enable row level security;
alter table projects               enable row level security;
alter table memberships            enable row level security;
alter table fronts                 enable row level security;
alter table activities             enable row level security;
alter table elements               enable row level security;
alter table site_plans             enable row level security;
alter table form_templates         enable row level security;
alter table form_template_versions enable row level security;
alter table progress_entries       enable row level security;
alter table entry_resources        enable row level security;
alter table entry_elements         enable row level security;
alter table progress_areas         enable row level security;
alter table photos                 enable row level security;
alter table findings               enable row level security;
alter table finding_events         enable row level security;
alter table resource_catalog       enable row level security;
alter table cost_settings          enable row level security;
alter table contracts              enable row level security;
alter table simulations            enable row level security;
alter table alerts                 enable row level security;
alter table notification_channels  enable row level security;
alter table audit_log              enable row level security;

create policy org_read on organizations for select using (is_org_member(id));
create policy profile_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy membership_read on memberships for select using (user_id = auth.uid() or has_project_role(project_id, '{admin}'));
create policy membership_admin on memberships for all using (has_project_role(project_id, '{admin}')) with check (has_project_role(project_id, '{admin}'));

create policy project_read  on projects for select using (has_project_role(id));
create policy project_admin on projects for update using (has_project_role(id, '{admin}'));

-- Estructura: lectura para miembros, edición solo admin
do $$
declare t text;
begin
  foreach t in array array['fronts','activities','elements','site_plans','cost_settings','contracts'] loop
    execute format('create policy %1$s_read on %1$s for select using (has_project_role(project_id))', t);
    execute format('create policy %1$s_admin on %1$s for all using (has_project_role(project_id, ''{admin}'')) with check (has_project_role(project_id, ''{admin}''))', t);
  end loop;
end $$;

create policy templates_read on form_templates for select using (is_org_member(org_id));
create policy templates_admin on form_templates for all using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy tv_read on form_template_versions for select
  using (exists (select 1 from form_templates t where t.id = template_id and is_org_member(t.org_id)));
create policy tv_insert on form_template_versions for insert
  with check (exists (select 1 from form_templates t where t.id = template_id and is_org_member(t.org_id)));

create policy catalog_read on resource_catalog for select using (is_org_member(org_id));
create policy catalog_write on resource_catalog for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Avance: cualquier miembro lee; campo/residente crean lo propio; residente aprueba
create policy entries_read on progress_entries for select using (has_project_role(project_id));
create policy entries_insert on progress_entries for insert
  with check (has_project_role(project_id, '{field,resident,admin}') and created_by = auth.uid());
create policy entries_update on progress_entries for update
  using ((created_by = auth.uid() and status in ('draft','submitted','rejected'))
         or has_project_role(project_id, '{resident,admin}'));
-- Solo se borran borradores propios; lo enviado o aprobado queda (el trigger lo refuerza)
create policy entries_delete_draft on progress_entries for delete using (created_by = auth.uid() and status = 'draft');

create policy entry_children_read on entry_resources for select
  using (exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id)));
create policy entry_children_write on entry_resources for insert
  with check (exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid()));
create policy entry_elements_read on entry_elements for select
  using (exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id)));
create policy entry_elements_write on entry_elements for insert
  with check (exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid()));
create policy areas_read on progress_areas for select
  using (exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id)));
create policy areas_write on progress_areas for insert
  with check (exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid()));

create policy photos_read on photos for select using (
  exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id))
  or exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));
create policy photos_write on photos for insert with check (
  exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid())
  or exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));
create policy photos_mark_uploaded on photos for update using (
  exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid())
  or exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));

create policy findings_read on findings for select using (has_project_role(project_id));
create policy findings_insert on findings for insert with check (has_project_role(project_id) and created_by = auth.uid());
create policy findings_update on findings for update using (has_project_role(project_id));
create policy finding_events_read on finding_events for select
  using (exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));
create policy finding_events_insert on finding_events for insert
  with check (exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));

create policy sims_read on simulations for select using (has_project_role(project_id, '{resident,director,admin}'));
create policy sims_insert on simulations for insert with check (has_project_role(project_id, '{resident,director,admin}') and created_by = auth.uid());
-- Las simulaciones no se editan ni se borran: sustentan decisiones.

create policy alerts_read on alerts for select using (has_project_role(project_id));
create policy alerts_insert on alerts for insert with check (has_project_role(project_id));

create policy channels_self on notification_channels for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_read on audit_log for select using (false); -- solo service_role / funciones

-- ---------- Inmutabilidad de registros aprobados ----------
create or replace function guard_approved_entries() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo se pueden borrar borradores (registro %, estado %)', old.id, old.status;
    end if;
    return old;
  end if;
  if old.status = 'approved' then
    raise exception 'El registro % está aprobado y no se puede modificar; cree un registro de ajuste', old.id;
  end if;
  -- Aprobar o rechazar solo lo puede hacer residente/admin
  if new.status in ('approved','rejected') and new.status is distinct from old.status then
    if not has_project_role(new.project_id, '{resident,admin}') then
      raise exception 'Solo el residente puede aprobar o rechazar';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create trigger progress_entries_guard
  before update or delete on progress_entries
  for each row execute function guard_approved_entries();

-- ---------- Ciclo de vida de hallazgos ----------
create or replace function guard_finding_transition() returns trigger language plpgsql as $$
declare allowed boolean;
begin
  if new.status is distinct from old.status then
    allowed := (old.status, new.status) in (
      ('open','in_correction'), ('in_correction','to_review'),
      ('to_review','closed'), ('to_review','in_correction'));
    if not allowed then
      raise exception 'Transición no permitida: % -> %', old.status, new.status;
    end if;
    if new.status = 'closed' then
      if not has_project_role(new.project_id, '{resident,admin}') then
        raise exception 'Solo el residente puede cerrar un hallazgo';
      end if;
      new.closed_at := now();
    end if;
    insert into finding_events (finding_id, from_status, to_status, by_user)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create trigger findings_guard before update on findings
  for each row execute function guard_finding_transition();

-- Hallazgo crítico -> alerta inmediata (el despacho lo hace la Edge Function alerts-dispatch)
create or replace function alert_on_critical_finding() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.severity = 'critical' then
    insert into alerts (id, project_id, kind, severity, title, body, ref_table, ref_id)
    values (gen_random_uuid(), new.project_id, 'critical_finding', 'critical',
            'Hallazgo crítico', left(new.description, 280), 'findings', new.id);
  end if;
  return new;
end $$;

create trigger findings_critical_alert after insert on findings
  for each row execute function alert_on_critical_finding();

-- ---------- Auditoría ----------
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  -- No todas las tablas tienen columna id (contracts usa project_id como clave)
  insert into audit_log (table_name, row_id, action, old_data, new_data, by_user)
  values (tg_table_name, coalesce(v_row->>'id', v_row->>'project_id')::uuid, tg_op, v_old, v_new, auth.uid());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['progress_entries','findings','contracts','resource_catalog','activities','simulations'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;


-- >>>>> 20261014000003_sync.sql
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


-- >>>>> seed/demo_solar.sql
-- =====================================================================================
-- AvanceObra · Datos de prueba: "Parque Solar Demo" (fotovoltaico, trackers de un eje)
--
-- Uso (en el SQL Editor de Supabase, después de las migraciones):
--   select seed_demo_solar('admin@tuempresa.com');
--   -- opcional, con usuarios por rol:
--   select seed_demo_solar('admin@tuempresa.com', 'supervisor@tuempresa.com', 'residente@tuempresa.com');
--
-- Los correos deben existir antes en Authentication > Users. La función es idempotente:
-- si el proyecto PV-DEMO ya existe, solo agrega las membresías que falten.
--
-- Geometría: origen en 9.9500 N, -73.6500 W (Cesar, Colombia). Coordenadas locales en metros
-- (x hacia el este, y hacia el norte) convertidas a grados.
--   Bloque A: x 0–72 m · Bloque B: x 110–182 m · 2 filas de 12 trackers (60 m × 2,2 m, pitch 6 m)
--   8 pilotes por tracker → 192 pilotes por bloque.
-- =====================================================================================

create or replace function demo_lon(x_m double precision) returns double precision
language sql immutable as $$ select -73.6500 + x_m / 109647.0 $$;

create or replace function demo_lat(y_m double precision) returns double precision
language sql immutable as $$ select 9.9500 + y_m / 110574.0 $$;

create or replace function demo_pt(x_m double precision, y_m double precision) returns geometry
language sql immutable as $$ select st_setsrid(st_makepoint(demo_lon(x_m), demo_lat(y_m)), 4326) $$;

create or replace function demo_rect(x0 double precision, y0 double precision, x1 double precision, y1 double precision)
returns geometry language sql immutable as $$
  select st_setsrid(st_makepolygon(st_makeline(array[
    st_makepoint(demo_lon(x0), demo_lat(y0)), st_makepoint(demo_lon(x1), demo_lat(y0)),
    st_makepoint(demo_lon(x1), demo_lat(y1)), st_makepoint(demo_lon(x0), demo_lat(y1)),
    st_makepoint(demo_lon(x0), demo_lat(y0))])), 4326)
$$;

create or replace function seed_demo_solar(
  p_admin_email text,
  p_field_email text default null,
  p_resident_email text default null
) returns uuid language plpgsql as $$
declare
  v_admin uuid;
  v_field uuid;
  v_resident uuid;
  v_org uuid;
  v_sub uuid;
  v_project uuid;
  v_front uuid;
  v_fronts jsonb := '{}';
  v_acts jsonb := '{}';
  v_act uuid;
  v_entry uuid;
  b record;
  r int; c int; k int; n int;
  v_tracker_code text;
  d int;
  v_date date;
  v_qty double precision;
  v_lost double precision;
  v_cause loss_cause;
  v_weather weather_kind;
  v_status entry_status;
  v_done_a int := 0;
  v_done_b int := 0;
  v_trk_a int := 0;
  v_zan int := 0;
begin
  select id into v_admin from auth.users where lower(email) = lower(p_admin_email);
  if v_admin is null then
    raise exception 'No existe el usuario %. Créalo primero en Authentication > Users.', p_admin_email;
  end if;
  if p_field_email is not null then
    select id into v_field from auth.users where lower(email) = lower(p_field_email);
    if v_field is null then raise exception 'No existe el usuario %', p_field_email; end if;
  end if;
  if p_resident_email is not null then
    select id into v_resident from auth.users where lower(email) = lower(p_resident_email);
    if v_resident is null then raise exception 'No existe el usuario %', p_resident_email; end if;
  end if;

  -- Perfiles
  insert into profiles (id, full_name)
  select u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
  from auth.users u where u.id in (v_admin, v_field, v_resident)
  on conflict (id) do nothing;

  select id into v_project from projects where code = 'PV-DEMO';
  if v_project is not null then
    select org_id into v_org from projects where id = v_project;
  else
    -- ---------- Organización y proyecto ----------
    insert into organizations (name, tax_id) values ('Constructora Demo S.A.S.', '900000000-1') returning id into v_org;
    insert into organizations (name, tax_id, parent_org_id) values ('Montajes Solares Demo S.A.S.', '900000000-2', v_org) returning id into v_sub;

    insert into projects (org_id, code, name, project_type, currency, start_date, contract_end_date, bbox)
    values (v_org, 'PV-DEMO', 'Parque Solar Demo · Cesar', 'solar', 'COP',
            current_date - 30, current_date + 30, demo_rect(-15, -15, 197, 141))
    returning id into v_project;

    insert into contracts (project_id, contract_value, contract_end_date, penalty_mode, penalty_per_day,
                           penalty_cap_percent, early_bonus_per_day, daily_indirect_cost)
    values (v_project, 48000000000, current_date + 30, 'amount', 24000000, 0.10, 0, 18000000);

    insert into cost_settings (project_id, inspection_cost_per_day, expected_rework_pct)
    values (v_project, 1200000, 0.02);

    insert into resource_catalog (org_id, name, kind, unit, ref_rate, rate_basis, mechanical_availability, ownership,
                                  cost_per_hour, operator_cost_per_hour, fuel_cost_per_hour, mobilization_cost, min_rental_days)
    values
      (v_org, 'Hincadora de pilotes', 'equipment', 'pilotes', 14, 'hour', 0.85, 'rented', 260000, 30000, 45000, 6000000, 30),
      (v_org, 'Cuadrilla montaje de trackers (8 personas)', 'crew', 'trackers', 1.2, 'day', 1, 'own', 0, 220000, 0, 0, 0),
      (v_org, 'Cuadrilla instalación de módulos (10 personas)', 'crew', 'módulos', 16, 'hour', 1, 'own', 0, 270000, 0, 0, 0),
      (v_org, 'Retroexcavadora para zanjas', 'equipment', 'm', 9, 'hour', 0.85, 'rented', 150000, 25000, 30000, 2500000, 15),
      (v_org, 'Cuadrilla tendido de cable MT (6 personas)', 'crew', 'm', 12, 'hour', 1, 'own', 0, 165000, 0, 0, 0);

    -- ---------- Frentes y actividades ----------
    for b in select * from (values ('BA', 'Bloque A', 0.0), ('BB', 'Bloque B', 110.0)) as t(code, name, x_off) loop
      insert into fronts (project_id, code, name, max_parallel_resources, geom)
      values (v_project, b.code, b.name, 3, demo_rect(b.x_off - 3, -10, b.x_off + 75, 129))
      returning id into v_front;
      v_fronts := v_fronts || jsonb_build_object(b.code, v_front);

      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-HIN', 'Hincado de pilotes', 'pilotes', 192, current_date - 22, current_date + 10)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-HIN', v_act);
      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-MON', 'Montaje de trackers', 'trackers', 24, current_date - 15, current_date + 20)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-MON', v_act);
      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-MOD', 'Instalación de módulos', 'módulos', 2016, current_date - 8, current_date + 25)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-MOD', v_act);
      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-ZAN', 'Zanjas DC', 'm', 900, current_date - 20, current_date + 15)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-ZAN', v_act);

      -- Trackers (polígonos) y pilotes (puntos), con su código QR
      for r in 0..1 loop
        for c in 0..11 loop
          n := r * 12 + c + 1;
          v_tracker_code := right(b.code, 1) || '-T' || lpad(n::text, 2, '0');
          insert into elements (project_id, front_id, activity_id, kind, code, qr_code, qty, geom)
          values (v_project, v_front, (v_acts->>(b.code || '-MON'))::uuid, 'tracker', v_tracker_code, 'QR-' || v_tracker_code, 1,
                  demo_rect(b.x_off + c * 6, r * 66, b.x_off + c * 6 + 2.2, r * 66 + 60));
          for k in 0..7 loop
            insert into elements (project_id, front_id, activity_id, kind, code, qr_code, qty, geom)
            values (v_project, v_front, (v_acts->>(b.code || '-HIN'))::uuid, 'pile', v_tracker_code || '-P' || (k + 1),
                    'QR-' || v_tracker_code || '-P' || (k + 1), 1,
                    demo_pt(b.x_off + c * 6 + 1.1, r * 66 + k * (60.0 / 7)));
          end loop;
        end loop;
      end loop;
    end loop;

    insert into fronts (project_id, code, name, max_parallel_resources, geom)
    values (v_project, 'CS', 'Cableado MT y subestación', 2, demo_rect(-15, -15, 197, -5))
    returning id into v_front;
    v_fronts := v_fronts || jsonb_build_object('CS', v_front);
    insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
    values (v_project, v_front, 'CS-TMT', 'Tendido de cable MT', 'm', 2400, current_date - 10, current_date + 28)
    returning id into v_act;
    v_acts := v_acts || jsonb_build_object('CS-TMT', v_act);
    insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
    values (v_project, v_front, 'CS-CIV', 'Obra civil subestación (concreto)', 'm3', 180, current_date + 5, current_date + 28)
    returning id into v_act;
    v_acts := v_acts || jsonb_build_object('CS-CIV', v_act);

    -- Plano georreferenciado (la imagen se sube aparte al bucket "plans" con esta misma ruta)
    insert into site_plans (project_id, name, version, storage_path, source_format, corners)
    values (v_project, 'Layout general', 1, v_project || '/plano-demo.png', 'png',
            jsonb_build_array(
              jsonb_build_array(demo_lon(-15), demo_lat(141)), jsonb_build_array(demo_lon(197), demo_lat(141)),
              jsonb_build_array(demo_lon(197), demo_lat(-15)), jsonb_build_array(demo_lon(-15), demo_lat(-15))));

    -- ---------- Historial de 20 días ----------
    for d in reverse 20..1 loop
      v_date := current_date - d;
      continue when extract(isodow from v_date) = 7; -- domingo
      v_status := case when d > 3 then 'approved' else 'submitted' end;

      -- Bloque A · hincado (con lluvia, equipo, material y permisos para el Pareto)
      v_lost := 0; v_cause := 'none'; v_weather := 'sunny'; v_qty := 11;
      if d in (15, 9) then v_qty := 3; v_lost := 5; v_cause := 'weather'; v_weather := 'heavy_rain';
      elsif d = 18 then v_qty := 8; v_lost := 2; v_cause := 'weather'; v_weather := 'light_rain';
      elsif d = 12 then v_qty := 6; v_lost := 3; v_cause := 'equipment';
      elsif d = 6 then v_qty := 7; v_lost := 2.5; v_cause := 'material'; v_weather := 'cloudy';
      elsif d = 4 then v_qty := 8; v_lost := 2; v_cause := 'permits';
      end if;
      v_qty := least(v_qty, 192 - v_done_a);
      if v_qty > 0 then
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, notes, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-HIN')::uuid, v_date, v_qty, 8 - v_lost, v_lost,
          v_cause, v_weather, 6, case v_cause when 'equipment' then 'Falla hidráulica hincadora 2' when 'material' then 'Llegada tardía de perfiles' else '' end,
          demo_pt(36, 60), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end,
          'seed', v_date + time '17:30');
        insert into entry_elements (project_id, entry_id, element_id)
        select v_project, v_entry, e.id from elements e
        where e.activity_id = (v_acts->>'BA-HIN')::uuid order by e.code offset v_done_a limit v_qty::int;
        v_done_a := v_done_a + v_qty::int;
      end if;

      -- Bloque A · montaje de trackers (1 por día desde hace 14 días, solo trackers con pilotes completos)
      if d <= 14 and v_trk_a < (v_done_a / 8) then
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-MON')::uuid, v_date, 1, 8, 0, 'none', v_weather, 8,
          demo_pt(30, 30), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:40');
        insert into entry_elements (project_id, entry_id, element_id)
        select v_project, v_entry, e.id from elements e
        where e.activity_id = (v_acts->>'BA-MON')::uuid order by e.code offset v_trk_a limit 1;
        v_trk_a := v_trk_a + 1;
      end if;

      -- Bloque A · zanjas DC con área trabajada dibujada
      if d <= 18 then
        v_qty := case when v_weather = 'heavy_rain' then 15 else 45 end;
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-ZAN')::uuid, v_date, v_qty,
          case when v_weather = 'heavy_rain' then 3 else 8 end, case when v_weather = 'heavy_rain' then 5 else 0 end,
          case when v_weather = 'heavy_rain' then 'weather' else 'none' end::loss_cause, v_weather, 5,
          demo_pt(36, -8), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:50');
        if v_zan < 70 then
          insert into progress_areas (id, project_id, entry_id, geom, is_approximate)
          values (gen_random_uuid(), v_project, v_entry, demo_rect(v_zan, -9, least(v_zan + 8, 72), -7.5), true);
          v_zan := v_zan + 8;
        end if;
      end if;

      -- Bloque A · módulos (desde hace 8 días)
      if d <= 8 then
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-MOD')::uuid, v_date,
          case when d = 6 then 60 else 126 end, case when d = 6 then 6 else 8 end, case when d = 6 then 2 else 0 end,
          case when d = 6 then 'material' else 'none' end::loss_cause, v_weather, 10,
          demo_pt(20, 30), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:55');
      end if;

      -- Bloque B · hincado lento (inició hace 6 días): genera proyección tardía y alerta
      if d <= 6 then
        v_qty := case when d = 4 then 3 else 6 end;
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, notes, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BB')::uuid, (v_acts->>'BB-HIN')::uuid, v_date, v_qty,
          case when d = 4 then 4 else 7 end, case when d = 4 then 4 else 1 end,
          case when d = 4 then 'permits' else 'labor' end::loss_cause, v_weather, 4,
          case when d = 4 then 'Permiso de trabajo en caliente sin firmar' else 'Cuadrilla incompleta' end,
          demo_pt(146, 60), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:35');
        insert into entry_elements (project_id, entry_id, element_id)
        select v_project, v_entry, e.id from elements e
        where e.activity_id = (v_acts->>'BB-HIN')::uuid order by e.code offset v_done_b limit v_qty::int;
        v_done_b := v_done_b + v_qty::int;
      end if;

      -- Cableado MT (desde hace 10 días)
      if d <= 10 then
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (gen_random_uuid(), v_project, (v_fronts->>'CS')::uuid, (v_acts->>'CS-TMT')::uuid, v_date,
          case when d in (9, 3) then 40 else 85 end, case when d in (9, 3) then 5 else 8 end, case when d in (9, 3) then 3 else 0 end,
          case when d = 9 then 'weather' when d = 3 then 'design_client' else 'none' end::loss_cause, v_weather, 6,
          demo_pt(90, -10), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '18:05');
      end if;
    end loop;

    -- ---------- Hallazgos ----------
    insert into findings (id, project_id, front_id, type, severity, status, description, location, responsible_user_id,
                          due_date, created_by, created_at)
    values
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'safety', 'critical', 'open',
       'Zanja DC abierta sin señalización ni barandas en el tramo sur del Bloque A',
       demo_pt(50, -8), coalesce(v_field, v_admin), current_date - 1, coalesce(v_field, v_admin), now() - interval '2 days'),
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'quality', 'high', 'in_correction',
       'Pilote A-T03-P5 fuera de tolerancia de verticalidad (2,1° medido > 1,5° admisible)',
       demo_pt(13.1, 34.3), coalesce(v_field, v_admin), current_date + 2, coalesce(v_resident, v_admin), now() - interval '4 days'),
      (gen_random_uuid(), v_project, (v_fronts->>'BB')::uuid, 'environment', 'medium', 'open',
       'Derrame menor de ACPM junto a la hincadora 2; falta kit antiderrames',
       demo_pt(150, 20), coalesce(v_field, v_admin), current_date + 5, coalesce(v_field, v_admin), now() - interval '1 day'),
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'operation', 'low', 'to_review',
       'Falta rotulado de strings en el tracker A-T05',
       demo_pt(25, 30), coalesce(v_field, v_admin), current_date + 3, coalesce(v_field, v_admin), now() - interval '9 days'),
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'quality', 'medium', 'closed',
       'Torque de pernos de módulos por debajo de especificación en A-T01 (corregido y verificado)',
       demo_pt(1, 30), coalesce(v_field, v_admin), current_date - 6, coalesce(v_resident, v_admin), now() - interval '12 days');
  end if;

  -- ---------- Membresías (idempotente) ----------
  insert into memberships (user_id, project_id, org_id, role, member_name)
  select v_admin, v_project, v_org, 'admin', coalesce((select full_name from profiles where id = v_admin), p_admin_email)
  on conflict (user_id, project_id) do nothing;
  if v_field is not null then
    insert into memberships (user_id, project_id, org_id, role, member_name)
    select v_field, v_project, v_org, 'field', coalesce((select full_name from profiles where id = v_field), p_field_email)
    on conflict (user_id, project_id) do nothing;
  end if;
  if v_resident is not null then
    insert into memberships (user_id, project_id, org_id, role, member_name)
    select v_resident, v_project, v_org, 'resident', coalesce((select full_name from profiles where id = v_resident), p_resident_email)
    on conflict (user_id, project_id) do nothing;
  end if;

  return v_project;
end $$;
