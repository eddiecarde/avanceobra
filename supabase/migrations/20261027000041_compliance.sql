-- AvanceObra · seguridad social y SST al día
-- Trabajadores de cada empresa en la obra y documentos con vencimiento: de la empresa (planilla PILA
-- del mes, ARL, póliza…) y de cada trabajador (ARL, EPS, examen médico, inducción, alturas…).
-- El contratista ve todo; cada subcontratista carga y ve solo lo suyo. Alertas diarias antes de que
-- algo venza y, si la obra lo activa, bloqueo del registro de avance de una empresa con la PILA vencida.

create table workers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- null = personal directo del contratista
  company_id uuid references project_companies(id) on delete set null,
  full_name text not null check (length(trim(full_name)) >= 3),
  document_id text,
  role text,
  works_at_height boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, document_id)
);
create index workers_project on workers (project_id, company_id);

create table compliance_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid references project_companies(id) on delete set null,
  -- null = documento de la empresa
  worker_id uuid references workers(id) on delete cascade,
  doc_type text not null check (doc_type in (
    'pila', 'arl_empresa', 'poliza', 'sg_sst', 'camara_comercio',
    'arl', 'eps', 'pension', 'examen_medico', 'induccion', 'alturas', 'espacios_confinados', 'licencia', 'certificado_operador')),
  issued_on date,
  expires_on date,
  file_path text,
  notes text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on),
  -- Los de la empresa no llevan trabajador; los del trabajador, sí
  check ((worker_id is null) = (doc_type in ('pila', 'arl_empresa', 'poliza', 'sg_sst', 'camara_comercio')))
);
create index compliance_documents_project on compliance_documents (project_id, company_id, worker_id);

-- El documento de un trabajador es de la empresa del trabajador
create or replace function compliance_documents_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.worker_id is not null then
    select company_id into new.company_id from workers where id = new.worker_id and project_id = new.project_id;
    if not found then raise exception 'El trabajador no es de esta obra'; end if;
  end if;
  return new;
end $$;
create trigger compliance_documents_company before insert or update of worker_id on compliance_documents
  for each row execute function compliance_documents_company();

-- Una empresa ajena a la obra no
create or replace function workers_company_check() returns trigger language plpgsql as $$
begin
  if new.company_id is not null and not exists (select 1 from project_companies c where c.id = new.company_id and c.project_id = new.project_id) then
    raise exception 'La empresa no pertenece a esta obra';
  end if;
  return new;
end $$;
create trigger workers_company_check before insert or update of company_id on workers for each row execute function workers_company_check();

