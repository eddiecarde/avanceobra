-- AvanceObra · órdenes de cambio (adicionales) y acta de liquidación final
-- Una orden de cambio es de un contrato: el del cliente (company_id null) o el de un subcontratista.
-- Sus renglones cambian la cantidad o el precio de una actividad o agregan una nueva. Al aprobarse
-- se aplica sola (cantidades, precios, actividades nuevas y prórroga) y queda la foto de lo que cambió.
-- La liquidación cierra un contrato: después no se emiten más actas para él.

-- ---------- Órdenes de cambio ----------
create table change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid references project_companies(id),
  number int not null check (number > 0),
  title text not null check (length(trim(title)) >= 3),
  description text,
  reason text not null default 'cliente' check (reason in ('cliente', 'diseno', 'condiciones_sitio', 'omision', 'otro')),
  days_extension int not null default 0 check (days_extension >= 0),
  status text not null default 'borrador' check (status in ('borrador', 'enviada', 'aprobada', 'rechazada', 'anulada')),
  -- Valor del cambio (se calcula al enviarla y queda fijo al aprobarla)
  amount numeric(16,2),
  decided_by uuid references auth.users(id),
  decided_name text,
  decided_at timestamptz,
  decision_note text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index change_orders_number on change_orders (project_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), number);

create table change_order_items (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references change_orders(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  -- Actividad existente (cambio de cantidad y/o precio) o actividad nueva
  activity_id uuid references activities(id),
  delta_qty numeric(14,3) not null default 0,
  new_unit_price numeric(16,2) check (new_unit_price is null or new_unit_price >= 0),
  new_front_id uuid references fronts(id),
  new_code text,
  new_name text,
  new_unit text,
  -- Foto al aplicar: cómo estaba la actividad y cuál quedó (la nueva)
  old_qty numeric(14,3),
  old_unit_price numeric(16,2),
  applied_activity_id uuid references activities(id),
  check (activity_id is not null or (new_front_id is not null and length(trim(coalesce(new_code, ''))) >= 1
         and length(trim(coalesce(new_name, ''))) >= 3 and length(trim(coalesce(new_unit, ''))) >= 1 and delta_qty > 0 and new_unit_price is not null))
);
create index change_order_items_order on change_order_items (change_order_id);

alter table change_orders enable row level security;
alter table change_order_items enable row level security;
create policy change_orders_read on change_orders for select
  using (has_project_role(project_id, '{resident,director,admin}') and sees_company(project_id, company_id));
-- Solo los borradores se editan; enviar, decidir y anular van por las funciones de abajo
create policy change_orders_insert on change_orders for insert
  with check (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id) and status = 'borrador');
create policy change_orders_update on change_orders for update
  using (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id) and status = 'borrador')
  with check (status = 'borrador');
create policy change_orders_delete on change_orders for delete
  using (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id) and status = 'borrador');
create policy change_order_items_read on change_order_items for select
  using (exists (select 1 from change_orders c where c.id = change_order_id));
create policy change_order_items_write on change_order_items for all
  using (exists (select 1 from change_orders c where c.id = change_order_id and c.status = 'borrador' and has_project_role(c.project_id, '{director,admin}') and not is_subcontractor(c.project_id)))
  with check (exists (select 1 from change_orders c where c.id = change_order_id and c.status = 'borrador' and c.project_id = change_order_items.project_id
                      and has_project_role(c.project_id, '{director,admin}') and not is_subcontractor(c.project_id)));
create trigger change_orders_audit after insert or update or delete on change_orders for each row execute function audit_row();
create trigger change_order_items_audit after insert or update or delete on change_order_items for each row execute function audit_row();

/** Valor de una orden de cambio con los precios de su contrato (cliente: unit_price; subcontrato: subcontract_unit_price). */
create or replace function change_order_value(p_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    case when i.activity_id is null then i.delta_qty * i.new_unit_price
    else (a.contract_qty + i.delta_qty) * coalesce(i.new_unit_price, case when c.company_id is null then a.unit_price else a.subcontract_unit_price end, 0)
         - a.contract_qty * coalesce(case when c.company_id is null then a.unit_price else a.subcontract_unit_price end, 0)
    end), 0)::numeric(16,2)
  from change_orders c join change_order_items i on i.change_order_id = c.id
  left join activities a on a.id = i.activity_id
  where c.id = p_id;
$$;

/** Enviar una orden de cambio a aprobación (director o administrador del contratista). */
create or replace function submit_change_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c change_orders;
begin
  select * into c from change_orders where id = p_id;
  if not found then raise exception 'Orden de cambio no encontrada' using errcode = 'P0002'; end if;
  if not has_project_role(c.project_id, '{director,admin}') or is_subcontractor(c.project_id) then raise exception 'Solo el director o el administrador' using errcode = '42501'; end if;
  if c.status <> 'borrador' then raise exception 'La orden % ya fue enviada', c.number; end if;
  if not exists (select 1 from change_order_items where change_order_id = p_id) then raise exception 'La orden no tiene renglones'; end if;
  update change_orders set status = 'enviada', amount = change_order_value(p_id) where id = p_id;
