-- Planeación semanal (último planificador): cada semana el residente compromete por frente las
-- tareas liberadas (sin restricciones abiertas); al cerrarla se mide el porcentaje de plan cumplido
-- (PPC) y la causa de lo que no se hizo.

create table weekly_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- Lunes de la semana
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'borrador' check (status in ('borrador', 'comprometido', 'cerrado')),
  committed_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, week_start)
);

create table weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references weekly_plans(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  planned_qty numeric(14,3) not null check (planned_qty > 0),
  responsible text,
  -- Al cerrar: lo ejecutado en la semana y, si no se cumplió, por qué
  executed_qty numeric(14,3),
  done boolean,
  failure_cause text check (failure_cause is null or failure_cause in ('weather','material','equipment','permits','labor','design_client','prerequisite','planning','other')),
  failure_note text,
  unique (plan_id, activity_id)
);
create index weekly_plan_items_plan on weekly_plan_items (plan_id);

alter table weekly_plans enable row level security;
alter table weekly_plan_items enable row level security;
create policy weekly_plans_read on weekly_plans for select using (has_project_role(project_id));
create policy weekly_plans_write on weekly_plans for all using (has_project_role(project_id, '{resident,director,admin}')) with check (has_project_role(project_id, '{resident,director,admin}'));
create policy weekly_items_read on weekly_plan_items for select using (has_project_role(project_id));
create policy weekly_items_write on weekly_plan_items for all using (has_project_role(project_id, '{resident,director,admin}')) with check (has_project_role(project_id, '{resident,director,admin}'));

-- Un plan comprometido ya no cambia sus tareas (solo se cierra); uno cerrado no cambia
create or replace function guard_weekly_plan_items() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from weekly_plans where id = coalesce(new.plan_id, old.plan_id);
  if st = 'cerrado' then raise exception 'La semana ya está cerrada'; end if;
  if st = 'comprometido' and (tg_op <> 'UPDATE' or new.activity_id <> old.activity_id or new.planned_qty <> old.planned_qty) then
    raise exception 'El plan ya está comprometido: solo se registra su cumplimiento al cerrar la semana';
  end if;
  return coalesce(new, old);
end $$;
create trigger weekly_plan_items_guard before insert or update or delete on weekly_plan_items for each row execute function guard_weekly_plan_items();

create trigger weekly_plans_audit after insert or update or delete on weekly_plans for each row execute function audit_row();
