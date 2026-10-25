-- AvanceObra · simulaciones "acelerar vs. multa"
-- Cada simulación guarda la fotografía de sus supuestos y resultados, el escenario elegido y
-- la justificación. No se editan ni se borran: son el soporte de la decisión ante gerencia o cliente.

alter table simulations alter column id set default gen_random_uuid();
alter table simulations add column best_scenario text;
alter table simulations add column total_base numeric(18,2);
alter table simulations add column total_chosen numeric(18,2);
alter table simulations add column created_by_name text;

create or replace function set_simulation_author() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.created_by_name := coalesce((select full_name from profiles where id = auth.uid()), new.created_by_name);
  new.created_at := now();
  return new;
end $$;
create trigger simulations_author before insert on simulations for each row execute function set_simulation_author();

-- Inmutables también para el administrador (RLS ya no da UPDATE/DELETE; esto lo refuerza)
create or replace function simulations_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Las simulaciones guardadas no se modifican ni se borran (son soporte de decisiones)';
end $$;
create trigger simulations_no_update before update or delete on simulations for each row execute function simulations_immutable();