end $$;

/** Aplica una orden aprobada: cantidades, precios, actividades nuevas y prórroga, con la foto de lo anterior. */
create or replace function apply_change_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c change_orders;
  i change_order_items;
  a activities;
  v_new uuid;
begin
  select * into c from change_orders where id = p_id;
  for i in select * from change_order_items where change_order_id = p_id loop
    if i.activity_id is not null then
      select * into a from activities where id = i.activity_id;
      update change_order_items set old_qty = a.contract_qty,
        old_unit_price = case when c.company_id is null then a.unit_price else a.subcontract_unit_price end,
        applied_activity_id = a.id
      where id = i.id;
      update activities set
        contract_qty = greatest(0, contract_qty + i.delta_qty),
        unit_price = case when c.company_id is null then coalesce(i.new_unit_price, unit_price) else unit_price end,
        subcontract_unit_price = case when c.company_id is not null then coalesce(i.new_unit_price, subcontract_unit_price) else subcontract_unit_price end
      where id = i.activity_id;
    else
      insert into activities (project_id, front_id, code, name, unit, contract_qty, unit_price, subcontract_unit_price, company_id)
      values (c.project_id, i.new_front_id, trim(i.new_code), trim(i.new_name), trim(i.new_unit), i.delta_qty,
              case when c.company_id is null then i.new_unit_price end,
              case when c.company_id is not null then i.new_unit_price end,
              c.company_id)
      returning id into v_new;
      update change_order_items set applied_activity_id = v_new where id = i.id;
    end if;
  end loop;
  if c.days_extension > 0 then
    if c.company_id is null then
      update projects set contract_end_date = contract_end_date + c.days_extension where id = c.project_id and contract_end_date is not null;
      update contracts set contract_end_date = contract_end_date + c.days_extension where project_id = c.project_id;
    else
      update subcontracts set end_date = end_date + c.days_extension where project_id = c.project_id and company_id = c.company_id and end_date is not null;
    end if;
  end if;
end $$;
revoke all on function apply_change_order(uuid) from public, anon, authenticated;

