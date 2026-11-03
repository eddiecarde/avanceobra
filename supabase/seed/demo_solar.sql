-- =====================================================================================
-- AvanceObra · Datos de prueba: "Parque Solar Demo" (fotovoltaico, trackers de un eje)
--
-- Uso (en el SQL Editor de Supabase, después de las migraciones):
--   select seed_demo_solar('admin@tuempresa.com');
--   -- opcional, con usuarios por rol:
--   select seed_demo_solar('admin@tuempresa.com', 'supervisor@tuempresa.com', 'residente@tuempresa.com');
--
-- Los correos deben existir antes en Authentication > Users. La función es idempotente:
-- si el proyecto PV-DEMO ya existe, solo agrega las membresías que falten.
--
-- Geometría: origen en 9.9500 N, -73.6500 W (Cesar, Colombia). Coordenadas locales en metros
-- (x hacia el este, y hacia el norte) convertidas a grados.
--   Bloque A: x 0–72 m · Bloque B: x 110–182 m · 2 filas de 12 trackers (60 m × 2,2 m, pitch 6 m)
--   8 pilotes por tracker → 192 pilotes por bloque.
-- =====================================================================================

create or replace function demo_lon(x_m double precision) returns double precision
language sql immutable as $$ select -73.6500 + x_m / 109647.0 $$;

create or replace function demo_lat(y_m double precision) returns double precision
language sql immutable as $$ select 9.9500 + y_m / 110574.0 $$;

create or replace function demo_pt(x_m double precision, y_m double precision) returns geometry
language sql immutable as $$ select st_setsrid(st_makepoint(demo_lon(x_m), demo_lat(y_m)), 4326) $$;

create or replace function demo_rect(x0 double precision, y0 double precision, x1 double precision, y1 double precision)
returns geometry language sql immutable as $$
  select st_setsrid(st_makepolygon(st_makeline(array[
    st_makepoint(demo_lon(x0), demo_lat(y0)), st_makepoint(demo_lon(x1), demo_lat(y0)),
    st_makepoint(demo_lon(x1), demo_lat(y1)), st_makepoint(demo_lon(x0), demo_lat(y1)),
    st_makepoint(demo_lon(x0), demo_lat(y0))])), 4326)
$$;

create or replace function seed_demo_solar(
  p_admin_email text,
  p_field_email text default null,
  p_resident_email text default null
) returns uuid language plpgsql as $$
declare
  v_admin uuid;
  v_field uuid;
  v_resident uuid;
  v_org uuid;
  v_sub uuid;
  v_project uuid;
  v_front uuid;
  v_fronts jsonb := '{}';
  v_acts jsonb := '{}';
  v_act uuid;
  v_entry uuid;
  b record;
  r int; c int; k int; n int;
  v_tracker_code text;
  d int;
  v_date date;
  v_qty double precision;
  v_lost double precision;
  v_cause loss_cause;
  v_weather weather_kind;
  v_status entry_status;
  v_done_a int := 0;
  v_done_b int := 0;
  v_trk_a int := 0;
  v_zan int := 0;