/** ¿Puede cargar lo de esta empresa? El residente/director/admin del contratista, o la gente del propio subcontratista. */
create or replace function can_manage_compliance(p_project uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select sees_company(p_project, p_company)
     and (is_subcontractor(p_project) or has_project_role(p_project, '{resident,director,admin}'));
$$;
revoke all on function can_manage_compliance(uuid, uuid) from public, anon;
grant execute on function can_manage_compliance(uuid, uuid) to authenticated;

alter table workers enable row level security;
alter table compliance_documents enable row level security;
create policy workers_read on workers for select using (sees_company(project_id, company_id));
create policy workers_write on workers for all using (can_manage_compliance(project_id, company_id)) with check (can_manage_compliance(project_id, company_id));
create policy compliance_read on compliance_documents for select using (sees_company(project_id, company_id));
create policy compliance_write on compliance_documents for all using (can_manage_compliance(project_id, company_id)) with check (can_manage_compliance(project_id, company_id));
create trigger workers_audit after insert or update or delete on workers for each row execute function audit_row();
create trigger compliance_documents_audit after insert or update or delete on compliance_documents for each row execute function audit_row();

-- ---------- Soportes (PDF o foto): carpeta obra/empresa/archivo ----------
insert into storage.buckets (id, name, public) values ('compliance', 'compliance', false) on conflict (id) do nothing;

/** Ruta "obra/empresa-o-contratista/archivo": la ve quien ve esa empresa en esa obra. */
create or replace function can_access_compliance_file(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
  v_project uuid;
  v_company uuid;
begin
  begin
    v_project := parts[1]::uuid;
    v_company := case when parts[2] = 'contratista' then null else parts[2]::uuid end;
  exception when others then return false;
  end;
  return case when p_write then can_manage_compliance(v_project, v_company) else sees_company(v_project, v_company) end;
end $$;
revoke all on function can_access_compliance_file(text, boolean) from public, anon;
grant execute on function can_access_compliance_file(text, boolean) to authenticated;

create policy compliance_bucket_read on storage.objects for select using (bucket_id = 'compliance' and can_access_compliance_file(name, false));
create policy compliance_bucket_write on storage.objects for insert with check (bucket_id = 'compliance' and can_access_compliance_file(name, true));

-- ---------- Bloqueo del avance de una empresa con la planilla vencida (si la obra lo activa) ----------
alter table projects add column compliance_block boolean not null default false;

/** La planilla (PILA) vigente de la empresa: la que vence más tarde, o ninguna. */
create or replace function company_pila_ok(p_project uuid, p_company uuid, p_today date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from compliance_documents d
    where d.project_id = p_project and d.company_id is not distinct from p_company and d.worker_id is null
      and d.doc_type = 'pila' and (d.expires_on is null or d.expires_on >= p_today)
  );
$$;

create or replace function block_entries_without_pila() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.company_id is null then return new; end if;
  if not exists (select 1 from projects where id = new.project_id and compliance_block) then return new; end if;
  if company_pila_ok(new.project_id, new.company_id, (now() at time zone 'America/Bogota')::date) then return new; end if;
  select name into v_name from project_companies where id = new.company_id;
  raise exception 'La seguridad social (PILA) de % no está vigente: no se puede registrar avance de sus actividades hasta que la carguen', coalesce(v_name, 'la empresa');
end $$;
-- Después de progress_entries_company (que llena company_id): los BEFORE van en orden alfabético
create trigger progress_entries_zz_compliance before insert on progress_entries for each row execute function block_entries_without_pila();

-- ---------- Alertas diarias: documentos obligatorios que vencen en 15 días o ya vencieron ----------
create or replace function generate_compliance_alerts(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_now at time zone 'America/Bogota')::date;
  r record;
  n int := 0;
begin
  for r in
    -- El documento más reciente de cada tipo obligatorio, por empresa o por trabajador activo
    select distinct on (d.project_id, d.company_id, d.worker_id, d.doc_type)
           d.id, d.project_id, d.doc_type, d.expires_on, c.name as company, w.full_name as worker
    from compliance_documents d
    join projects p on p.id = d.project_id and not p.suspended
    left join project_companies c on c.id = d.company_id
    left join workers w on w.id = d.worker_id
    where d.doc_type in ('pila', 'arl', 'eps', 'examen_medico', 'induccion', 'alturas')
      and (d.worker_id is null or w.active)
    order by d.project_id, d.company_id, d.worker_id, d.doc_type, d.expires_on desc nulls first
  loop
    continue when r.expires_on is null or r.expires_on > v_today + 15;
    if insert_alert_once(
      r.project_id,
      case when r.expires_on < v_today then 'compliance_expired' else 'compliance_expiring' end,
      (case when r.expires_on < v_today then 'high' else 'medium' end)::severity,
      case when r.expires_on < v_today then 'Documento vencido' else 'Documento por vencer' end,
      format('%s%s: %s %s el %s.',
        coalesce(r.worker || ' · ', ''), coalesce(r.company, 'Contratista'),
        replace(r.doc_type, '_', ' '),
        case when r.expires_on < v_today then 'venció' else 'vence' end,
        to_char(r.expires_on, 'DD/MM/YYYY')),
      'compliance_documents', r.id, p_now) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function generate_compliance_alerts(timestamptz) from public, anon, authenticated;
