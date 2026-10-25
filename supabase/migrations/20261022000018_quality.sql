-- AvanceObra · calidad: plan de inspección y ensayo, listas de chequeo, inspecciones,
-- no conformidades y punch list.
-- Las no conformidades y el punch list son hallazgos con categoría: así lo que se registra desde el
-- teléfono (observaciones) sigue igual, y todo comparte ciclo, fotos, responsable y fecha límite.

-- ---------- Hallazgos: categoría, impeditivo, vínculos y verificación del cierre ----------
alter table findings add column category text not null default 'observacion' check (category in ('observacion', 'no_conformidad', 'punch'));
alter table findings add column impeditive boolean not null default false;
alter table findings add column activity_id uuid references activities(id) on delete set null;
alter table findings add column element_id uuid references elements(id) on delete set null;
alter table findings add column company_id uuid references project_companies(id) on delete set null;
alter table findings add column corrective_action text;
alter table findings add column root_cause text;
alter table findings add column verified_by uuid references auth.users(id);
alter table findings add column verified_at timestamptz;
alter table findings add column verification_note text;
create index findings_category on findings (project_id, category, status);

/** Actividad, elemento y empresa de un hallazgo deben ser del mismo proyecto. */
create or replace function findings_links_check() returns trigger language plpgsql as $$
begin
  if new.activity_id is not null and not exists (select 1 from activities where id = new.activity_id and project_id = new.project_id) then
    raise exception 'La actividad no pertenece a este proyecto';
  end if;
  if new.element_id is not null and not exists (select 1 from elements where id = new.element_id and project_id = new.project_id) then
    raise exception 'El elemento no pertenece a este proyecto';
  end if;
  if new.company_id is not null and not exists (select 1 from project_companies where id = new.company_id and project_id = new.project_id) then
    raise exception 'La empresa no pertenece a este proyecto';
  end if;
  return new;
end $$;
create trigger findings_links_check before insert or update of activity_id, element_id, company_id on findings
  for each row execute function findings_links_check();

-- Cierre verificado: una no conformidad o un punch se cierra con nota de verificación y queda quién
-- verificó; residente, director o administrador cierran.
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

-- ---------- Listas de chequeo ----------
create table checklists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(trim(name)) >= 3),
  activity_id uuid references activities(id) on delete set null,
  -- [{ "id": "1", "text": "Profundidad según plano" }, …]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 80),
  active boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- Plan de inspección y ensayo (PIE) ----------
create table inspection_points (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  name text not null check (length(trim(name)) >= 3),
  criterion text,
  frequency text,
  -- espera: no se sigue sin liberar; testigo: se avisa para presenciar; revisión: documental
  point_type text not null default 'testigo' check (point_type in ('espera', 'testigo', 'revision')),
  responsible text,
  checklist_id uuid references checklists(id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Inspecciones ejecutadas ----------
create table inspections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  checklist_id uuid not null references checklists(id),
  activity_id uuid references activities(id) on delete set null,
  element_id uuid references elements(id) on delete set null,
  location_note text,
  inspected_on date not null default current_date,
  inspector uuid not null references auth.users(id),
  result text not null check (result in ('aprobada', 'rechazada')),
  -- [{ "id": "1", "text": "…", "result": "ok" | "no_ok" | "na", "note": "…" }, …]
  answers jsonb not null,
  notes text,
  created_at timestamptz not null default now()
);
alter table findings add column inspection_id uuid references inspections(id) on delete set null;

alter table checklists enable row level security;
alter table inspection_points enable row level security;
alter table inspections enable row level security;
create policy checklists_read on checklists for select using (has_project_role(project_id));
create policy checklists_write on checklists for all using (has_project_role(project_id, '{resident,director,admin}')) with check (has_project_role(project_id, '{resident,director,admin}'));
create policy points_read on inspection_points for select using (has_project_role(project_id));
create policy points_write on inspection_points for all using (has_project_role(project_id, '{resident,director,admin}')) with check (has_project_role(project_id, '{resident,director,admin}'));
create policy inspections_read on inspections for select using (has_project_role(project_id));
-- Las inspecciones se registran con submit_inspection (que abre las no conformidades)
create trigger checklists_audit after insert or update or delete on checklists for each row execute function audit_row();
create trigger inspection_points_audit after insert or update or delete on inspection_points for each row execute function audit_row();
create trigger inspections_audit after insert on inspections for each row execute function audit_row();

/**
 * Registra una inspección contra una lista de chequeo. Cada punto "no_ok" abre una no conformidad
 * ligada a la inspección, la actividad, el elemento y la empresa responsable de la actividad.
 * p = { project_id, checklist_id, activity_id?, element_id?, location_note?, inspected_on?, notes?,
 *       answers: [{ id, result: ok|no_ok|na, note?, impeditive? }] }
 */
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
  v_id uuid;
  v_nc int := 0;
begin
  if not has_project_role(v_project) then
    raise exception 'No perteneces a este proyecto' using errcode = '42501';
  end if;
  select * into c from checklists where id = (p ->> 'checklist_id')::uuid and project_id = v_project;
  if not found then raise exception 'Lista de chequeo no encontrada'; end if;
  if v_element is not null and not exists (select 1 from elements where id = v_element and project_id = v_project) then
    raise exception 'El elemento no pertenece a este proyecto';
  end if;
  v_activity := coalesce(v_activity, c.activity_id);
  select company_id into v_company from activities where id = v_activity and project_id = v_project;
  -- Cada punto de la lista debe tener respuesta válida
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

  insert into inspections (project_id, checklist_id, activity_id, element_id, location_note, inspected_on, inspector, result, answers, notes)
  values (v_project, c.id, v_activity, v_element, nullif(trim(coalesce(p ->> 'location_note', '')), ''),
          coalesce(nullif(p ->> 'inspected_on', '')::date, current_date), auth.uid(),
          case when exists (select 1 from jsonb_array_elements(v_answers) where value ->> 'result' = 'no_ok') then 'rechazada' else 'aprobada' end,
          v_answers, nullif(trim(coalesce(p ->> 'notes', '')), ''))
  returning id into v_id;

  for ans in select value from jsonb_array_elements(v_answers) where value ->> 'result' = 'no_ok' loop
    insert into findings (id, project_id, front_id, type, severity, status, description, due_date, created_by,
                          category, impeditive, activity_id, element_id, company_id, inspection_id)
    values (gen_random_uuid(), v_project, (select front_id from activities where id = v_activity), 'quality'::finding_type,
            (case when (ans ->> 'impeditive')::boolean then 'high' else 'medium' end)::severity, 'open',
            format('%s: %s — %s', c.name, ans ->> 'text', ans ->> 'note'), current_date + 7, auth.uid(),
            'no_conformidad', (ans ->> 'impeditive')::boolean, v_activity, v_element, v_company, v_id);
    v_nc := v_nc + 1;
  end loop;
  return jsonb_build_object('inspection_id', v_id, 'non_conformities', v_nc);
end $$;
revoke all on function submit_inspection(jsonb) from public, anon;
grant execute on function submit_inspection(jsonb) to authenticated;
