-- AvanceObra · cada subcontratista ve solo lo suyo
-- La gente de una empresa subcontratista (memberships.company_id de tipo 'subcontratista') ve y
-- registra solo las actividades asignadas a su empresa, sus registros, fotos y planos marcados, los
-- hallazgos de su empresa (o que reportó o le asignaron) y su propio parte diario. El contratista
-- (o quien no tiene empresa) sigue viendo toda la obra. Los costos ya estaban restringidos por rol.
--
-- Para la sincronización del teléfono (que no pasa por RLS) cada registro, área, elemento, foto y
-- renglón del plan semanal lleva copiada la empresa de su actividad.

-- ---------- Arreglo de seguridad: la vista de avance respetaba solo los permisos de su dueño ----------
alter view activity_progress set (security_invoker = true);
revoke all on activity_progress from anon;

-- ---------- Membresías: ¿de qué subcontratista es? ----------
alter table memberships add column sub_company_id uuid;

create or replace function memberships_set_sub_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sub_company_id := (select c.id from project_companies c where c.id = new.company_id and c.kind = 'subcontratista');
  return new;
end $$;
create trigger memberships_sub_company before insert or update of company_id on memberships
  for each row execute function memberships_set_sub_company();

-- Si una empresa pasa de contratista a subcontratista (o al revés), se recalculan sus miembros
create or replace function project_companies_kind_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind is distinct from old.kind then
    update memberships set sub_company_id = case when new.kind = 'subcontratista' then new.id end where company_id = new.id;
  end if;
  return new;
end $$;
create trigger project_companies_kind after update of kind on project_companies
  for each row execute function project_companies_kind_changed();

update memberships m set sub_company_id = c.id from project_companies c where c.id = m.company_id and c.kind = 'subcontratista';

-- ---------- Empresa copiada en lo que cuelga de cada actividad ----------
alter table progress_entries add column company_id uuid;
alter table progress_areas add column company_id uuid;
alter table entry_elements add column company_id uuid;
alter table photos add column company_id uuid;
alter table weekly_plan_items add column company_id uuid;
create index progress_entries_company on progress_entries (company_id);
create index photos_company on photos (company_id);

create or replace function set_company_from_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.company_id := (select company_id from activities where id = new.activity_id);
  return new;
end $$;
create trigger progress_entries_company before insert or update of activity_id on progress_entries
  for each row execute function set_company_from_activity();
create trigger weekly_plan_items_company before insert or update of activity_id on weekly_plan_items
  for each row execute function set_company_from_activity();

create or replace function set_company_from_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.company_id := (select company_id from progress_entries where id = new.entry_id);
  return new;
end $$;
create trigger progress_areas_company before insert on progress_areas for each row execute function set_company_from_entry();
create trigger entry_elements_company before insert on entry_elements for each row execute function set_company_from_entry();

create or replace function set_photo_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.company_id := coalesce((select company_id from progress_entries where id = new.entry_id), (select company_id from findings where id = new.finding_id));
  return new;
end $$;
create trigger photos_company before insert on photos for each row execute function set_photo_company();

-- Cambiar la empresa de una actividad (o de un hallazgo) se propaga a todo lo que cuelga de ella.
-- Los registros aprobados no se pueden modificar: la propagación avisa a los guardianes con una
-- marca de la transacción y solo cambia la empresa (ni cantidades ni versión).
create or replace function propagate_activity_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is distinct from old.company_id then
    perform set_config('avanceobra.company_sync', 'on', true);
    update progress_entries set company_id = new.company_id where activity_id = new.id;
    update progress_areas a set company_id = new.company_id from progress_entries e where e.id = a.entry_id and e.activity_id = new.id;
    update entry_elements x set company_id = new.company_id from progress_entries e where e.id = x.entry_id and e.activity_id = new.id;
    update photos p set company_id = new.company_id from progress_entries e where e.id = p.entry_id and e.activity_id = new.id;
    update weekly_plan_items set company_id = new.company_id where activity_id = new.id;
    perform set_config('avanceobra.company_sync', '', true);
  end if;
  return new;
end $$;
create trigger activities_company_propagate after update of company_id on activities
  for each row execute function propagate_activity_company();

create or replace function propagate_finding_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is distinct from old.company_id then
    update photos set company_id = new.company_id where finding_id = new.id and entry_id is null;
  end if;
  return new;
