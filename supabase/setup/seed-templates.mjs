// Genera el SQL que copia las plantillas precargadas al catálogo de formatos de una empresa
// (una fila en form_templates + su versión 1). Es idempotente: no duplica plantillas ya copiadas.
// Uso: node supabase/setup/seed-templates.mjs PV-DEMO > plantillas.sql
import { TEMPLATES } from "../../packages/forms/dist/index.js";

const projectCode = process.argv[2] ?? "PV-DEMO";
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const parts = [`do $$
declare v_org uuid; v_t uuid;
begin
  select org_id into v_org from projects where code = ${q(projectCode)};
  if v_org is null then raise exception 'No existe el proyecto ${projectCode}'; end if;`];

for (const { key, definition: d } of TEMPLATES) {
  parts.push(`
  if not exists (select 1 from form_templates where org_id = v_org and template_key = ${q(key)}) then
    insert into form_templates (org_id, name, category, work_type, current_version, description, template_key)
    values (v_org, ${q(d.name)}, ${q(d.category)}, ${q(d.workType)}, 1, ${d.description ? q(d.description) : "null"}, ${q(key)})
    returning id into v_t;
    insert into form_template_versions (template_id, version, schema, changelog)
    values (v_t, 1, ${q(JSON.stringify(d))}::jsonb, 'Plantilla precargada');
  end if;`);
}
parts.push(`
end $$;
select count(*) as formatos from form_templates;`);
console.log(parts.join("\n"));
