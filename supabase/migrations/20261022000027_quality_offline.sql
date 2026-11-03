-- Calidad en campo sin señal: foto del "después" obligatoria al cerrar una NC o un punch,
-- inspecciones que se pueden reenviar sin duplicarse y acta de entrega del punch list.

-- Para qué es cada foto: avance, hallazgo (el "antes") o cierre (el "después")
alter table photos add column purpose text check (purpose is null or purpose in ('avance', 'hallazgo', 'cierre'));

create or replace function guard_finding_transition() returns trigger language plpgsql as $$
declare allowed boolean;
begin
  if new.status is distinct from old.status then
    allowed := (old.status, new.status) in (
      ('open','in_correction'), ('in_correction','to_review'),
      ('to_review','closed'), ('to_review','in_correction'));
    if not allowed then
      raise exception 'Transición no permitida: % -> %', old.status, new.status;
    end if;
    if new.status = 'closed' then
      if not has_project_role(new.project_id, '{resident,director,admin}') then
        raise exception 'Solo el residente, el director o el administrador cierran un hallazgo';
      end if;
      if new.category in ('no_conformidad', 'punch') and length(trim(coalesce(new.verification_note, ''))) < 5 then
        raise exception 'Para cerrar una no conformidad o un punch, describe la verificación (qué se revisó y cómo quedó)';
      end if;
      -- El teléfono sube la fila de la foto antes del cambio de estado (el archivo puede llegar después)
      if new.category in ('no_conformidad', 'punch') and not exists (select 1 from photos where finding_id = new.id and purpose = 'cierre') then
        raise exception 'Para cerrar una no conformidad o un punch, toma la foto de cómo quedó (foto de cierre)';
      end if;
      new.closed_at := now();
      new.verified_by := auth.uid();
      new.verified_at := now();
    end if;
    insert into finding_events (finding_id, from_status, to_status, comment, by_user)
    values (new.id, old.status, new.status, case when new.status = 'closed' then new.verification_note end, auth.uid());
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

-- Inspección enviada desde el teléfono sin señal: trae su propio id; si llega dos veces, la
-- segunda devuelve lo ya registrado
create or replace function submit_inspection(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := (p ->> 'project_id')::uuid;
  c checklists;
  v_activity uuid := nullif(p ->> 'activity_id', '')::uuid;
  v_element uuid := nullif(p ->> 'element_id', '')::uuid;
  v_company uuid;
  v_answers jsonb := '[]'::jsonb;
  it jsonb;
  ans jsonb;
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_nc int := 0;
  v_day date := coalesce(nullif(p ->> 'inspected_on', '')::date, current_date);
begin
  if not has_project_role(v_project) then
    raise exception 'No perteneces a este proyecto' using errcode = '42501';
  end if;
  if exists (select 1 from inspections where id = v_id) then
    return jsonb_build_object('inspection_id', v_id, 'non_conformities', (select count(*) from findings where inspection_id = v_id), 'repeated', true);
  end if;
  select * into c from checklists where id = (p ->> 'checklist_id')::uuid and project_id = v_project;
  if not found then raise exception 'Lista de chequeo no encontrada'; end if;
  if v_element is not null and not exists (select 1 from elements where id = v_element and project_id = v_project) then
    raise exception 'El elemento no pertenece a este proyecto';
  end if;
  v_activity := coalesce(v_activity, c.activity_id);
  select company_id into v_company from activities where id = v_activity and project_id = v_project;
  for it in select * from jsonb_array_elements(c.items) loop
    select value into ans from jsonb_array_elements(coalesce(p -> 'answers', '[]'::jsonb)) where value ->> 'id' = it ->> 'id' limit 1;
    if ans is null or coalesce(ans ->> 'result', '') not in ('ok', 'no_ok', 'na') then
      raise exception 'Falta responder: %', it ->> 'text';
    end if;
    if ans ->> 'result' = 'no_ok' and length(trim(coalesce(ans ->> 'note', ''))) < 3 then
      raise exception 'Describe qué no cumple en: %', it ->> 'text';
    end if;
    v_answers := v_answers || jsonb_build_object('id', it ->> 'id', 'text', it ->> 'text', 'result', ans ->> 'result',
      'note', nullif(trim(coalesce(ans ->> 'note', '')), ''), 'impeditive', coalesce((ans ->> 'impeditive')::boolean, false));
  end loop;

  insert into inspections (id, project_id, checklist_id, activity_id, element_id, location_note, inspected_on, inspector, result, answers, notes)
  values (v_id, v_project, c.id, v_activity, v_element, nullif(trim(coalesce(p ->> 'location_note', '')), ''), v_day, auth.uid(),
          case when exists (select 1 from jsonb_array_elements(v_answers) where value ->> 'result' = 'no_ok') then 'rechazada' else 'aprobada' end,
          v_answers, nullif(trim(coalesce(p ->> 'notes', '')), ''));

  for ans in select value from jsonb_array_elements(v_answers) where value ->> 'result' = 'no_ok' loop
    insert into findings (id, project_id, front_id, type, severity, status, description, due_date, created_by,
                          category, impeditive, activity_id, element_id, company_id, inspection_id)
    values (gen_random_uuid(), v_project, (select front_id from activities where id = v_activity), 'quality'::finding_type,
            (case when (ans ->> 'impeditive')::boolean then 'high' else 'medium' end)::severity, 'open',
            format('%s: %s — %s', c.name, ans ->> 'text', ans ->> 'note'), v_day + 7, auth.uid(),
            'no_conformidad', (ans ->> 'impeditive')::boolean, v_activity, v_element, v_company, v_id);
    v_nc := v_nc + 1;
  end loop;
  return jsonb_build_object('inspection_id', v_id, 'non_conformities', v_nc);
end $$;
revoke all on function submit_inspection(jsonb) from public, anon;
grant execute on function submit_inspection(jsonb) to authenticated;

-- Acta de entrega del punch list: lo cerrado de una zona, quién lo recibe y su firma
create table punch_handovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- Zona entregada (frente o subcampo) y su nombre legible
  scope text not null check (length(trim(scope)) between 1 and 120),
  front_id uuid references fronts(id),
  subfield text,
  -- Foto de los punch entregados: descripción, cierre, verificación y foto de cierre
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  received_by_name text not null check (length(trim(received_by_name)) >= 3),
  received_by_role text,
  received_on date not null,
  signature_path text,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table punch_handovers enable row level security;
create policy handovers_read on punch_handovers for select using (has_project_role(project_id));
create policy handovers_insert on punch_handovers for insert with check (has_project_role(project_id, '{resident,director,admin}') and created_by = auth.uid());
create trigger punch_handovers_audit after insert or update or delete on punch_handovers for each row execute function audit_row();

-- PowerSync replica también las empresas y las listas de chequeo (calidad sin señal en el teléfono)
alter publication powersync add table project_companies, checklists;
