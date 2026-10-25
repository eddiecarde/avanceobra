-- AvanceObra · jornada de trabajo del proyecto
-- La lluvia del parte diario solo cuenta para días reclamables si cae dentro de la jornada.
alter table projects add column work_start time not null default '07:00';
alter table projects add column work_end time not null default '17:00';
alter table projects add constraint projects_work_window_chk check (work_end > work_start);
