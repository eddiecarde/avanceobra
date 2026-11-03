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
