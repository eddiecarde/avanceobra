-- Avisos personales en el teléfono: llegan por la sincronización (sin depender de Firebase) y la
-- app los muestra como notificación y en su bandeja. Los crea la base de datos cuando:
-- · a alguien le asignan un hallazgo (o a su empresa, si no hay persona responsable);
-- · deciden la corrección que pidió;
-- · le rechazan un registro de avance;
-- · un hallazgo suyo vence hoy o ya está vencido (cada mañana).

create table user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('finding_assigned', 'correction_decided', 'entry_rejected', 'finding_due')),
  title text not null,
  body text not null,
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index user_notifications_user on user_notifications (user_id, created_at desc);

alter table user_notifications enable row level security;
create policy notifications_own on user_notifications for select using (user_id = auth.uid());
-- Solo se marca como leído
create policy notifications_read_mark on user_notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function notify_user(p_user uuid, p_project uuid, p_kind text, p_title text, p_body text, p_ref_table text, p_ref_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into user_notifications (user_id, project_id, kind, title, body, ref_table, ref_id)
  select p_user, p_project, p_kind, left(p_title, 140), left(p_body, 400), p_ref_table, p_ref_id
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function notify_user(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Hallazgo asignado: a la persona responsable o, si no hay, a la gente de la empresa responsable
create or replace function notify_finding_assigned() returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text := case new.category when 'no_conformidad' then 'una no conformidad' when 'punch' then 'un punch' else 'un hallazgo' end;
  m record;
begin
  if new.status = 'closed' then return new; end if;
  if new.responsible_user_id is not null and (tg_op = 'INSERT' or new.responsible_user_id is distinct from old.responsible_user_id) then
    perform notify_user(new.responsible_user_id, new.project_id, 'finding_assigned', format('Te asignaron %s', label),
      new.description || coalesce(' · límite ' || new.due_date, ''), 'findings', new.id);
  elsif new.responsible_user_id is null and new.company_id is not null and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id) then
    for m in select user_id from memberships where project_id = new.project_id and company_id = new.company_id loop
      perform notify_user(m.user_id, new.project_id, 'finding_assigned', format('A tu empresa le asignaron %s', label),
        new.description || coalesce(' · límite ' || new.due_date, ''), 'findings', new.id);
    end loop;
  end if;
  return new;
end $$;
create trigger findings_notify_assigned after insert or update of responsible_user_id, company_id on findings
  for each row execute function notify_finding_assigned();

-- Corrección decidida: a quien la pidió
create or replace function notify_correction_decided() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.status in ('aprobada', 'rechazada') and old.status = 'pendiente' then
    select ac.code, ac.name into a from progress_entries e join activities ac on ac.id = e.activity_id where e.id = new.entry_id;
    perform notify_user(new.requested_by, new.project_id, 'correction_decided',
      format('Corrección %s', new.status),
      format('%s · %s%s', coalesce(a.code, 'Registro'), coalesce(a.name, ''), case when new.status = 'rechazada' then coalesce(': ' || new.decision_note, '') else '' end),
      'entry_corrections', new.id);
  end if;
  return new;
end $$;
create trigger entry_corrections_notify after update of status on entry_corrections
  for each row execute function notify_correction_decided();

-- Registro rechazado: a quien lo hizo
create or replace function notify_entry_rejected() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    select code, name into a from activities where id = new.activity_id;
    perform notify_user(new.created_by, new.project_id, 'entry_rejected', 'Te rechazaron un registro',
      format('%s · %s del %s%s', a.code, a.name, new.work_date, coalesce(': ' || new.rejection_reason, '')), 'progress_entries', new.id);
  end if;
  return new;
end $$;
create trigger progress_entries_notify_rejected after update of status on progress_entries
  for each row execute function notify_entry_rejected();

-- Cada mañana: hallazgos que vencen hoy o ya vencieron, a su responsable (uno por hallazgo y día)
create or replace function generate_due_notifications(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare f record; n int := 0; v_today date := bogota_today(p_now);
begin
  if auth.uid() is not null then raise exception 'No autorizado' using errcode = '42501'; end if;
  for f in select * from findings where status <> 'closed' and responsible_user_id is not null and due_date is not null and due_date <= v_today loop
    continue when exists (select 1 from user_notifications u where u.ref_id = f.id and u.kind = 'finding_due' and bogota_today(u.created_at) = v_today);
    insert into user_notifications (user_id, project_id, kind, title, body, ref_table, ref_id, created_at)
    values (f.responsible_user_id, f.project_id, 'finding_due',
            case when f.due_date = v_today then 'Vence hoy' else format('Vencido hace %s día(s)', v_today - f.due_date) end,
            left(f.description, 400), 'findings', f.id, p_now);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function generate_due_notifications(timestamptz) from public, anon, authenticated;

alter publication powersync add table user_notifications;