end $$;
create trigger findings_company_propagate after update of company_id on findings
  for each row execute function propagate_finding_company();

create or replace function guard_approved_entries() returns trigger language plpgsql as $$
begin
  -- Propagación interna de la empresa de la actividad: no es una edición del registro
  if tg_op = 'UPDATE' and coalesce(current_setting('avanceobra.company_sync', true), '') = 'on' then
    return new;
  end if;
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

create or replace function guard_weekly_plan_items() returns trigger language plpgsql as $$
declare st text;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('avanceobra.company_sync', true), '') = 'on' then
    return new;
  end if;
  select status into st from weekly_plans where id = coalesce(new.plan_id, old.plan_id);
  if st = 'cerrado' then raise exception 'La semana ya está cerrada'; end if;
  if st = 'comprometido' and (tg_op <> 'UPDATE' or new.activity_id <> old.activity_id or new.planned_qty <> old.planned_qty) then
    raise exception 'El plan ya está comprometido: solo se registra su cumplimiento al cerrar la semana';
  end if;
  return coalesce(new, old);
end $$;

-- Llenar lo que ya existe (con la marca para que los guardianes lo permitan)
do $$
begin
  perform set_config('avanceobra.company_sync', 'on', true);
  update progress_entries e set company_id = a.company_id from activities a where a.id = e.activity_id and a.company_id is not null;
  update progress_areas x set company_id = e.company_id from progress_entries e where e.id = x.entry_id and e.company_id is not null;
  update entry_elements x set company_id = e.company_id from progress_entries e where e.id = x.entry_id and e.company_id is not null;
  update photos p set company_id = e.company_id from progress_entries e where e.id = p.entry_id and e.company_id is not null;
  update photos p set company_id = f.company_id from findings f where f.id = p.finding_id and p.entry_id is null and f.company_id is not null;
  update weekly_plan_items w set company_id = a.company_id from activities a where a.id = w.activity_id and a.company_id is not null;
  perform set_config('avanceobra.company_sync', '', true);
end $$;

-- ---------- Permisos ----------
/** ¿El usuario ve lo de esta empresa en esta obra? El contratista ve todo; el subcontratista, lo suyo. */
create or replace function sees_company(p_project uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.project_id = p_project and not m.org_suspended
      and (m.sub_company_id is null or m.sub_company_id = p_company)
  );
$$;

/** ¿El usuario está en esta obra como subcontratista? */
create or replace function is_subcontractor(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.project_id = p_project and m.sub_company_id is not null);
$$;
revoke all on function sees_company(uuid, uuid) from public, anon;
revoke all on function is_subcontractor(uuid) from public, anon;
grant execute on function sees_company(uuid, uuid) to authenticated;
grant execute on function is_subcontractor(uuid) to authenticated;

alter policy activities_read on activities using (sees_company(project_id, company_id));
alter policy entries_read on progress_entries using (sees_company(project_id, company_id));
alter policy weekly_items_read on weekly_plan_items using (sees_company(project_id, company_id));
alter policy findings_read on findings using (
  has_project_role(project_id) and (sees_company(project_id, company_id) or created_by = auth.uid() or responsible_user_id = auth.uid()));
alter policy daily_logs_read on daily_logs using (has_project_role(project_id) and (not is_subcontractor(project_id) or created_by = auth.uid()));
alter policy alerts_read on alerts using (has_project_role(project_id) and not is_subcontractor(project_id));

-- Registrar, editar y aprobar: también solo sobre lo suyo (se agrega a la regla que ya existía)
do $$
declare
  q text;
begin
  select pg_get_expr(polwithcheck, polrelid) into q from pg_policy where polrelid = 'progress_entries'::regclass and polname = 'entries_insert';
  execute format('alter policy entries_insert on progress_entries with check ((%s) and sees_company(project_id, company_id))', q);
  select pg_get_expr(polqual, polrelid) into q from pg_policy where polrelid = 'progress_entries'::regclass and polname = 'entries_update';
  execute format('alter policy entries_update on progress_entries using ((%s) and sees_company(project_id, company_id))', q);
  select pg_get_expr(polqual, polrelid) into q from pg_policy where polrelid = 'findings'::regclass and polname = 'findings_update';
  execute format('alter policy findings_update on findings using ((%s) and (sees_company(project_id, company_id) or created_by = auth.uid() or responsible_user_id = auth.uid()))', q);
end $$;
