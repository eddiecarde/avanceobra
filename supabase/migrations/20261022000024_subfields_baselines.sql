-- Planning de una planta solar: grupos de trabajo, subcampos con su circuito y orden de
-- energización, y líneas base (contractual, aceleración…) para comparar contra el plan vigente.

-- Grupo de la partida (Hincas, Módulos, Cable solar…): filas de la matriz y del KPI semanal
alter table activities add column work_group text check (work_group is null or length(trim(work_group)) between 1 and 80);

create table project_subfields (
  project_id uuid not null references projects(id) on delete cascade,
  -- Código igual a activities.subfield (p. ej. SC15)
  code text not null check (length(trim(code)) between 1 and 60),
  name text not null,
  circuit text,
  position text check (position is null or position in ('cabecera', 'cuerpo', 'cola')),
  energization_order int,
  -- Energización (hot commissioning) del plan vigente y de la línea base contractual
  planned_energization date,
  baseline_energization date,
  primary key (project_id, code)
);

create table activity_baselines (
  activity_id uuid not null references activities(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  baseline text not null check (length(trim(baseline)) between 1 and 40),
  start date,
  finish date,
  primary key (activity_id, baseline)
);
create index activity_baselines_project on activity_baselines (project_id, baseline);

alter table project_subfields enable row level security;
alter table activity_baselines enable row level security;
create policy subfields_read on project_subfields for select using (has_project_role(project_id));
create policy subfields_write on project_subfields for all using (has_project_role(project_id, '{admin,director}')) with check (has_project_role(project_id, '{admin,director}'));
create policy baselines_read on activity_baselines for select using (has_project_role(project_id));
create policy baselines_write on activity_baselines for all using (has_project_role(project_id, '{admin,director}')) with check (has_project_role(project_id, '{admin,director}'));

create trigger project_subfields_audit after insert or update or delete on project_subfields for each row execute function audit_row();
