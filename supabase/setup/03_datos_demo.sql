-- Datos de prueba de la obra solar. Antes, crea los usuarios en Authentication > Users > Add user
-- (marca "Auto Confirm User"). Reemplaza los correos y ejecuta en el SQL Editor.
-- Con un solo correo, ese usuario queda como administrador (ve todo, incluida la pestaña Revisar).
select seed_demo_solar('TU_CORREO@ejemplo.com');

-- Opcional, para probar roles:
-- select seed_demo_solar('admin@ejemplo.com', 'supervisor@ejemplo.com', 'residente@ejemplo.com');

-- Ruta donde subir supabase/seed/plano-demo.png (Storage > plans > crear carpeta con este id):
select id as carpeta_para_el_plano, id || '/plano-demo.png' as ruta_completa from projects where code = 'PV-DEMO';
