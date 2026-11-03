-- Actas de corte y cobro: precio unitario de cada ítem (con el cliente y con el subcontratista) y
-- actas emitidas con su foto (cantidades y valores congelados al emitir).
alter table activities add column unit_price numeric(16,2) check (unit_price is null or unit_price >= 0);
alter table activities add column subcontract_unit_price numeric(16,2) check (subcontract_unit_price is null or subcontract_unit_price >= 0);

create table payment_certificates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- null = acta del contrato con el cliente; si no, acta de pago a esa empresa (subcontratista)
  company_id uuid references project_companies(id),
  number int not null check (number > 0),
  period_start date not null,
  period_end date not null,
  status text not null default 'emitida' check (status in ('emitida', 'anulada')),
  retention_pct numeric(6,4) not null default 0 check (retention_pct between 0 and 0.5),
  advance_pct numeric(6,4) not null default 0 check (advance_pct between 0 and 1),
  -- Por ítem: cantidad anterior, del periodo y acumulada, precio y valores (no cambian después)
  lines jsonb not null,
  totals jsonb not null,
  notes text,
  issued_by uuid not null default auth.uid() references auth.users(id),
  issued_at timestamptz not null default now(),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  check (period_end >= period_start)
);
create unique index payment_certificates_number on payment_certificates (project_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), number);
create index payment_certificates_project on payment_certificates (project_id, issued_at desc);

alter table payment_certificates enable row level security;
create policy certificates_read on payment_certificates for select using (has_project_role(project_id));
create policy certificates_insert on payment_certificates for insert with check (has_project_role(project_id, '{admin,director}') and issued_by = auth.uid() and status = 'emitida');
create policy certificates_void on payment_certificates for update using (has_project_role(project_id, '{admin,director}'));

-- Un acta emitida no se edita: solo se anula, con motivo, y queda quién y cuándo
create or replace function guard_payment_certificate() returns trigger language plpgsql as $$
begin
  if old.status = 'anulada' then raise exception 'El acta % ya está anulada', old.number; end if;
  if new.status <> 'anulada' or new.lines is distinct from old.lines or new.totals is distinct from old.totals
     or new.number <> old.number or new.period_start <> old.period_start or new.period_end <> old.period_end
     or new.company_id is distinct from old.company_id or new.retention_pct <> old.retention_pct or new.advance_pct <> old.advance_pct then
    raise exception 'Un acta emitida no se modifica: anúlala y emite una nueva';
  end if;
  if length(trim(coalesce(new.void_reason, ''))) < 5 then raise exception 'Explica por qué se anula el acta'; end if;
  new.voided_by := auth.uid();
  new.voided_at := now();
  return new;
end $$;
create trigger payment_certificates_guard before update on payment_certificates for each row execute function guard_payment_certificate();
create trigger payment_certificates_audit after insert or update or delete on payment_certificates for each row execute function audit_row();
