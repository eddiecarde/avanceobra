-- AvanceObra · contrato de cada subcontratista en la obra
-- Alcance, fechas y condiciones de pago (retención, anticipo, AIU e IVA). Sus actividades y precios
-- ya están en activities (company_id y subcontract_unit_price); las actas de pago toman de aquí las
-- condiciones mientras no haya un acta anterior.
create table subcontracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references project_companies(id) on delete cascade,
  contract_code text,
  scope text,
  start_date date,
  end_date date,
  retention_pct numeric(6,4) not null default 0 check (retention_pct between 0 and 0.5),
  advance_pct numeric(6,4) not null default 0 check (advance_pct between 0 and 1),
  -- Anticipo entregado (pesos): se amortiza en las actas con advance_pct
  advance_amount numeric(16,2) not null default 0 check (advance_amount >= 0),
  admin_pct numeric(6,4) not null default 0 check (admin_pct between 0 and 1),
  contingency_pct numeric(6,4) not null default 0 check (contingency_pct between 0 and 1),
  utility_pct numeric(6,4) not null default 0 check (utility_pct between 0 and 1),
  vat_mode text not null default 'none' check (vat_mode in ('none', 'utility', 'full')),
  vat_pct numeric(6,4) not null default 0.19 check (vat_pct between 0 and 1),
  notes text,
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (project_id, company_id),
  check (end_date is null or start_date is null or end_date >= start_date)
);
alter table subcontracts enable row level security;
-- Lo ven el residente, el director y el administrador (el del subcontratista, solo el suyo)
create policy subcontracts_read on subcontracts for select
  using (has_project_role(project_id, '{resident,director,admin}') and sees_company(project_id, company_id));
create policy subcontracts_write on subcontracts for all
  using (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id))
  with check (has_project_role(project_id, '{director,admin}') and not is_subcontractor(project_id));
create trigger subcontracts_audit after insert or update or delete on subcontracts for each row execute function audit_row();

-- La empresa debe ser de la misma obra y de tipo subcontratista
create or replace function subcontracts_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from project_companies c where c.id = new.company_id and c.project_id = new.project_id and c.kind = 'subcontratista') then
    raise exception 'La empresa no es un subcontratista de esta obra';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger subcontracts_check before insert or update on subcontracts for each row execute function subcontracts_check();