begin
  select id into v_admin from auth.users where lower(email) = lower(p_admin_email);
  if v_admin is null then
    raise exception 'No existe el usuario %. Créalo primero en Authentication > Users.', p_admin_email;
  end if;
  if p_field_email is not null then
    select id into v_field from auth.users where lower(email) = lower(p_field_email);
    if v_field is null then raise exception 'No existe el usuario %', p_field_email; end if;
  end if;
  if p_resident_email is not null then
    select id into v_resident from auth.users where lower(email) = lower(p_resident_email);
    if v_resident is null then raise exception 'No existe el usuario %', p_resident_email; end if;
  end if;

  -- Perfiles
  insert into profiles (id, full_name)
  select u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
  from auth.users u where u.id in (v_admin, v_field, v_resident)
  on conflict (id) do nothing;

  select id into v_project from projects where code = 'PV-DEMO';
  if v_project is not null then
    select org_id into v_org from projects where id = v_project;
  else
    -- ---------- Organización y proyecto ----------
    insert into organizations (name, tax_id) values ('Constructora Demo S.A.S.', '900000000-1') returning id into v_org;
    insert into organizations (name, tax_id, parent_org_id) values ('Montajes Solares Demo S.A.S.', '900000000-2', v_org) returning id into v_sub;

    insert into projects (org_id, code, name, project_type, currency, start_date, contract_end_date, bbox)
    values (v_org, 'PV-DEMO', 'Parque Solar Demo · Cesar', 'solar', 'COP',
            current_date - 30, current_date + 30, demo_rect(-15, -15, 197, 141))
    returning id into v_project;

    insert into contracts (project_id, contract_value, contract_end_date, penalty_mode, penalty_per_day,
                           penalty_cap_percent, early_bonus_per_day, daily_indirect_cost)
    values (v_project, 48000000000, current_date + 30, 'amount', 24000000, 0.10, 0, 18000000);

    insert into cost_settings (project_id, inspection_cost_per_day, expected_rework_pct)
    values (v_project, 1200000, 0.02);

    insert into resource_catalog (org_id, name, kind, unit, ref_rate, rate_basis, mechanical_availability, ownership,
                                  cost_per_hour, operator_cost_per_hour, fuel_cost_per_hour, mobilization_cost, min_rental_days)
    values
      (v_org, 'Hincadora de pilotes', 'equipment', 'pilotes', 14, 'hour', 0.85, 'rented', 260000, 30000, 45000, 6000000, 30),
      (v_org, 'Cuadrilla montaje de trackers (8 personas)', 'crew', 'trackers', 1.2, 'day', 1, 'own', 0, 220000, 0, 0, 0),
      (v_org, 'Cuadrilla instalación de módulos (10 personas)', 'crew', 'módulos', 16, 'hour', 1, 'own', 0, 270000, 0, 0, 0),
      (v_org, 'Retroexcavadora para zanjas', 'equipment', 'm', 9, 'hour', 0.85, 'rented', 150000, 25000, 30000, 2500000, 15),
      (v_org, 'Cuadrilla tendido de cable MT (6 personas)', 'crew', 'm', 12, 'hour', 1, 'own', 0, 165000, 0, 0, 0);

    -- ---------- Frentes y actividades ----------
    for b in select * from (values ('BA', 'Bloque A', 0.0), ('BB', 'Bloque B', 110.0)) as t(code, name, x_off) loop
      insert into fronts (project_id, code, name, max_parallel_resources, geom)
      values (v_project, b.code, b.name, 3, demo_rect(b.x_off - 3, -10, b.x_off + 75, 129))
      returning id into v_front;
      v_fronts := v_fronts || jsonb_build_object(b.code, v_front);

      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-HIN', 'Hincado de pilotes', 'pilotes', 192, current_date - 22, current_date + 10)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-HIN', v_act);
      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-MON', 'Montaje de trackers', 'trackers', 24, current_date - 15, current_date + 20)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-MON', v_act);
      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-MOD', 'Instalación de módulos', 'módulos', 2016, current_date - 8, current_date + 25)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-MOD', v_act);
      insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
      values (v_project, v_front, b.code || '-ZAN', 'Zanjas DC', 'm', 900, current_date - 20, current_date + 15)
      returning id into v_act;
      v_acts := v_acts || jsonb_build_object(b.code || '-ZAN', v_act);

      -- Trackers (polígonos) y pilotes (puntos), con su código QR
      for r in 0..1 loop
        for c in 0..11 loop
          n := r * 12 + c + 1;
          v_tracker_code := right(b.code, 1) || '-T' || lpad(n::text, 2, '0');
          insert into elements (project_id, front_id, activity_id, kind, code, qr_code, qty, geom)
          values (v_project, v_front, (v_acts->>(b.code || '-MON'))::uuid, 'tracker', v_tracker_code, 'QR-' || v_tracker_code, 1,
                  demo_rect(b.x_off + c * 6, r * 66, b.x_off + c * 6 + 2.2, r * 66 + 60));
          for k in 0..7 loop
            insert into elements (project_id, front_id, activity_id, kind, code, qr_code, qty, geom)
            values (v_project, v_front, (v_acts->>(b.code || '-HIN'))::uuid, 'pile', v_tracker_code || '-P' || (k + 1),
                    'QR-' || v_tracker_code || '-P' || (k + 1), 1,
                    demo_pt(b.x_off + c * 6 + 1.1, r * 66 + k * (60.0 / 7)));
          end loop;
        end loop;
      end loop;
    end loop;

    insert into fronts (project_id, code, name, max_parallel_resources, geom)
    values (v_project, 'CS', 'Cableado MT y subestación', 2, demo_rect(-15, -15, 197, -5))
    returning id into v_front;
    v_fronts := v_fronts || jsonb_build_object('CS', v_front);
    insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
    values (v_project, v_front, 'CS-TMT', 'Tendido de cable MT', 'm', 2400, current_date - 10, current_date + 28)
    returning id into v_act;
    v_acts := v_acts || jsonb_build_object('CS-TMT', v_act);
    insert into activities (project_id, front_id, code, name, unit, contract_qty, planned_start, planned_finish)
    values (v_project, v_front, 'CS-CIV', 'Obra civil subestación (concreto)', 'm3', 180, current_date + 5, current_date + 28)
    returning id into v_act;
    v_acts := v_acts || jsonb_build_object('CS-CIV', v_act);

    -- Plano georreferenciado (la imagen se sube aparte al bucket "plans" con esta misma ruta)
    insert into site_plans (project_id, name, version, storage_path, source_format, corners)
    values (v_project, 'Layout general', 1, v_project || '/plano-demo.png', 'png',
            jsonb_build_array(
              jsonb_build_array(demo_lon(-15), demo_lat(141)), jsonb_build_array(demo_lon(197), demo_lat(141)),
              jsonb_build_array(demo_lon(197), demo_lat(-15)), jsonb_build_array(demo_lon(-15), demo_lat(-15))));

    -- ---------- Historial de 20 días ----------
    for d in reverse 20..1 loop
      v_date := current_date - d;
      continue when extract(isodow from v_date) = 7; -- domingo
      v_status := case when d > 3 then 'approved' else 'submitted' end;

      -- Bloque A · hincado (con lluvia, equipo, material y permisos para el Pareto)
      v_lost := 0; v_cause := 'none'; v_weather := 'sunny'; v_qty := 11;
      if d in (15, 9) then v_qty := 3; v_lost := 5; v_cause := 'weather'; v_weather := 'heavy_rain';
      elsif d = 18 then v_qty := 8; v_lost := 2; v_cause := 'weather'; v_weather := 'light_rain';
      elsif d = 12 then v_qty := 6; v_lost := 3; v_cause := 'equipment';
      elsif d = 6 then v_qty := 7; v_lost := 2.5; v_cause := 'material'; v_weather := 'cloudy';
      elsif d = 4 then v_qty := 8; v_lost := 2; v_cause := 'permits';
      end if;
      v_qty := least(v_qty, 192 - v_done_a);
      if v_qty > 0 then
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, notes, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-HIN')::uuid, v_date, v_qty, 8 - v_lost, v_lost,
          v_cause, v_weather, 6, case v_cause when 'equipment' then 'Falla hidráulica hincadora 2' when 'material' then 'Llegada tardía de perfiles' else '' end,
          demo_pt(36, 60), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end,
          'seed', v_date + time '17:30');
        insert into entry_elements (project_id, entry_id, element_id)
        select v_project, v_entry, e.id from elements e
        where e.activity_id = (v_acts->>'BA-HIN')::uuid order by e.code offset v_done_a limit v_qty::int;
        v_done_a := v_done_a + v_qty::int;
      end if;

      -- Bloque A · montaje de trackers (1 por día desde hace 14 días, solo trackers con pilotes completos)
      if d <= 14 and v_trk_a < (v_done_a / 8) then
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-MON')::uuid, v_date, 1, 8, 0, 'none', v_weather, 8,
          demo_pt(30, 30), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:40');
        insert into entry_elements (project_id, entry_id, element_id)
        select v_project, v_entry, e.id from elements e
        where e.activity_id = (v_acts->>'BA-MON')::uuid order by e.code offset v_trk_a limit 1;
        v_trk_a := v_trk_a + 1;
      end if;

      -- Bloque A · zanjas DC con área trabajada dibujada
      if d <= 18 then
        v_qty := case when v_weather = 'heavy_rain' then 15 else 45 end;
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-ZAN')::uuid, v_date, v_qty,
          case when v_weather = 'heavy_rain' then 3 else 8 end, case when v_weather = 'heavy_rain' then 5 else 0 end,
          case when v_weather = 'heavy_rain' then 'weather' else 'none' end::loss_cause, v_weather, 5,
          demo_pt(36, -8), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:50');
        if v_zan < 70 then
          insert into progress_areas (id, project_id, entry_id, geom, is_approximate)
          values (gen_random_uuid(), v_project, v_entry, demo_rect(v_zan, -9, least(v_zan + 8, 72), -7.5), true);
          v_zan := v_zan + 8;
        end if;
      end if;

      -- Bloque A · módulos (desde hace 8 días)
      if d <= 8 then
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, (v_acts->>'BA-MOD')::uuid, v_date,
          case when d = 6 then 60 else 126 end, case when d = 6 then 6 else 8 end, case when d = 6 then 2 else 0 end,
          case when d = 6 then 'material' else 'none' end::loss_cause, v_weather, 10,
          demo_pt(20, 30), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:55');
      end if;

      -- Bloque B · hincado lento (inició hace 6 días): genera proyección tardía y alerta
      if d <= 6 then
        v_qty := case when d = 4 then 3 else 6 end;
        v_entry := gen_random_uuid();
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, notes, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (v_entry, v_project, (v_fronts->>'BB')::uuid, (v_acts->>'BB-HIN')::uuid, v_date, v_qty,
          case when d = 4 then 4 else 7 end, case when d = 4 then 4 else 1 end,
          case when d = 4 then 'permits' else 'labor' end::loss_cause, v_weather, 4,
          case when d = 4 then 'Permiso de trabajo en caliente sin firmar' else 'Cuadrilla incompleta' end,
          demo_pt(146, 60), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '17:35');
        insert into entry_elements (project_id, entry_id, element_id)
        select v_project, v_entry, e.id from elements e
        where e.activity_id = (v_acts->>'BB-HIN')::uuid order by e.code offset v_done_b limit v_qty::int;
        v_done_b := v_done_b + v_qty::int;
      end if;

      -- Cableado MT (desde hace 10 días)
      if d <= 10 then
        insert into progress_entries (id, project_id, front_id, activity_id, work_date, quantity, effective_hours, lost_hours,
          loss_cause, weather, crew_size, location, status, created_by, approved_by, approved_at, device_id, client_created_at)
        values (gen_random_uuid(), v_project, (v_fronts->>'CS')::uuid, (v_acts->>'CS-TMT')::uuid, v_date,
          case when d in (9, 3) then 40 else 85 end, case when d in (9, 3) then 5 else 8 end, case when d in (9, 3) then 3 else 0 end,
          case when d = 9 then 'weather' when d = 3 then 'design_client' else 'none' end::loss_cause, v_weather, 6,
          demo_pt(90, -10), v_status, coalesce(v_field, v_admin),
          case when v_status = 'approved' then coalesce(v_resident, v_admin) end,
          case when v_status = 'approved' then v_date + time '18:00' end, 'seed', v_date + time '18:05');
      end if;
    end loop;

    -- ---------- Hallazgos ----------
    insert into findings (id, project_id, front_id, type, severity, status, description, location, responsible_user_id,
                          due_date, created_by, created_at)
    values
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'safety', 'critical', 'open',
       'Zanja DC abierta sin señalización ni barandas en el tramo sur del Bloque A',
       demo_pt(50, -8), coalesce(v_field, v_admin), current_date - 1, coalesce(v_field, v_admin), now() - interval '2 days'),
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'quality', 'high', 'in_correction',
       'Pilote A-T03-P5 fuera de tolerancia de verticalidad (2,1° medido > 1,5° admisible)',
       demo_pt(13.1, 34.3), coalesce(v_field, v_admin), current_date + 2, coalesce(v_resident, v_admin), now() - interval '4 days'),
      (gen_random_uuid(), v_project, (v_fronts->>'BB')::uuid, 'environment', 'medium', 'open',
       'Derrame menor de ACPM junto a la hincadora 2; falta kit antiderrames',
       demo_pt(150, 20), coalesce(v_field, v_admin), current_date + 5, coalesce(v_field, v_admin), now() - interval '1 day'),
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'operation', 'low', 'to_review',
       'Falta rotulado de strings en el tracker A-T05',
       demo_pt(25, 30), coalesce(v_field, v_admin), current_date + 3, coalesce(v_field, v_admin), now() - interval '9 days'),
      (gen_random_uuid(), v_project, (v_fronts->>'BA')::uuid, 'quality', 'medium', 'closed',
       'Torque de pernos de módulos por debajo de especificación en A-T01 (corregido y verificado)',
       demo_pt(1, 30), coalesce(v_field, v_admin), current_date - 6, coalesce(v_resident, v_admin), now() - interval '12 days');
  end if;

  -- ---------- Membresías (idempotente) ----------
  insert into memberships (user_id, project_id, org_id, role, member_name)
  select v_admin, v_project, v_org, 'admin', coalesce((select full_name from profiles where id = v_admin), p_admin_email)
  on conflict (user_id, project_id) do nothing;
  if v_field is not null then
    insert into memberships (user_id, project_id, org_id, role, member_name)
    select v_field, v_project, v_org, 'field', coalesce((select full_name from profiles where id = v_field), p_field_email)
    on conflict (user_id, project_id) do nothing;
  end if;
  if v_resident is not null then
    insert into memberships (user_id, project_id, org_id, role, member_name)
    select v_resident, v_project, v_org, 'resident', coalesce((select full_name from profiles where id = v_resident), p_resident_email)
    on conflict (user_id, project_id) do nothing;
  end if;

  return v_project;
end $$;
