-- AvanceObra · correcciones controladas de registros aprobados
-- Un registro aprobado no se edita directamente: se pide una corrección con su motivo, queda la
-- versión anterior y la nueva, y otra persona (residente, director o administrador) la aprueba o
-- la rechaza. Al aprobarla se aplica al registro, que sube de versión, y todo queda auditado.

create table entry_corrections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  entry_id uuid not null references progress_entries(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 10),
  previous jsonb not null,
  proposed jsonb not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada', 'anulada')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  -- Versión del registro que deja esta corrección al aprobarse
  result_version int
);
create unique index entry_corrections_one_open on entry_corrections (entry_id) where status = 'pendiente';
create index entry_corrections_project on entry_corrections (project_id, status);

alter table entry_corrections enable row level security;
create policy corrections_read on entry_corrections for select using (has_project_role(project_id));
-- Se escriben solo por las funciones de abajo (sin políticas de escritura)
create trigger entry_corrections_audit after insert or update on entry_corrections for each row execute function audit_row();

-- Campos que una corrección puede cambiar
create or replace function private.entry_snapshot(e progress_entries) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'quantity', e.quantity, 'work_date', e.work_date, 'effective_hours', e.effective_hours,
    'lost_hours', e.lost_hours, 'loss_cause', e.loss_cause, 'crew_size', e.crew_size, 'notes', e.notes);
$$;

/** Pide corregir un registro aprobado. Devuelve el id de la solicitud. */
create or replace function request_correction(p_entry uuid, p_reason text, p_changes jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e progress_entries;
  prev jsonb;
  prop jsonb;
  k text;
  v_id uuid;
begin
  select * into e from progress_entries where id = p_entry;
  if not found or not has_project_role(e.project_id) then
    raise exception 'Registro no encontrado' using errcode = 'P0002';
  end if;
  if e.status <> 'approved' then
    raise exception 'Solo se piden correcciones de registros aprobados; uno enviado se corrige directamente o lo rechaza el residente';
  end if;
  if e.created_by <> auth.uid() and not has_project_role(e.project_id, '{resident,director,admin}') then
    raise exception 'Solo el autor del registro, el residente, el director o el administrador piden correcciones' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Explica el motivo de la corrección (al menos 10 letras)';
  end if;
  for k in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if k not in ('quantity', 'work_date', 'effective_hours', 'lost_hours', 'loss_cause', 'crew_size', 'notes') then
      raise exception 'El campo % no se puede corregir', k;
    end if;
  end loop;
  prev := private.entry_snapshot(e);
  prop := prev || coalesce(p_changes, '{}'::jsonb);
  if prop = prev then
    raise exception 'La corrección no cambia nada del registro';
  end if;
  -- Valores válidos (los mismos límites que el registro)
  if (prop ->> 'quantity')::numeric < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  if (prop ->> 'work_date')::date > current_date + 1 then raise exception 'La fecha no puede ser futura'; end if;
  if (prop ->> 'effective_hours')::numeric not between 0 and 24 or (prop ->> 'lost_hours')::numeric not between 0 and 24 then
    raise exception 'Las horas deben estar entre 0 y 24';
  end if;
  perform (prop ->> 'loss_cause')::loss_cause;
  if (prop ->> 'crew_size')::int < 0 then raise exception 'El personal no puede ser negativo'; end if;

  insert into entry_corrections (project_id, entry_id, reason, previous, proposed, requested_by)
  values (e.project_id, e.id, trim(p_reason), prev, prop, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Este registro ya tiene una corrección pendiente';
end $$;

/** Aprueba o rechaza una corrección; al aprobarla se aplica al registro. */
create or replace function decide_correction(p_id uuid, p_approve boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  c entry_corrections;
  v int;
begin
  select * into c from entry_corrections where id = p_id for update;
  if not found or not has_project_role(c.project_id) then
    raise exception 'Corrección no encontrada' using errcode = 'P0002';
  end if;
  if c.status <> 'pendiente' then
    raise exception 'La corrección ya fue %', c.status;
  end if;
  if not has_project_role(c.project_id, '{resident,director,admin}') then
    raise exception 'Solo el residente, el director o el administrador deciden correcciones' using errcode = '42501';
  end if;
  -- Cuatro ojos: decide otra persona (el administrador puede decidir las suyas, y queda registrado)
  if c.requested_by = auth.uid() and not has_project_role(c.project_id, '{admin}') then
    raise exception 'Quien pide la corrección no puede aprobarla: debe decidirla otra persona';
  end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'Explica por qué se rechaza';
  end if;

  if p_approve then
    -- Única puerta para cambiar un registro aprobado: el disparador la reconoce por esta marca
    perform set_config('avanceobra.correction', c.entry_id::text, true);
    update progress_entries set
      quantity = (c.proposed ->> 'quantity')::numeric,
      work_date = (c.proposed ->> 'work_date')::date,
      effective_hours = (c.proposed ->> 'effective_hours')::numeric,
      lost_hours = (c.proposed ->> 'lost_hours')::numeric,
      loss_cause = (c.proposed ->> 'loss_cause')::loss_cause,
      crew_size = (c.proposed ->> 'crew_size')::int,
      notes = c.proposed ->> 'notes'
    where id = c.entry_id
    returning version into v;
    perform set_config('avanceobra.correction', '', true);
  end if;

  update entry_corrections set
    status = case when p_approve then 'aprobada' else 'rechazada' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
    result_version = v
  where id = p_id;
  return v;
end $$;

/** Quien pidió la corrección puede anularla mientras esté pendiente. */
create or replace function cancel_correction(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update entry_corrections set status = 'anulada', decided_by = auth.uid(), decided_at = now()
  where id = p_id and status = 'pendiente' and requested_by = auth.uid();
  if not found then raise exception 'Solo quien la pidió anula una corrección pendiente'; end if;
end $$;

revoke all on function request_correction(uuid, text, jsonb), decide_correction(uuid, boolean, text), cancel_correction(uuid) from public, anon;
grant execute on function request_correction(uuid, text, jsonb), decide_correction(uuid, boolean, text), cancel_correction(uuid) to authenticated;

-- El bloqueo de aprobados deja pasar solo la corrección aprobada de ese mismo registro
create or replace function guard_approved_entries() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo se pueden borrar borradores (registro %, estado %)', old.id, old.status;
    end if;
    return old;
  end if;
  if old.status = 'approved' then
    if coalesce(current_setting('avanceobra.correction', true), '') = old.id::text and new.status = 'approved' then
      new.updated_at := now();
      new.version := old.version + 1;
      return new;
    end if;
    raise exception 'El registro % está aprobado y no se puede modificar: pide una corrección', old.id;
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
