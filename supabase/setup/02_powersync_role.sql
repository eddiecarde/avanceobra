-- Rol de solo lectura con replicación para PowerSync.
-- 1) Reemplaza CAMBIA_ESTA_CLAVE por una clave larga y aleatoria (guárdala: la pide PowerSync).
-- 2) Pega y ejecuta en Supabase > SQL Editor.
-- La publicación "powersync" ya la creó 01_esquema_y_semilla.sql.
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
