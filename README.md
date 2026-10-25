# AvanceObra

**Offline-first construction progress tracking, built for the field.** Supervisors record daily progress in three taps, with or without signal. Managers see S-curves, delays, payment certificates and quality issues, and get a clear answer to the question every late project faces: *accelerate, or pay the delay penalty?*

**Control de avance de obra que funciona sin señal.** El supervisor registra el avance del día en tres toques, haya o no cobertura. El gerente ve curvas S, atrasos, actas de cobro y hallazgos de calidad, y obtiene una respuesta clara a la pregunta de toda obra atrasada: *¿acelerar o pagar la multa?*

Live web app: https://avanceobra-six.vercel.app

## What it does / Qué hace

**Field (Android/iOS app, works offline)**
- Progress entry in 3 taps, with GPS-watermarked photos, QR codes and marking work on the site plan.
- Daily log (crew, equipment, rain).
- Quality: non-conformities, punch lists and inspections, with closing photos.
- Material deliveries, and "what's due today" from the committed weekly plan.
- Personal notices.

**Office (web)**
- Dashboard: S-curve, traffic lights by front and zone, Pareto of lost-time causes, map and weather.
- Weekly lookahead with PPC (percent plan complete).
- Payment certificates with AIU and VAT, plus a client portal where the client approves them.
- Claimable rain days, and an "accelerate vs. pay penalty" simulator.
- Automatic nightly and weekly reports (Telegram / PDF).
- Multi-project management view.

**Integrations**
- Imports MS Project (XML/MPP), Primavera P6 (XER), Excel templates and contractor daily reports.
- Matches baselines across schedules that use different codes.
- Exports actual progress back to MS Project and P6.

## Architecture / Arquitectura

| Layer | Tech |
|---|---|
| Mobile | Expo / React Native, PowerSync + SQLite (offline sync), EAS OTA updates |
| Web | Next.js, Tailwind, Recharts, MapLibre |
| Backend | Supabase Postgres with row-level security per project and role, audit triggers, immutable approved records, pg_cron, Edge Functions |
| Engine | Pure TypeScript package shared by mobile and web: calendar with Colombian holidays, productivity, CPM, S-curve, penalties and scenarios, payments, materials, weekly planning |

```
apps/mobile        field app (Expo)
apps/web           admin web + client portal (Next.js)
packages/engine    calculation engine (no UI dependencies)
packages/importers Excel, MS Project, Primavera, contractor reports
packages/forms     editable form templates
packages/shared    domain types and Zod schemas
supabase/          migrations, RLS, functions, tests
```

## Tests / Pruebas

| Package | Tests |
|---|---:|
| `packages/engine` | 87 |
| `packages/importers` | 32 |
| `packages/forms` | 34 |
| `apps/mobile` | 53 |
| `apps/web` (Playwright end-to-end) | 65 |
| `supabase` (functions) | 27 + database checks |

## Commands / Comandos

```
npm install
npm run verify                          # build, types, tests, functions, database and web e2e
npm run dev -w @avanceobra/web          # web at http://localhost:3100
```

Setup (Supabase, PowerSync, APK, alerts): [docs/PUESTA_EN_MARCHA.md](docs/PUESTA_EN_MARCHA.md). More detail is in [docs/PLAN.md](docs/PLAN.md), [docs/DECISIONES.md](docs/DECISIONES.md), [docs/PLAN_DE_PRUEBAS.md](docs/PLAN_DE_PRUEBAS.md) and [docs/HOJA_DE_RUTA.md](docs/HOJA_DE_RUTA.md).

Secrets are never committed: they live in `supabase/.secrets.local` (git-ignored) and in each service's dashboard.
