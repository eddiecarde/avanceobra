-- AvanceObra · costos, productividad y alertas tempranas
-- Presupuesto por actividad (costo directo por unidad), costo de la hora-hombre, costos que no salen
-- del campo (materiales, subcontratos) y alertas cuando una actividad pierde productividad, acumula
-- restricciones o va a terminar tarde.

alter table activities add column budget_unit_cost numeric(16,2) check (budget_unit_cost is null or budget_unit_cost >= 0);
alter table cost_settings add column labor_cost_per_hour numeric(14,2) not null default 0 check (labor_cost_per_hour >= 0);

-- Costos registrados a mano: lo que el campo no captura (la mano de obra y los equipos se estiman de
-- los registros de avance y no se registran aquí, para no contarlos dos veces)
create table cost_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  record_date date not null default current_date,
  kind text not null check (kind in ('material', 'subcontrato', 'otro')),
  description text not null check (length(trim(description)) >= 3),
  amount numeric(16,2) not null check (amount > 0),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index cost_records_project on cost_records (project_id, activity_id);
alter table cost_records enable row level security;
-- Los costos no los ve el supervisor de campo
create policy cost_records_read on cost_records for select using (has_project_role(project_id, '{resident,director,admin}'));
create policy cost_records_write on cost_records for all
  using (has_project_role(project_id, '{director,admin}')) with check (has_project_role(project_id, '{director,admin}'));
create trigger cost_records_audit after insert or update or delete on cost_records for each row execute function audit_row();

/** Número con coma decimal, como se escribe en Colombia. */
create or replace function num_es(x numeric) returns text language sql immutable as $$ select replace(x::text, '.', ',') $$;

/**
 * Alertas tempranas de producción (se programan a diario):
 *  - productivity_drop: la productividad (cantidad por hora-hombre) de los últimos 7 días cae más
 *    del 20 % frente a las 3 semanas anteriores.
 *  - constraints: una actividad con 2 o más restricciones abiertas, o alguna vencida.
 *  - late_projection: al ritmo de los últimos 14 días no alcanza a terminar en la fecha planeada.
 */
create or replace function generate_production_alerts(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
  v_today date := bogota_today(p_now);
begin
  if auth.uid() is not null then raise exception 'No autorizado' using errcode = '42501'; end if;

  -- Productividad: cantidad / (personal × horas efectivas)
  for r in
    select a.id, a.project_id, a.code, a.name, a.unit,
           sum(e.quantity) filter (where e.work_date > v_today - 7) as q_now,
           sum(e.crew_size * e.effective_hours) filter (where e.work_date > v_today - 7) as hh_now,
           sum(e.quantity) filter (where e.work_date <= v_today - 7) as q_before,
           sum(e.crew_size * e.effective_hours) filter (where e.work_date <= v_today - 7) as hh_before
    from activities a
    join progress_entries e on e.activity_id = a.id
    where e.status in ('submitted', 'approved') and e.work_date > v_today - 28 and e.work_date <= v_today
    group by a.id
  loop
    if coalesce(r.hh_now, 0) >= 16 and coalesce(r.hh_before, 0) >= 40 and r.q_before > 0
       and (r.q_now / r.hh_now) < 0.8 * (r.q_before / r.hh_before) then
      if insert_alert_once(r.project_id, 'productivity_drop',
           case when (r.q_now / r.hh_now) < 0.6 * (r.q_before / r.hh_before) then 'high' else 'medium' end::severity,
           'Baja la productividad',
           format('%s · %s: %s %s por hora-hombre esta semana contra %s antes (−%s %%).', r.code, r.name,
                  num_es(round(r.q_now / r.hh_now, 2)), r.unit, num_es(round(r.q_before / r.hh_before, 2)),
                  round(100 * (1 - (r.q_now / r.hh_now) / (r.q_before / r.hh_before)))),
           'activities', r.id, p_now) then n := n + 1; end if;
    end if;
  end loop;

  -- Restricciones acumuladas o vencidas
  for r in
    select a.id, a.project_id, a.code, a.name, count(*) as abiertas, count(*) filter (where c.need_by < v_today) as vencidas
    from project_constraints c join activities a on a.id = c.activity_id
    where c.status = 'abierta'
    group by a.id
    having count(*) >= 2 or count(*) filter (where c.need_by < v_today) > 0
  loop
    if insert_alert_once(r.project_id, 'constraints', case when r.vencidas > 0 then 'high' else 'medium' end::severity,
         'Restricciones sin liberar',
         format('%s · %s tiene %s restricción(es) abierta(s)%s.', r.code, r.name, r.abiertas,
                case when r.vencidas > 0 then format(', %s vencida(s)', r.vencidas) else '' end),
         'activities', r.id, p_now) then n := n + 1; end if;
  end loop;

  -- Terminación en riesgo: lo que falta no alcanza al ritmo de los últimos 14 días
  for r in
    select a.id, a.project_id, a.code, a.name, a.unit, a.planned_finish, a.contract_qty,
           coalesce(sum(e.quantity), 0) as hecho,
           coalesce(sum(e.quantity) filter (where e.work_date > v_today - 14), 0) as q14,
           coalesce(array_length(p.workdays, 1), 6) as dias_semana
    from activities a
    join projects p on p.id = a.project_id
    left join progress_entries e on e.activity_id = a.id and e.status in ('submitted', 'approved') and e.work_date <= v_today
    where a.planned_finish >= v_today and a.planned_start <= v_today and a.contract_qty > 0
    group by a.id, p.workdays
  loop
    declare
      falta numeric := r.contract_qty - r.hecho;
      ritmo numeric := r.q14 / (14.0 * r.dias_semana / 7);
      dias numeric := greatest(1, (r.planned_finish - v_today + 1) * r.dias_semana / 7.0);
    begin
      if falta > 0 and ritmo * dias < 0.9 * falta then
        if insert_alert_once(r.project_id, 'late_projection', 'high', 'Terminación en riesgo',
             format('%s · %s: faltan %s %s y al ritmo actual (%s/día) no alcanza para el %s; necesita %s/día.',
                    r.code, r.name, num_es(round(falta, 1)), r.unit, num_es(round(ritmo, 1)), to_char(r.planned_finish, 'DD/MM'), num_es(round(falta / dias, 1))),
             'activities', r.id, p_now) then n := n + 1; end if;
      end if;
    end;
  end loop;
  return n;
end $$;
revoke all on function generate_production_alerts(timestamptz) from public, anon, authenticated;