/** El contratista decide (subcontratos) o registra la decisión del cliente (contrato principal, con nota). */
create or replace function decide_change_order(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c change_orders;
begin
  select * into c from change_orders where id = p_id;
  if not found then raise exception 'Orden de cambio no encontrada' using errcode = 'P0002'; end if;
  if not has_project_role(c.project_id, '{director,admin}') or is_subcontractor(c.project_id) then raise exception 'Solo el director o el administrador' using errcode = '42501'; end if;
  if c.status <> 'enviada' then raise exception 'La orden % no está enviada', c.number; end if;
  if c.company_id is null and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'Escribe quién del cliente la aprobó o rechazó y con qué documento';
  end if;
  update change_orders set status = case when p_approve then 'aprobada' else 'rechazada' end,
    amount = change_order_value(p_id), decided_by = auth.uid(),
    decided_name = (select coalesce(full_name, 'Contratista') from profiles where id = auth.uid()),
    decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  if p_approve then perform apply_change_order(p_id); end if;
end $$;

/** El cliente aprueba o rechaza desde su portal una orden de cambio del contrato principal. */
create or replace function client_decide_change_order(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c change_orders; who project_clients; m record;
begin
  select * into c from change_orders where id = p_id;
  if not found or c.company_id is not null then raise exception 'Orden de cambio no encontrada' using errcode = 'P0002'; end if;
  select * into who from project_clients where project_id = c.project_id and user_id = auth.uid();
  if not found then raise exception 'No tienes acceso a esta obra como cliente' using errcode = '42501'; end if;
  if c.status <> 'enviada' then raise exception 'La orden % no está pendiente', c.number; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Escribe por qué se rechaza'; end if;
  update change_orders set status = case when p_approve then 'aprobada' else 'rechazada' end,
    amount = change_order_value(p_id), decided_by = auth.uid(),
    decided_name = who.name || coalesce(' (' || who.company || ')', ''), decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  if p_approve then perform apply_change_order(p_id); end if;
  for m in select user_id from memberships where project_id = c.project_id and role in ('admin', 'director') loop
    perform notify_user(m.user_id, c.project_id, 'acta_cliente',
      format('Orden de cambio N° %s %s por el cliente', c.number, case when p_approve then 'aprobada' else 'rechazada' end),
      format('%s · %s', c.title, who.name), 'change_orders', c.id);
  end loop;
end $$;

/** Anular una orden que no se aprobó (borrador o enviada). */
create or replace function void_change_order(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c change_orders;
begin
  select * into c from change_orders where id = p_id;
  if not found then raise exception 'Orden de cambio no encontrada' using errcode = 'P0002'; end if;
  if not has_project_role(c.project_id, '{director,admin}') or is_subcontractor(c.project_id) then raise exception 'Solo el director o el administrador' using errcode = '42501'; end if;
  if c.status not in ('borrador', 'enviada') then raise exception 'Una orden % no se anula', c.status; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Explica por qué se anula'; end if;
  update change_orders set status = 'anulada', decision_note = trim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

revoke all on function submit_change_order(uuid) from public, anon;
revoke all on function decide_change_order(uuid, boolean, text) from public, anon;
revoke all on function client_decide_change_order(uuid, boolean, text) from public, anon;
revoke all on function void_change_order(uuid, text) from public, anon;
revoke all on function change_order_value(uuid) from public, anon;
grant execute on function submit_change_order(uuid) to authenticated;
grant execute on function decide_change_order(uuid, boolean, text) to authenticated;
grant execute on function client_decide_change_order(uuid, boolean, text) to authenticated;
grant execute on function void_change_order(uuid, text) to authenticated;

-- ---------- Liquidación final ----------
create table settlements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid references project_companies(id),
  status text not null default 'emitida' check (status in ('emitida', 'anulada')),
  -- Foto de la liquidación (valores al emitirla)
  totals jsonb not null,
  notes text,
  issued_by uuid not null default auth.uid() references auth.users(id),
  issued_at timestamptz not null default now(),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text
);
create unique index settlements_one_per_contract on settlements (project_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'emitida';
alter table settlements enable row level security;
create policy settlements_read on settlements for select using (has_project_role(project_id, '{resident,director,admin}') and sees_company(project_id, company_id));
create policy settlements_insert on settlements for insert
  with check (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id) and status = 'emitida' and issued_by = auth.uid());
create policy settlements_void on settlements for update using (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id));
create trigger settlements_audit after insert or update or delete on settlements for each row execute function audit_row();

create or replace function guard_settlement() returns trigger language plpgsql as $$
begin
  if old.status = 'anulada' then raise exception 'La liquidación ya está anulada'; end if;
  if new.status <> 'anulada' or new.totals is distinct from old.totals or new.company_id is distinct from old.company_id then
    raise exception 'Una liquidación emitida no se modifica: anúlala y emite otra';
  end if;
  if length(trim(coalesce(new.void_reason, ''))) < 5 then raise exception 'Explica por qué se anula la liquidación'; end if;
  new.voided_by := auth.uid();
  new.voided_at := now();
  return new;
end $$;
create trigger settlements_guard before update on settlements for each row execute function guard_settlement();

-- Con la liquidación emitida, ese contrato no recibe más actas
create or replace function certificates_after_settlement() returns trigger language plpgsql as $$
begin
  if exists (select 1 from settlements s where s.project_id = new.project_id and s.company_id is not distinct from new.company_id and s.status = 'emitida') then
    raise exception 'Este contrato ya está liquidado: anula la liquidación para emitir otra acta';
  end if;
  return new;
end $$;
create trigger payment_certificates_settled before insert on payment_certificates for each row execute function certificates_after_settlement();

-- ---------- Portal del cliente: órdenes de cambio y liquidación del contrato principal ----------
create or replace function client_project(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from project_clients c join projects p on p.id = c.project_id
                 where c.project_id = p_project and c.user_id = auth.uid() and not p.suspended) then
    raise exception 'No tienes acceso a esta obra como cliente' using errcode = '42501';
  end if;
  return private.dashboard_data(p_project, true, false) || jsonb_build_object(
    'header', (select to_jsonb(x) from (select name, client_name, contractor_name, contract_code, report_signers, start_date from projects where id = p_project) x),
    'certificates', coalesce((select jsonb_agg(to_jsonb(x) order by x.number desc) from (
      select id, number, period_start, period_end, status, lines, totals, notes, issued_at, void_reason,
             client_status, client_note, client_decided_name, client_decided_at
      from payment_certificates where project_id = p_project and company_id is null) x), '[]'::jsonb),
    'handovers', coalesce((select jsonb_agg(to_jsonb(x) order by x.received_on desc) from (
      select id, scope, subfield, items, received_by_name, received_by_role, received_on, notes, created_at
      from punch_handovers where project_id = p_project) x), '[]'::jsonb),
    'change_orders', coalesce((select jsonb_agg(to_jsonb(x) order by x.number desc) from (
      select c.id, c.number, c.title, c.description, c.reason, c.days_extension, c.status, c.amount, c.decided_name, c.decided_at, c.decision_note, c.created_at,
             (select coalesce(jsonb_agg(jsonb_build_object(
                'activity', coalesce(a.code || ' · ' || a.name, i.new_code || ' · ' || i.new_name),
                'unit', coalesce(a.unit, i.new_unit), 'delta_qty', i.delta_qty, 'new_unit_price', i.new_unit_price, 'is_new', i.activity_id is null)), '[]'::jsonb)
              from change_order_items i left join activities a on a.id = i.activity_id where i.change_order_id = c.id) as items
      from change_orders c where c.project_id = p_project and c.company_id is null and c.status in ('enviada', 'aprobada', 'rechazada')) x), '[]'::jsonb),
    'settlement', (select to_jsonb(x) from (select id, totals, notes, issued_at from settlements
                   where project_id = p_project and company_id is null and status = 'emitida') x)
  );
end $$;
