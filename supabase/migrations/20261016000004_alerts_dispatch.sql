-- AvanceObra · etapa 3: generación programada y despacho de alertas
--
-- Flujo:
--  1. Las alertas nacen en el teléfono al guardar (rendimiento bajo, proyección tardía), en
--     triggers (hallazgo crítico) o en los jobs programados de este archivo (vencidos, por
--     vencer, frente sin reporte).
--  2. La Edge Function alerts-dispatch toma las alertas sin despachar, calcula destinatarios
--     según tipo y rol, y envía por los canales configurados (push, Telegram, correo, WhatsApp).
--  3. Cada envío queda en alert_deliveries (auditoría y para no repetir).

-- ---------- Destinos de notificación ----------
alter table profiles add column telegram_link_code text unique;
alter table alerts add column dispatch_attempts int not null default 0;

create table device_tokens (
  token text primary key,                -- Expo push token
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android','ios')),
  updated_at timestamptz not null default now()
);
alter table device_tokens enable row level security;
create policy device_tokens_self on device_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table alert_deliveries (
  id bigint generated always as identity primary key,
  alert_id uuid not null references alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('push','email','telegram','whatsapp','sms')),
  status text not null check (status in ('sent','failed','skipped')),
  error text,
  created_at timestamptz not null default now(),
  unique (alert_id, user_id, channel)
);
alter table alert_deliveries enable row level security;
create policy alert_deliveries_self on alert_deliveries for select using (user_id = auth.uid());

-- Código de un solo uso para vincular Telegram desde la app (t.me/<bot>?start=<código>)
create or replace function create_telegram_link_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
begin
  if auth.uid() is null then raise exception 'Requiere sesión'; end if;
  insert into profiles (id, full_name) values (auth.uid(), '') on conflict (id) do nothing;
  update profiles set telegram_link_code = v_code where id = auth.uid();
  return v_code;
end $$;

-- Contactos de los miembros de un proyecto (solo para la función de despacho, con service_role)
create or replace function alert_member_contacts(p_project uuid)
returns table (user_id uuid, role app_role, member_name text, email text, phone text,
               telegram_chat_id text, whatsapp_opt_in boolean, push_tokens text[])
language plpgsql stable security definer set search_path = public as $$
begin
  -- Correos y teléfonos de todo el equipo: solo para el despacho (service_role o job, sin usuario).
  -- No se confía solo en REVOKE porque los privilegios por defecto pueden volver a otorgarlo.
  if auth.uid() is not null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
  select m.user_id, m.role, coalesce(m.member_name, p.full_name, u.email::text), u.email::text, p.phone,
         p.telegram_chat_id, coalesce(p.whatsapp_opt_in, false),
         coalesce((select array_agg(t.token) from device_tokens t where t.user_id = m.user_id), '{}')
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.project_id = p_project;
end $$;
revoke all on function alert_member_contacts(uuid) from public, anon, authenticated;

-- ---------- Generación programada ----------
create or replace function bogota_today(p_now timestamptz default now()) returns date
language sql stable as $$ select (p_now at time zone 'America/Bogota')::date $$;

/** Inserta la alerta solo si no hay otra igual (tipo + referencia) el mismo día. */
create or replace function insert_alert_once(p_project uuid, p_kind text, p_severity severity, p_title text,
                                             p_body text, p_ref_table text, p_ref_id uuid, p_now timestamptz)
returns boolean language plpgsql as $$
begin
  if exists (select 1 from alerts a where a.kind = p_kind and a.ref_id = p_ref_id
             and bogota_today(a.created_at) = bogota_today(p_now)) then
    return false;
  end if;
  insert into alerts (id, project_id, kind, severity, title, body, ref_table, ref_id, created_at)
  values (gen_random_uuid(), p_project, p_kind, p_severity, p_title, p_body, p_ref_table, p_ref_id, p_now);
  return true;
end $$;

/**
 * Pendientes vencidos y por vencer (2 días). Se programa a las 6:00 a. m. de Colombia.
 */
create or replace function generate_finding_due_alerts(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare f record; n int := 0; v_today date := bogota_today(p_now); v_days int;
begin
  if auth.uid() is not null then raise exception 'No autorizado' using errcode = '42501'; end if;
  for f in select * from findings where status <> 'closed' and due_date is not null and due_date <= v_today + 2 loop
    v_days := f.due_date - v_today;
    if v_days < 0 then
      if insert_alert_once(f.project_id, 'overdue', case when f.severity in ('high','critical') then 'critical' else 'high' end::severity,
                           'Pendiente vencido', format('Venció hace %s día(s): %s', -v_days, left(f.description, 200)),
                           'findings', f.id, p_now) then n := n + 1; end if;
    else
      if insert_alert_once(f.project_id, 'due_soon', 'medium', 'Pendiente por vencer',
                           format('Vence %s: %s', case v_days when 0 then 'hoy' when 1 then 'mañana' else 'en 2 días' end, left(f.description, 200)),
                           'findings', f.id, p_now) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

/**
 * Frentes con actividades en curso que no tienen reporte del día. Se programa a las 5:00 p. m.
 * de Colombia, de lunes a sábado. "En curso" = con programación vigente o con avance en los
 * últimos 7 días, para no alertar por frentes que aún no empiezan o ya terminaron.
 */
create or replace function generate_no_report_alerts(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare fr record; n int := 0; v_today date := bogota_today(p_now);
begin
  if auth.uid() is not null then raise exception 'No autorizado' using errcode = '42501'; end if;
  if extract(isodow from v_today) = 7 then return 0; end if;
  for fr in
    select f.id, f.project_id, f.code, f.name from fronts f
    where exists (
      select 1 from activities a where a.front_id = f.id
        and ((a.planned_start <= v_today and coalesce(a.planned_finish, v_today) >= v_today)
             or exists (select 1 from progress_entries e where e.activity_id = a.id and e.work_date >= v_today - 7)))
      and not exists (select 1 from progress_entries e where e.front_id = f.id and e.work_date = v_today)
  loop
    if insert_alert_once(fr.project_id, 'no_report', 'medium', 'Frente sin reporte',
                         format('%s · %s no tiene reporte de avance hoy (%s).', fr.code, fr.name, to_char(v_today, 'DD/MM')),
                         'fronts', fr.id, p_now) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function generate_finding_due_alerts(timestamptz) from public, anon, authenticated;
revoke all on function generate_no_report_alerts(timestamptz) from public, anon, authenticated;

