-- AvanceObra · crear una obra nueva desde la web. La crea el administrador de cualquier obra de la
-- organización; queda como administrador de la nueva. Después carga la programación (Excel, MS Project
-- o Primavera) en Programación.
create or replace function create_project(
  p_code text,
  p_name text,
  p_start date,
  p_end date,
  p_client text default null,
  p_location text default null,
  p_zone_label text default null,
  p_org uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_code text := upper(regexp_replace(trim(coalesce(p_code, '')), '\s+', '-', 'g'));
  v_id uuid;
begin
  -- Organización: la indicada (si es administrador allí) o la única donde administra alguna obra
  select m.org_id into v_org from memberships m
  where m.user_id = auth.uid() and m.role = 'admin' and (p_org is null or m.org_id = p_org)
  group by m.org_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'Solo el administrador de una obra de la empresa puede crear obras nuevas' using errcode = '42501'; end if;
  if p_org is null and (select count(distinct org_id) from memberships where user_id = auth.uid() and role = 'admin') > 1 then
    raise exception 'Administras obras de varias empresas: elige en cuál crear la obra';
  end if;

  if length(v_code) < 2 or length(v_code) > 20 then raise exception 'El código de la obra debe tener entre 2 y 20 caracteres'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Escribe el nombre de la obra'; end if;
  if p_start is null or p_end is null then raise exception 'Faltan las fechas de inicio y de terminación'; end if;
  if p_end <= p_start then raise exception 'La terminación debe ser posterior al inicio'; end if;
  if exists (select 1 from projects where org_id = v_org and code = v_code) then raise exception 'Ya existe una obra con el código %', v_code; end if;

  insert into projects (org_id, code, name, start_date, contract_end_date, client_name, location_name, zone_label)
  values (v_org, v_code, trim(p_name), p_start, p_end, nullif(trim(coalesce(p_client, '')), ''), nullif(trim(coalesce(p_location, '')), ''),
          nullif(trim(coalesce(p_zone_label, '')), ''))
  returning id into v_id;

  insert into memberships (user_id, project_id, org_id, role, member_name)
  values (auth.uid(), v_id, v_org, 'admin', (select full_name from profiles where id = auth.uid()));
  return v_id;
end $$;

revoke all on function create_project(text, text, date, date, text, text, text, uuid) from public, anon;
grant execute on function create_project(text, text, date, date, text, text, text, uuid) to authenticated;
