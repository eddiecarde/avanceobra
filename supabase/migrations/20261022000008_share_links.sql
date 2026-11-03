-- AvanceObra · enlaces de solo lectura del dashboard (cliente, interventoría)
-- Un enlace da acceso, sin usuario, a una copia de solo lectura del dashboard de UN proyecto:
-- avance, curva S, semáforos, Pareto de horas perdidas, hallazgos (opcional) y plano.
-- No expone costos de la biblioteca, notas de campo, fotos, autores ni datos de contacto.
-- Vence siempre (máximo un año), se puede revocar y deja rastro de cuántas veces se abrió.

create table share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- 256 bits aleatorios (dos UUID v4 sin guiones): no se puede adivinar
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  label text not null check (length(trim(label)) between 1 and 120),
  include_findings boolean not null default true,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  check (expires_at <= created_at + interval '366 days')
);
create index share_links_project_idx on share_links (project_id);

alter table share_links enable row level security;
-- Solo administrador y director del proyecto ven, crean y revocan enlaces. No hay DELETE: queda la traza.
create policy share_links_read on share_links for select using (has_project_role(project_id, '{admin,director}'));
create policy share_links_insert on share_links for insert with check (has_project_role(project_id, '{admin,director}'));
create policy share_links_update on share_links for update using (has_project_role(project_id, '{admin,director}'));

create or replace function share_links_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.created_by_name := coalesce((select full_name from profiles where id = auth.uid()), new.created_by_name);
  new.created_at := now();
  new.view_count := 0;
  new.last_viewed_at := null;
  new.revoked_at := null;
  if new.expires_at <= now() then
    raise exception 'La fecha de vencimiento debe ser futura';
  end if;
  return new;
end $$;
create trigger share_links_insert before insert on share_links for each row execute function share_links_before_insert();

-- Desde la web solo se puede revocar; el token, el proyecto y el alcance no cambian
create or replace function share_links_before_update() returns trigger language plpgsql as $$
begin
  if new.token is distinct from old.token or new.project_id is distinct from old.project_id
     or new.include_findings is distinct from old.include_findings or new.expires_at > old.expires_at
     or new.created_by is distinct from old.created_by or new.label is distinct from old.label then
    raise exception 'Un enlace compartido no se modifica: revóquelo y cree otro';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'El enlace ya está revocado';
  end if;
  return new;
end $$;
create trigger share_links_update before update on share_links for each row execute function share_links_before_update();

/**
 * Dashboard de solo lectura por token. SECURITY DEFINER: lee saltando RLS, pero solo el proyecto
 * del enlace y solo columnas sin datos sensibles. Lo puede llamar el rol anónimo.
 */
create or replace function shared_dashboard(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l share_links;
  pid uuid;
begin
  select * into l from share_links
  where token = p_token and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'Enlace no válido, vencido o revocado' using errcode = 'P0002';
  end if;
  update share_links set view_count = view_count + 1, last_viewed_at = now() where id = l.id;
  pid := l.project_id;

  return jsonb_build_object(
    'link', jsonb_build_object('label', l.label, 'expires_at', l.expires_at, 'include_findings', l.include_findings),
    'project', (select to_jsonb(x) from (
      select id, name, start_date, contract_end_date, workdays, holidays from projects where id = pid) x),
    'activities', coalesce((select jsonb_agg(to_jsonb(x) order by x.code) from (
      select a.id, a.code, a.name, a.unit, a.contract_qty, a.planned_start, a.planned_finish, a.front_id,
             jsonb_build_object('code', f.code, 'name', f.name) as front
      from activities a join fronts f on f.id = a.front_id where a.project_id = pid) x), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(x) order by x.work_date) from (
      select id, activity_id, work_date, quantity, effective_hours, lost_hours, loss_cause, weather, crew_size, status
      from progress_entries where project_id = pid and status in ('submitted', 'approved')) x), '[]'::jsonb),
    'findings', case when l.include_findings then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id, front_id, type, severity, status, description, lat, lon, due_date, created_at, closed_at
      from findings where project_id = pid) x), '[]'::jsonb) else '[]'::jsonb end,
    'elements', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, code, kind, qty, activity_id, geojson from elements where project_id = pid and geojson is not null) x), '[]'::jsonb),
    'element_links', coalesce((select jsonb_agg(jsonb_build_object(
        'element_id', ee.element_id,
        'entry', jsonb_build_object('activity_id', e.activity_id, 'work_date', e.work_date, 'status', e.status)))
      from entry_elements ee join progress_entries e on e.id = ee.entry_id
      where e.project_id = pid and e.status in ('submitted', 'approved')), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'geojson', a.geojson, 'area_m2', a.area_m2,
        'entry', jsonb_build_object('activity_id', e.activity_id, 'work_date', e.work_date, 'status', e.status)))
      from progress_areas a join progress_entries e on e.id = a.entry_id
      where e.project_id = pid and e.status in ('submitted', 'approved')), '[]'::jsonb)
  );
end $$;

revoke all on function shared_dashboard(text) from public;
grant execute on function shared_dashboard(text) to anon, authenticated;

create trigger share_links_audit after insert or update on share_links for each row execute function audit_row();
