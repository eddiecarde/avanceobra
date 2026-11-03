-- AvanceObra · empresa responsable de cada actividad (contratista o subcontratista)
-- Permite ver el avance, los atrasos y las pérdidas de tiempo por empresa en el dashboard.

alter table activities add column company_id uuid references project_companies(id) on delete set null;

/** La empresa de una actividad debe ser del mismo proyecto. */
create or replace function activities_company_check() returns trigger language plpgsql as $$
begin
  if new.company_id is not null and not exists (
    select 1 from project_companies c where c.id = new.company_id and c.project_id = new.project_id) then
    raise exception 'La empresa no pertenece a este proyecto';
  end if;
  return new;
end $$;
create trigger activities_company_check before insert or update of company_id on activities
  for each row execute function activities_company_check();
