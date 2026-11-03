-- AvanceObra · asistente con modelos de Meta (Muse Spark, SAM 3.1, Muse Voice Transcribe)
-- Las llamadas a los modelos las hace la Edge Function ai-assist; aquí se guarda lo que produce.

-- Concepto en inglés para que SAM cuente los elementos de la actividad en las fotos ("steel pile", "solar panel"…).
-- Vacío = se deduce del nombre de la actividad.
alter table activities add column ai_count_prompt text check (ai_count_prompt is null or length(ai_count_prompt) between 2 and 60);

-- ---------- Verificación de un registro de avance con sus fotos ----------
create table entry_ai_checks (
  entry_id uuid primary key references progress_entries(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  status text not null check (status in ('consistente', 'revisar', 'sin_evidencia', 'error')),
  reported numeric(14,3) not null,
  -- Elementos contados por SAM en las fotos (null = la actividad no se cuenta)
  sam_count int,
  sam_concept text,
  -- Lo que vio Muse Spark: ¿la foto corresponde a la actividad?, cuántos ve, comentario
  vision_count int,
  matches_activity boolean,
  comment text not null default '',
  -- [{photo_id, width, height, boxes:[{x1,y1,x2,y2,c}]}] para dibujar lo contado sobre la foto
  photos jsonb not null default '[]',
  checked_at timestamptz not null default now(),
  checked_by uuid references auth.users(id)
);
create index entry_ai_checks_project on entry_ai_checks (project_id, checked_at desc);
alter table entry_ai_checks enable row level security;
-- Quien ve el registro ve su verificación (las políticas de progress_entries aplican dentro del exists)
create policy entry_ai_checks_read on entry_ai_checks for select
  using (exists (select 1 from progress_entries e where e.id = entry_ai_checks.entry_id));

-- ---------- Análisis de la foto de un hallazgo ----------
alter table findings add column ai_analysis jsonb;

-- ---------- Uso de los modelos (límite diario por persona y control de costo) ----------
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references projects(id) on delete cascade,
  action text not null,
  ok boolean not null default true,
  ms int,
  created_at timestamptz not null default now()
);
create index ai_usage_user_day on ai_usage (user_id, created_at desc);
alter table ai_usage enable row level security;
create policy ai_usage_owner on ai_usage for select using (is_platform_admin());
