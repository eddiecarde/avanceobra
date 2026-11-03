-- Endurecimiento (auditoría del 28 oct 2026, revisor de seguridad de Supabase):
-- 1) Ruta de búsqueda fija en las funciones que no la tenían: así nadie puede "sombrear" una tabla o
--    función con otra del mismo nombre en otro esquema.
alter function public.activities_company_check() set search_path = public;
alter function public.bogota_today(p_now timestamp with time zone) set search_path = public;
alter function public.certificates_after_settlement() set search_path = public;
alter function public.demo_lat(y_m double precision) set search_path = public;
alter function public.demo_lon(x_m double precision) set search_path = public;
alter function public.demo_pt(x_m double precision, y_m double precision) set search_path = public;
alter function public.demo_rect(x0 double precision, y0 double precision, x1 double precision, y1 double precision) set search_path = public;
alter function private.entry_snapshot(e progress_entries) set search_path = public;
alter function public.findings_links_check() set search_path = public;
alter function public.guard_approved_entries() set search_path = public;
alter function public.guard_finding_transition() set search_path = public;
alter function public.guard_payment_certificate() set search_path = public;
alter function public.guard_settlement() set search_path = public;
alter function public.guard_weekly_plan_items() set search_path = public;
alter function public.insert_alert_once(p_project uuid, p_kind text, p_severity severity, p_title text, p_body text, p_ref_table text, p_ref_id uuid, p_now timestamp with time zone) set search_path = public;
alter function public.memberships_company_check() set search_path = public;
alter function public.num_es(x numeric) set search_path = public;
alter function public.org_admins_keep_one() set search_path = public;
alter function public.seed_demo_solar(p_admin_email text, p_field_email text, p_resident_email text) set search_path = public;
alter function public.set_finding_updated_by() set search_path = public;
alter function public.set_version_org() set search_path = public;
alter function public.share_links_before_update() set search_path = public;
alter function public.simulations_immutable() set search_path = public;
alter function public.site_plans_company_check() set search_path = public;
alter function public.subcontracts_check() set search_path = public;
alter function public.workers_company_check() set search_path = public;

-- 2) Funciones que solo se usan con sesión iniciada: sin acceso para visitantes anónimos (por dentro
--    ya exigían sesión; esto cierra la puerta antes). request_demo y shared_dashboard siguen públicas.
revoke execute on function public.import_progress_history(uuid, jsonb, text) from anon, public;
revoke execute on function public.project_team(uuid) from anon, public;
revoke execute on function public.create_telegram_link_code() from anon, public;
revoke execute on function public.can_use_ai(uuid) from anon, public;
grant execute on function public.import_progress_history(uuid, jsonb, text) to authenticated;
grant execute on function public.project_team(uuid) to authenticated;
grant execute on function public.create_telegram_link_code() to authenticated;
grant execute on function public.can_use_ai(uuid) to authenticated;
