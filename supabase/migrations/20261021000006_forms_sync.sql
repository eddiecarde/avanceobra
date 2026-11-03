-- AvanceObra · sincronización de formatos al teléfono
-- org_id desnormalizado en las versiones: las Sync Streams filtran por empresa sin subconsultas anidadas.

alter table form_template_versions add column org_id uuid references organizations(id);
update form_template_versions v set org_id = t.org_id from form_templates t where t.id = v.template_id and v.org_id is null;

create or replace function set_version_org() returns trigger language plpgsql as $$
begin
  select org_id into new.org_id from form_templates where id = new.template_id;
  return new;
end $$;
create trigger form_template_versions_org before insert on form_template_versions
  for each row execute function set_version_org();

alter table form_template_versions alter column org_id set not null;

-- Las zanjas no usan el formato de cableado
update activities set template_id = null where code like '%-ZAN';
