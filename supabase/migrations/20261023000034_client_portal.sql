-- AvanceObra · portal del cliente: ve el avance, las actas de cobro y las entregas del punch list,
-- y aprueba u observa cada acta. El cliente NO es miembro del proyecto (memberships): no puede
-- escribir en ninguna tabla. Todo lo que ve y decide pasa por las funciones de abajo.

create table project_clients (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) >= 3),
  company text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table project_clients enable row level security;
-- La lista la ven el administrador y el director; el alta la hace la función team-create-user
create policy clients_read on project_clients for select using (user_id = auth.uid() or has_project_role(project_id, '{director,admin}'));
create policy clients_delete on project_clients for delete using (has_project_role(project_id, '{admin}'));
create trigger project_clients_audit after insert or update or delete on project_clients for each row execute function audit_row();

-- Decisión del cliente sobre cada acta al cliente
alter table payment_certificates add column client_status text not null default 'pendiente' check (client_status in ('pendiente', 'aprobada', 'observada'));
alter table payment_certificates add column client_note text;
alter table payment_certificates add column client_decided_by uuid references auth.users(id);
alter table payment_certificates add column client_decided_name text;
alter table payment_certificates add column client_decided_at timestamptz;

-- Un acta emitida no se edita: solo se anula (contratista) o la decide el cliente (por su función)
create or replace function guard_payment_certificate() returns trigger language plpgsql as $$
begin
  if new.client_status is distinct from old.client_status or new.client_note is distinct from old.client_note
     or new.client_decided_by is distinct from old.client_decided_by or new.client_decided_name is distinct from old.client_decided_name
     or new.client_decided_at is distinct from old.client_decided_at then
    if coalesce(current_setting('avanceobra.client_decision', true), '') <> 'on' then
      raise exception 'La aprobación del acta la decide el cliente desde su portal';
    end if;
    if old.status = 'anulada' then raise exception 'El acta % está anulada', old.number; end if;
    if new.status <> old.status or new.lines is distinct from old.lines or new.totals is distinct from old.totals then
      raise exception 'Un acta emitida no se modifica';
    end if;
    return new;
  end if;
  if old.status = 'anulada' then raise exception 'El acta % ya está anulada', old.number; end if;
  if new.status <> 'anulada' or new.lines is distinct from old.lines or new.totals is distinct from old.totals
     or new.number <> old.number or new.period_start <> old.period_start or new.period_end <> old.period_end
     or new.company_id is distinct from old.company_id or new.retention_pct <> old.retention_pct or new.advance_pct <> old.advance_pct then
    raise exception 'Un acta emitida no se modifica: anúlala y emite una nueva';
  end if;
  if length(trim(coalesce(new.void_reason, ''))) < 5 then raise exception 'Explica por qué se anula el acta'; end if;
  new.voided_by := auth.uid();
  new.voided_at := now();
  return new;
end $$;

/** Obras a las que el usuario tiene acceso como cliente. */
create or replace function client_projects() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'client_name', p.client_name, 'contractor_name', p.contractor_name) order by p.name), '[]'::jsonb)
  from project_clients c join projects p on p.id = c.project_id
  where c.user_id = auth.uid();
$$;

/** Todo lo que ve el cliente de una obra: avance (sin costos ni notas), actas al cliente y entregas del punch. */
create or replace function client_project(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from project_clients where project_id = p_project and user_id = auth.uid()) then
    raise exception 'No tienes acceso a esta obra como cliente' using errcode = '42501';
  end if;
  return private.dashboard_data(p_project, true, false) || jsonb_build_object(
    'header', (select to_jsonb(x) from (select name, client_name, contractor_name, contract_code, report_signers, start_date from projects where id = p_project) x),
    'certificates', coalesce((select jsonb_agg(to_jsonb(x) order by x.number desc) from (
      select id, number, period_start, period_end, status, lines, totals, notes, issued_at, void_reason,
             client_status, client_note, client_decided_name, client_decided_at
      from payment_certificates where project_id = p_project and company_id is null) x), '[]'::jsonb),
    'handovers', coalesce((select jsonb_agg(to_jsonb(x) order by x.received_on desc) from (
      select id, scope, subfield, items, received_by_name, received_by_role, received_on, notes, created_at
      from punch_handovers where project_id = p_project) x), '[]'::jsonb)
  );
end $$;

/** El cliente aprueba u observa un acta emitida (una sola vez). Avisa al administrador y al director. */
create or replace function client_decide_certificate(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c payment_certificates;
  who project_clients;
  m record;
begin
  select * into c from payment_certificates where id = p_id;
  if not found or c.company_id is not null then raise exception 'Acta no encontrada' using errcode = 'P0002'; end if;
  select * into who from project_clients where project_id = c.project_id and user_id = auth.uid();
  if not found then raise exception 'No tienes acceso a esta obra como cliente' using errcode = '42501'; end if;
  if c.status <> 'emitida' then raise exception 'El acta % está anulada', c.number; end if;
  if c.client_status <> 'pendiente' then raise exception 'El acta % ya fue %', c.number, c.client_status; end if;
  if p_decision not in ('aprobada', 'observada') then raise exception 'Decisión no válida'; end if;
  if p_decision = 'observada' and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Escribe qué hay que corregir en el acta'; end if;

  perform set_config('avanceobra.client_decision', 'on', true);
  update payment_certificates
  set client_status = p_decision, client_note = nullif(trim(coalesce(p_note, '')), ''), client_decided_by = auth.uid(),
      client_decided_name = who.name || coalesce(' (' || who.company || ')', ''), client_decided_at = now()
  where id = p_id;
  perform set_config('avanceobra.client_decision', '', true);

  for m in select user_id from memberships where project_id = c.project_id and role in ('admin', 'director') loop
    perform notify_user(m.user_id, c.project_id, 'acta_cliente',
      format('Acta N° %s %s por el cliente', c.number, p_decision),
      case when p_decision = 'observada' then format('%s: %s', who.name, trim(p_note)) else format('Aprobada por %s', who.name) end,
      'payment_certificates', c.id);
  end loop;
end $$;

revoke all on function client_projects() from public, anon;
revoke all on function client_project(uuid) from public, anon;
revoke all on function client_decide_certificate(uuid, text, text) from public, anon;
grant execute on function client_projects() to authenticated;
grant execute on function client_project(uuid) to authenticated;
grant execute on function client_decide_certificate(uuid, text, text) to authenticated;

-- Nuevo tipo de aviso: el cliente decidió un acta
alter table user_notifications drop constraint user_notifications_kind_check;
alter table user_notifications add constraint user_notifications_kind_check
  check (kind in ('finding_assigned', 'correction_decided', 'entry_rejected', 'finding_due', 'acta_cliente'));
