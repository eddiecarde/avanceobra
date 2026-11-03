-- AvanceObra · registro de importaciones
-- Cada importación (programación o DXF) deja quién, cuándo, qué archivo y qué cambió; además, los
-- frentes y los elementos del plano quedan en la auditoría como las actividades.

create table import_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('programacion', 'dxf')),
  file_name text not null,
  source text not null,
  -- { creados, actualizados, sin_cambio, bloqueados, omitidos, … }
  summary jsonb not null default '{}',
  -- [{ "codigo": "BA-HIN", "cambios": [{ "campo": "cantidad", "antes": "192", "despues": "200" }] }, …]
  changes jsonb not null default '[]',
  -- Si se autorizó actualizar lo que ya existía
  updated_existing boolean not null default false,
  created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index import_runs_project on import_runs (project_id, created_at desc);
alter table import_runs enable row level security;
create policy import_runs_read on import_runs for select using (has_project_role(project_id, '{resident,director,admin}'));
create policy import_runs_insert on import_runs for insert with check (has_project_role(project_id, '{admin}') and created_by = auth.uid());
-- Un registro de importación no se edita ni se borra

create trigger fronts_audit after insert or update or delete on fronts for each row execute function audit_row();
create trigger elements_audit after insert or update or delete on elements for each row execute function audit_row();
