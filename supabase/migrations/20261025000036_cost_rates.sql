-- AvanceObra · tarifas para el costo real automático (valor ganado)
-- Con estas tarifas, el parte diario que ya llena el supervisor se convierte en costo real:
-- personas por cargo × tarifa diaria y equipos × tarifa diaria. Los materiales entregados se
-- valorizan con su precio. Un cargo o equipo sin tarifa no se cuenta (p. ej. el personal de un
-- subcontratista, que entra por sus actas de pago).
create table cost_rates (
  project_id uuid primary key references projects(id) on delete cascade,
  -- {"Oficial de obra": 120000}  (COP por persona-día)
  personnel jsonb not null default '{}' check (jsonb_typeof(personnel) = 'object'),
  -- {"Hincadora": 900000}  (COP por equipo-día, con operador y combustible si aplica)
  equipment jsonb not null default '{}' check (jsonb_typeof(equipment) = 'object'),
  -- {"<material_id>": 35000}  (COP por unidad del material)
  materials jsonb not null default '{}' check (jsonb_typeof(materials) = 'object'),
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table cost_rates enable row level security;
-- Las tarifas no las ve el supervisor de campo (no se sincronizan al teléfono)
create policy cost_rates_read on cost_rates for select using (has_project_role(project_id, '{resident,director,admin}'));
create policy cost_rates_write on cost_rates for all
  using (has_project_role(project_id, '{director,admin}')) with check (has_project_role(project_id, '{director,admin}'));
create trigger cost_rates_audit after insert or update or delete on cost_rates for each row execute function audit_row();
