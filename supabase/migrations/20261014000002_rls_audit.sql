-- AvanceObra · seguridad (RLS), inmutabilidad de aprobados y auditoría

-- ---------- Helpers ----------
create or replace function has_project_role(p_project uuid, p_roles app_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.project_id = p_project
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = p_org);
$$;

-- ---------- RLS ----------
alter table organizations          enable row level security;
alter table profiles               enable row level security;
alter table projects               enable row level security;
alter table memberships            enable row level security;
alter table fronts                 enable row level security;
alter table activities             enable row level security;
alter table elements               enable row level security;
alter table site_plans             enable row level security;
alter table form_templates         enable row level security;
alter table form_template_versions enable row level security;
alter table progress_entries       enable row level security;
alter table entry_resources        enable row level security;
alter table entry_elements         enable row level security;
alter table progress_areas         enable row level security;
alter table photos                 enable row level security;
alter table findings               enable row level security;
alter table finding_events         enable row level security;
alter table resource_catalog       enable row level security;
alter table cost_settings          enable row level security;
alter table contracts              enable row level security;
alter table simulations            enable row level security;
alter table alerts                 enable row level security;
alter table notification_channels  enable row level security;
alter table audit_log              enable row level security;

create policy org_read on organizations for select using (is_org_member(id));
create policy profile_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy membership_read on memberships for select using (user_id = auth.uid() or has_project_role(project_id, '{admin}'));
create policy membership_admin on memberships for all using (has_project_role(project_id, '{admin}')) with check (has_project_role(project_id, '{admin}'));

create policy project_read  on projects for select using (has_project_role(id));
create policy project_admin on projects for update using (has_project_role(id, '{admin}'));

-- Estructura: lectura para miembros, edición solo admin
do $$
declare t text;
begin
  foreach t in array array['fronts','activities','elements','site_plans','cost_settings','contracts'] loop
    execute format('create policy %1$s_read on %1$s for select using (has_project_role(project_id))', t);
    execute format('create policy %1$s_admin on %1$s for all using (has_project_role(project_id, ''{admin}'')) with check (has_project_role(project_id, ''{admin}''))', t);
  end loop;
end $$;

create policy templates_read on form_templates for select using (is_org_member(org_id));
create policy templates_admin on form_templates for all using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy tv_read on form_template_versions for select
  using (exists (select 1 from form_templates t where t.id = template_id and is_org_member(t.org_id)));
create policy tv_insert on form_template_versions for insert
  with check (exists (select 1 from form_templates t where t.id = template_id and is_org_member(t.org_id)));

create policy catalog_read on resource_catalog for select using (is_org_member(org_id));
create policy catalog_write on resource_catalog for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Avance: cualquier miembro lee; campo/residente crean lo propio; residente aprueba
create policy entries_read on progress_entries for select using (has_project_role(project_id));
create policy entries_insert on progress_entries for insert
  with check (has_project_role(project_id, '{field,resident,admin}') and created_by = auth.uid());
create policy entries_update on progress_entries for update
  using ((created_by = auth.uid() and status in ('draft','submitted','rejected'))
         or has_project_role(project_id, '{resident,admin}'));
-- Solo se borran borradores propios; lo enviado o aprobado queda (el trigger lo refuerza)
create policy entries_delete_draft on progress_entries for delete using (created_by = auth.uid() and status = 'draft');

create policy entry_children_read on entry_resources for select
  using (exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id)));
create policy entry_children_write on entry_resources for insert
  with check (exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid()));
create policy entry_elements_read on entry_elements for select
  using (exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id)));
create policy entry_elements_write on entry_elements for insert
  with check (exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid()));
create policy areas_read on progress_areas for select
  using (exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id)));
create policy areas_write on progress_areas for insert
  with check (exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid()));

create policy photos_read on photos for select using (
  exists (select 1 from progress_entries e where e.id = entry_id and has_project_role(e.project_id))
  or exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));
create policy photos_write on photos for insert with check (
  exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid())
  or exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));
create policy photos_mark_uploaded on photos for update using (
  exists (select 1 from progress_entries e where e.id = entry_id and e.created_by = auth.uid())
  or exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));

create policy findings_read on findings for select using (has_project_role(project_id));
create policy findings_insert on findings for insert with check (has_project_role(project_id) and created_by = auth.uid());
create policy findings_update on findings for update using (has_project_role(project_id));
create policy finding_events_read on finding_events for select
  using (exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));
create policy finding_events_insert on finding_events for insert
  with check (exists (select 1 from findings f where f.id = finding_id and has_project_role(f.project_id)));

create policy sims_read on simulations for select using (has_project_role(project_id, '{resident,director,admin}'));
create policy sims_insert on simulations for insert with check (has_project_role(project_id, '{resident,director,admin}') and created_by = auth.uid());
-- Las simulaciones no se editan ni se borran: sustentan decisiones.

create policy alerts_read on alerts for select using (has_project_role(project_id));
create policy alerts_insert on alerts for insert with check (has_project_role(project_id));

create policy channels_self on notification_channels for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_read on audit_log for select using (false); -- solo service_role / funciones

-- ---------- Inmutabilidad de registros aprobados ----------
create or replace function guard_approved_entries() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo se pueden borrar borradores (registro %, estado %)', old.id, old.status;
    end if;
    return old;
  end if;
  if old.status = 'approved' then
    raise exception 'El registro % está aprobado y no se puede modificar; cree un registro de ajuste', old.id;
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

create trigger progress_entries_guard
  before update or delete on progress_entries
  for each row execute function guard_approved_entries();

-- ---------- Ciclo de vida de hallazgos ----------
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
      if not has_project_role(new.project_id, '{resident,admin}') then
        raise exception 'Solo el residente puede cerrar un hallazgo';
      end if;
      new.closed_at := now();
    end if;
    insert into finding_events (finding_id, from_status, to_status, by_user)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create trigger findings_guard before update on findings
  for each row execute function guard_finding_transition();

-- Hallazgo crítico -> alerta inmediata (el despacho lo hace la Edge Function alerts-dispatch)
create or replace function alert_on_critical_finding() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.severity = 'critical' then
    insert into alerts (id, project_id, kind, severity, title, body, ref_table, ref_id)
    values (gen_random_uuid(), new.project_id, 'critical_finding', 'critical',
            'Hallazgo crítico', left(new.description, 280), 'findings', new.id);
  end if;
  return new;
end $$;

create trigger findings_critical_alert after insert on findings
  for each row execute function alert_on_critical_finding();

-- ---------- Auditoría ----------
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  -- No todas las tablas tienen columna id (contracts usa project_id como clave)
  insert into audit_log (table_name, row_id, action, old_data, new_data, by_user)
  values (tg_table_name, coalesce(v_row->>'id', v_row->>'project_id')::uuid, tg_op, v_old, v_new, auth.uid());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['progress_entries','findings','contracts','resource_catalog','activities','simulations'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on %1$s for each row execute function audit_row()', t);
  end loop;
end $$;
