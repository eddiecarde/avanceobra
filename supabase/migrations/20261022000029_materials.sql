-- Materiales en obra: qué consume cada actividad, entregas recibidas y alerta cuando quedan pocos
-- días de material al ritmo actual de instalación.

create table materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  unit text not null check (length(trim(unit)) between 1 and 20),
  -- Alerta cuando el material alcanza para menos de estos días de trabajo
  low_days int not null default 3 check (low_days between 1 and 60),
  notes text,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

-- Consumo: por cada unidad ejecutada de la actividad se usan `factor` unidades del material
-- (1 módulo por módulo instalado; 2 pilotes por mesa; 1,05 m de cable por metro tendido…)
create table material_usage (
  material_id uuid not null references materials(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  factor numeric(14,6) not null check (factor > 0),
  primary key (material_id, activity_id)
);

create table material_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  delivered_on date not null,
  quantity numeric(14,3) not null check (quantity > 0),
  document text,
  supplier text,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index material_deliveries_material on material_deliveries (material_id, delivered_on);

alter table materials enable row level security;
alter table material_usage enable row level security;
alter table material_deliveries enable row level security;
create policy materials_read on materials for select using (has_project_role(project_id));
create policy materials_write on materials for all using (has_project_role(project_id, '{resident,director,admin}')) with check (has_project_role(project_id, '{resident,director,admin}'));
create policy usage_read on material_usage for select using (has_project_role(project_id));
create policy usage_write on material_usage for all using (has_project_role(project_id, '{resident,director,admin}')) with check (has_project_role(project_id, '{resident,director,admin}'));
create policy deliveries_read on material_deliveries for select using (has_project_role(project_id));
-- Cualquiera del proyecto registra lo que llega (almacenista, supervisor); corrige o borra el residente
create policy deliveries_insert on material_deliveries for insert with check (has_project_role(project_id) and created_by = auth.uid());
create policy deliveries_fix on material_deliveries for update using (has_project_role(project_id, '{resident,director,admin}'));
create policy deliveries_delete on material_deliveries for delete using (has_project_role(project_id, '{resident,director,admin}'));
create trigger material_deliveries_audit after insert or update or delete on material_deliveries for each row execute function audit_row();

/**
 * Material por agotarse: existencias (entregado − consumido) ÷ consumo diario de las últimas dos
 * semanas (12 días de trabajo). Avisa si alcanza para menos de `low_days` días y aún falta instalar
 * más de lo que hay. Corre cada mañana; el despacho por Telegram lo hace el job de alertas.
 */
create or replace function generate_material_alerts(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
  v_today date := bogota_today(p_now);
  v_days numeric;
begin
  if auth.uid() is not null then raise exception 'No autorizado' using errcode = '42501'; end if;
  for r in
    select m.id, m.project_id, m.name, m.unit, m.low_days,
           coalesce((select sum(d.quantity) from material_deliveries d where d.material_id = m.id and d.delivered_on <= v_today), 0) as delivered,
           coalesce((select sum(e.quantity * u.factor) from material_usage u join progress_entries e on e.activity_id = u.activity_id
                     where u.material_id = m.id and e.status in ('submitted', 'approved') and e.work_date <= v_today), 0) as consumed,
           coalesce((select sum(e.quantity * u.factor) from material_usage u join progress_entries e on e.activity_id = u.activity_id
                     where u.material_id = m.id and e.status in ('submitted', 'approved') and e.work_date > v_today - 14 and e.work_date <= v_today), 0) / 12.0 as rate,
           coalesce((select sum(a.contract_qty * u.factor) from material_usage u join activities a on a.id = u.activity_id where u.material_id = m.id), 0) as required
    from materials m
  loop
    continue when r.rate <= 0;
    v_days := (r.delivered - r.consumed) / r.rate;
    continue when v_days >= r.low_days or (r.required - r.consumed) <= (r.delivered - r.consumed);
    if insert_alert_once(r.project_id, 'material_low', (case when v_days <= 0 then 'critical' else 'high' end)::severity,
         format('Material por agotarse: %s', r.name),
         format('Quedan %s %s, para %s día(s) al ritmo actual (%s por día). Faltan por entregar %s %s.',
                num_es(round(greatest(r.delivered - r.consumed, 0), 1)), r.unit, num_es(round(greatest(v_days, 0), 1)), num_es(round(r.rate, 1)),
                num_es(round(greatest(r.required - r.delivered, 0), 1)), r.unit),
         'materials', r.id, p_now) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function generate_material_alerts(timestamptz) from public, anon, authenticated;
