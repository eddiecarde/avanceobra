-- Un hallazgo ligado a una actividad toma como responsable la empresa de esa actividad si no se
-- eligió otra: el teléfono crea NC y punch sin señal y no tiene la lista de empresas.
create or replace function findings_links_check() returns trigger language plpgsql as $$
begin
  if new.activity_id is not null and not exists (select 1 from activities where id = new.activity_id and project_id = new.project_id) then
    raise exception 'La actividad no pertenece a este proyecto';
  end if;
  if new.element_id is not null and not exists (select 1 from elements where id = new.element_id and project_id = new.project_id) then
    raise exception 'El elemento no pertenece a este proyecto';
  end if;
  if tg_op = 'INSERT' and new.company_id is null and new.activity_id is not null then
    select company_id into new.company_id from activities where id = new.activity_id;
  end if;
  if new.company_id is not null and not exists (select 1 from project_companies where id = new.company_id and project_id = new.project_id) then
    raise exception 'La empresa no pertenece a este proyecto';
  end if;
  return new;
end $$;
