# AvanceObra

**Offline-first construction progress tracking, built for the field.** Supervisors record daily progress in three taps, with or without signal. Managers see S-curves, delays, payment certificates and quality issues, and get a clear answer to the question every late project faces: *accelerate, or pay the delay penalty?*

**Control de avance de obra que funciona sin señal.** El supervisor registra el avance del día en tres toques, haya o no cobertura. El gerente ve curvas S, atrasos, actas de cobro y hallazgos de calidad, y obtiene una respuesta clara a la pregunta de toda obra atrasada: *¿acelerar o pagar la multa?*

Live web app: https://avanceobra-six.vercel.app

## Meta AI features (Meta Global AI Developer Hackathon)

The app already had the data plumbing: offline sync, a schedule engine and approval workflows. For the hackathon, I added Meta models where they take real work off the site team. The deterministic engine stays the source of truth for every number, and the models read, count, classify and explain.

| Feature | Meta models | Where |
|---|---|---|
| **Voice-to-daily-log.** The supervisor dictates the day in Spanish ("hoy hincamos 120 pilotes en el subcampo 3, llovió de 10 a 11 y media…"). The app fills the structured log: quantities per schedule activity, crew, equipment, rain intervals and findings. Anything the model cannot match to a real activity code goes to a "could not place" list instead of being invented. | Muse Voice Transcribe (audio → text), Muse Spark with a JSON schema | Phone: *Parte diario → Dictar*. Web: *Asistente IA* |
| **Photo-verified progress.** Before approving a progress record, the resident clicks *Verify with AI*. SAM 3.1 counts the elements in the record's geotagged photos, for example driven piles, and draws them on the photo. Muse Spark checks that the photos show that activity at all. Records with no evidence, or with fewer elements than a small reported quantity, are flagged. | SAM 3.1, Muse Spark (vision) | Web: *Registros* |
| **Defect assistant.** A photo of a punch-list item or non-conformity comes back classified by type and severity, with a description and a corrective action. The defect area is marked on the image. The inspector reviews it before saving. | Muse Spark (vision), SAM 3.1 | Phone: *Nuevo hallazgo → Analizar la foto*. Web: *Asistente IA* |
| **Grounded executive summary.** The engine computes progress, SPI, projected finish, delay penalty and the saved "accelerate vs. pay" decision, and the model only writes the plain-language summary. A post-check extracts every number in the text and rejects any that is not in the engine's data: the model gets one retry, then the user sees a warning. | Muse Spark | Web: *Gerencia → Resumen IA* |

**How it is wired**
- One Supabase Edge Function, [`supabase/functions/ai-assist`](supabase/functions/ai-assist/index.ts), calls the Meta Model API (`https://api.meta.ai/v1`). The pure parts are in [`_shared/meta.ts`](supabase/functions/_shared/meta.ts): SSE/SAM output parsing, schemas, normalization, the verification rule and the number grounding check. They are covered by unit tests in [`supabase/tests/meta.test.ts`](supabase/tests/meta.test.ts).
- **Reads use the caller's session, so row-level security still applies:** a subcontractor's AI request only sees that subcontractor's data. Only the result is written with the service role, in `entry_ai_checks`, plus a per-user daily usage log (`ai_usage`).
- **Model output is never trusted blindly:**
  - activity codes are checked against the project;
  - quantities, hours and severities are validated;
  - the user always confirms before anything is saved.
- **Offline:** dictated text is kept in the local draft and is filled in when signal comes back. The structured log then syncs like any other record.

**What we learned testing with real images**
- SAM 3.1 needs the right concept words. On a public photo of a utility-scale PV site under construction, "metal post" found the 29 driven piles, while "steel pile" and "pile" found none. The activity → concept map is in `samConcept()` and can be overridden per activity (`activities.ai_count_prompt`).
- A single photo rarely shows a whole day of work, so the photo check only flags a gap when the reported quantity is small enough to fit in the frame. It is a help for the resident, not an automatic rejection.

## What it does / Qué hace

**Field (Android/iOS app, works offline)**
- Progress entry in 3 taps, with GPS-watermarked photos, QR codes and marking work on the site plan.
- Daily log (crew, equipment, rain).
- Quality: non-conformities, punch lists and inspections, with closing photos.
- Material deliveries, and "what's due today" from the committed weekly plan.
- AI: dictate the daily log, and analyze a defect photo (Meta models, see above).
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
| `packages/engine` | 96 |
| `packages/importers` | 35 |
| `packages/forms` | 34 |
| `apps/mobile` | 57 |
| `apps/web` (Playwright end-to-end) | 91 |
| `supabase` (functions, incl. Meta AI parsing and grounding) | 45 + database checks |

## Commands / Comandos

```
npm install
npm run verify                          # build, types, tests, functions, database and web e2e
npm run dev -w @avanceobra/web          # web at http://localhost:3100
```

Setup (Supabase, PowerSync, APK, alerts): [docs/PUESTA_EN_MARCHA.md](docs/PUESTA_EN_MARCHA.md). More detail is in [docs/PLAN.md](docs/PLAN.md), [docs/DECISIONES.md](docs/DECISIONES.md), [docs/PLAN_DE_PRUEBAS.md](docs/PLAN_DE_PRUEBAS.md) and [docs/HOJA_DE_RUTA.md](docs/HOJA_DE_RUTA.md).

Secrets are never committed: they live in `supabase/.secrets.local` (git-ignored) and in each service's dashboard.
