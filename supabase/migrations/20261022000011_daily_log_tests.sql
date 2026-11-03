-- AvanceObra · parte diario (personal por cargo, equipos, lluvia), ensayos y restricciones
-- Completan el informe semanal del cliente (formato CNX-PSS-001).
--
-- Parte diario: lo envía el supervisor desde el teléfono, también sin señal. Es "solo inserción":
-- cada envío es una fila nueva y para el informe vale el último envío de cada persona, frente y día.
-- Así no hay conflictos entre teléfonos ni ediciones que se pisen.

-- Catálogos del proyecto (los edita el administrador en la web; el teléfono los usa como lista)
alter table projects add column personnel_roles text[] not null default
  '{"Director de obra","Residente","Supervisor SST","Maestro de obra","Oficial de obra","Auxiliar de obra","Operador de equipo","Soldador","Conductor"}';
alter table projects add column equipment_types text[] not null default
  '{"Retroexcavadora","Vibrocompactador","Motoniveladora","Volqueta","Mezcladora de concreto","Vibrador de concreto","Hincadora","Canguro"}';

create table daily_logs (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  front_id uuid references fronts(id),
  log_date date not null,
  -- [{"role":"Oficial de obra","qty":4}]
  personnel jsonb not null default '[]',
  -- [{"name":"Retroexcavadora","qty":2}]
  equipment jsonb not null default '[]',
  -- [{"start":"10:15","end":"11:40"}] en hora de Colombia
  rain jsonb not null default '[]',
  observations text not null default '',
  created_by uuid references auth.users(id),
  client_created_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index daily_logs_project_date_idx on daily_logs (project_id, log_date);

create or replace function daily_logs_validate() returns trigger language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  if jsonb_typeof(new.personnel) <> 'array' or jsonb_typeof(new.equipment) <> 'array' or jsonb_typeof(new.rain) <> 'array' then
    raise exception 'Parte diario mal formado: personal, equipos y lluvia deben ser listas';
  end if;
  for it in select * from jsonb_array_elements(new.personnel || new.equipment) loop
    if coalesce(nullif(trim(coalesce(it->>'role', it->>'name')), ''), '') = '' or (it->>'qty') !~ '^\d{1,4}$' then
      raise exception 'Parte diario: cada cargo o equipo necesita nombre y una cantidad entera (0–9999)';
    end if;
  end loop;
  for it in select * from jsonb_array_elements(new.rain) loop
    if (it->>'start') !~ '^([01]\d|2[0-3]):[0-5]\d$' or (it->>'end') !~ '^([01]\d|2[0-3]):[0-5]\d$' or (it->>'start') >= (it->>'end') then
      raise exception 'Parte diario: la lluvia debe tener hora de inicio y fin (HH:MM) y el fin después del inicio';
    end if;
  end loop;
  if new.log_date > (now() at time zone 'America/Bogota')::date then
    raise exception 'El parte diario no puede ser de una fecha futura';
  end if;
  return new;
end $$;
create trigger daily_logs_validate before insert on daily_logs for each row execute function daily_logs_validate();

alter table daily_logs enable row level security;
create policy daily_logs_read on daily_logs for select using (has_project_role(project_id));
create policy daily_logs_insert on daily_logs for insert with check (has_project_role(project_id));
-- Sin UPDATE ni DELETE: una corrección es un envío nuevo (queda la traza de ambos)

/** Último envío de cada persona, frente y día: lo que cuenta para los informes. */
create or replace view daily_log_latest as
select distinct on (project_id, log_date, created_by, coalesce(front_id, '00000000-0000-0000-0000-000000000000'::uuid)) *
from daily_logs
order by project_id, log_date, created_by, coalesce(front_id, '00000000-0000-0000-0000-000000000000'::uuid), client_created_at desc, created_at desc;
alter view daily_log_latest set (security_invoker = true);

-- ---------- Ensayos y pruebas ----------
create table lab_tests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  standard text,              -- norma (p. ej. INV E-142, NTC 673)
  sample_date date,           -- toma de la muestra
  sent_date date,             -- envío al laboratorio
  lab text,
  status text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'aprobado', 'rechazado', 'no_aplica')),
  result text,
  observation text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lab_tests_project_idx on lab_tests (project_id);

-- ---------- Restricciones (lo que impide avanzar y quién lo libera) ----------
create table project_constraints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  description text not null check (length(trim(description)) > 0),
  responsible text,
  need_by date,
  status text not null default 'abierta' check (status in ('abierta', 'liberada')),
  released_at date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_constraints_project_idx on project_constraints (project_id);

create or replace function stamp_author_updated() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if tg_table_name = 'project_constraints' then
    if new.status = 'liberada' and new.released_at is null then new.released_at := (now() at time zone 'America/Bogota')::date; end if;
    if new.status = 'abierta' then new.released_at := null; end if;
  end if;
  return new;
end $$;
create trigger lab_tests_stamp before insert or update on lab_tests for each row execute function stamp_author_updated();
create trigger project_constraints_stamp before insert or update on project_constraints for each row execute function stamp_author_updated();

alter table lab_tests enable row level security;
alter table project_constraints enable row level security;
-- Todos los del proyecto los ven; residente, director y administrador los gestionan
create policy lab_tests_read on lab_tests for select using (has_project_role(project_id));
create policy lab_tests_write on lab_tests for all using (has_project_role(project_id, '{resident,director,admin}'))
  with check (has_project_role(project_id, '{resident,director,admin}'));
create policy constraints_read on project_constraints for select using (has_project_role(project_id));
create policy constraints_write on project_constraints for all using (has_project_role(project_id, '{resident,director,admin}'))
  with check (has_project_role(project_id, '{resident,director,admin}'));

create trigger lab_tests_audit after insert or update or delete on lab_tests for each row execute function audit_row();
create trigger project_constraints_audit after insert or update or delete on project_constraints for each row execute function audit_row();
