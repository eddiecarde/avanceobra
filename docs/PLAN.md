# AvanceObra — Plan de construcción por etapas

## Contexto
La carpeta del proyecto está vacía, así que es un proyecto nuevo. El objetivo es una app offline-first para registrar el avance de obra en campo en menos de 60 s, y un dashboard con análisis económico para decidir entre "acelerar o pagar la multa".
Decisiones del usuario (punto 1):
- **Escala:** mediana, de 50 a 300 usuarios, **Android + iOS** desde el inicio.
- **Backend:** **Supabase gestionado** (PostgreSQL, Auth, Storage, RLS y Edge Functions).
- **Obra inicial:** **solar fotovoltaica** (hincado de pilotes, montaje de trackers, cableado DC/AC, zanjas). El caso del punto 16, que es de movimiento de tierras, se incluye igualmente como prueba obligatoria del motor.
- **Integraciones del MVP:** importar desde **Excel**, **MS Project (XML) / Primavera (XER)** y alertas por **WhatsApp/Telegram**. El asistente de IA queda para una fase posterior.

## Stack (y por qué)
- **Móvil: Expo (SDK actual) + React Native + TypeScript, con Expo Router y EAS Build.** Un solo código para Android e iOS, y actualizaciones OTA para corregir en campo sin pasar por la tienda.
- **Base local y sincronización: PowerSync + SQLite (op-sqlite).** Es la mejor opción offline-first con Supabase:
  - replica Postgres → SQLite de forma parcial ("sync rules" por proyecto y usuario);
  - lleva una cola de subida persistente con reintentos;
  - es compatible con RLS.
  - Se descarta WatermelonDB porque exige construir el backend de sincronización a mano, y RxDB porque su integración con Postgres es más débil.
- **Backend: Supabase.**
  - Postgres con RLS multiempresa por `org_id`.
  - Storage para las fotos.
  - Edge Functions para alertas, PDF, importadores y webhooks de WhatsApp/Telegram.
  - `pg_cron` para las alertas programadas: frente sin reporte, pendientes vencidos y datos sin sincronizar.
- **Web: Next.js (App Router) + Tailwind + Recharts + MapLibre GL.**
- **Mapas móviles: MapLibre React Native** con packs offline por zona (bbox del proyecto).
- **Notificaciones:**
  - Expo Notifications, tanto locales al guardar como push remotas;
  - correo con Resend;
  - WhatsApp Cloud API y Telegram Bot API.
- **Motor de cálculo:** paquete TS puro `@avanceobra/engine`, sin dependencias de UI, probado con Vitest. Lo usan igual el móvil (offline) y la web.
- **Monorepo: pnpm + Turborepo.** Comparte tipos, esquemas Zod, motor y definiciones de formatos.

## Estructura de carpetas
```
avanceobra/
  apps/
    mobile/          Expo: app/(auth)/(tabs)/registro|hallazgos|pendientes|sync, components/, db/powersync/, services/{gps,photos,watermark,qr,alerts}
    web/             Next.js: app/(dashboard)/proyectos/[id]/{curva-s,mapa,simulador,reportes}, app/admin/{formatos,recursos,usuarios}
  packages/
    engine/          src/{productivity,equipment,projection,cpm,costs,breakeven,sensitivity,calendar}.ts + __tests__/
    shared/          zod schemas, tipos de dominio, i18n (es por defecto)
    forms/           esquema JSON de formatos, render-agnóstico, validador, fórmulas, lógica condicional
    importers/       excel (SheetJS), msproject-xml, primavera-xer
    templates/       plantillas precargadas (solar primero + tierras, concreto, SST, QA/QC)
  supabase/
    migrations/      esquema + RLS + triggers de auditoría
    functions/       alerts-dispatch, daily-report-pdf, import-schedule, notify-whatsapp, notify-telegram
    seed.sql
  docs/              arquitectura, decisiones (ADR), plan de pruebas
```

## Arquitectura (resumen)
**Móvil**

UI → repositorio local (SQLite/PowerSync) → cola de subida → Supabase.
1. Las alertas se evalúan **localmente al guardar** con las reglas del motor. Se muestran como notificación local y se encolan en `alert_outbox`, que se envía en cuanto hay señal.
2. Las fotos se comprimen a unos 1600 px / JPEG 0.7 y se les pone la marca de agua con fecha, hora y GPS. Se guardan en el FileSystem y se encolan en `photo_upload_queue`, con backoff exponencial y subida reanudable.
3. Un indicador global de sincronización muestra el estado de PowerSync y el contador de registros pendientes.

**Servidor**
- Triggers y Edge Functions despachan las alertas por push, correo, WhatsApp y Telegram.
- `pg_cron` genera las alertas temporales y el resumen diario.

## Modelo de datos (tablas principales)
- **Organización y acceso:**
  - `organizations` (contratista y subcontratistas)
  - `users` / `memberships` (rol por proyecto: field, resident, director, admin)
- **Estructura de obra:**
  - `projects` (moneda, calendario, festivos, bbox del mapa)
  - `fronts` → `activities` (unidad, cantidad contractual, predecesoras, programado) → `elements` (código QR, tipo: tracker, pilote, tramo…)
- **Formatos:**
  - `form_templates`
  - `form_template_versions` (JSON inmutable; cada registro guarda `template_version_id`)
- **Avance:**
  - `progress_entries`
    - campos base: cantidad, horas, clima, causa de pérdida, GPS, `device_id`, `client_created_at`, `values` JSON del formato
    - estado: borrador → enviado → aprobado / rechazado
    - firma
  - `entry_resources` (personal y equipos usados)
  - `photos`, `voice_notes`
- **Hallazgos:**
  - `findings` (tipo, severidad, responsable, fecha límite, estado Abierto → En corrección → Por revisar → Cerrado)
  - `finding_events`
- **Rendimientos y costos:**
  - `resource_catalog` (rendimiento de referencia, factores)
  - `cost_items` (hora o día de máquina, operador, combustible, movilización, mínimo de alquiler, recargos)
- **Contrato y decisiones:**
  - `contracts` (multa diaria o en %, tope, fecha contractual, bonos, indirectos diarios, causales reclamables)
  - `simulations` (snapshot inmutable de supuestos, resultados y escenario elegido)
- **Auditoría y alertas:**
  - `audit_log`, mantenido por trigger
  - `alerts`, `alert_outbox`, `notification_channels`

**Política de sincronización y conflictos**
- **Claves:** UUID v7 generados en el dispositivo.
- **Registros de avance:** son *append-only*. Varios usuarios de una misma cuadrilla crean filas distintas y la fusión es una suma, así que no hay conflicto.
- **Entidades editables** (hallazgos, catálogos): se aplica "última modificación gana" con `updated_at` y `version`. Si la versión del servidor cambió desde la última lectura y difieren campos sensibles (estado, cantidad), se marca `conflict` y se avisa al usuario para que resuelva.
- **Registros aprobados:** RLS y un trigger impiden UPDATE y DELETE. Solo admiten correcciones mediante un registro de ajuste.

## Motor de cálculo (`packages/engine`)
- **Rendimiento efectivo por unidad** = ref × horas × disponibilidad × factores (clima, suelo, curva de aprendizaje, turnos).
- **Rendimiento real** = histórico ponderado de los últimos N días. Si hay menos de 7 registros, se marca "pocos datos".
- **Calendario:** días laborables entre fechas, descontando festivos de Colombia y la lluvia estimada.
- **Equipos requeridos:**
  - requerido/día = pendiente ÷ días disponibles;
  - unidades = ⌈requerido ÷ rend. unidad⌉;
  - además: brecha frente a lo actual, saturación (máximo por frente y rendimientos decrecientes) y recurso limitante de la cadena (min de throughput).
- **Proyección:**
  - escenarios optimista, esperado y pesimista;
  - CPM sobre las actividades para obtener la ruta crítica.
- **Costos por escenario:**
  - aceleración directa, sumando inspección y reproceso;
  - multa = min(días × multa diaria, tope);
  - indirectos y bonos;
  - total y delta frente al escenario base.
- **Punto de equilibrio:** se itera el número de recursos o turnos adicionales para construir la curva costo total vs. días de retraso y tomar su mínimo. A partir de ahí se genera la recomendación en texto.
- **Sensibilidad:** rendimiento −10 %, más lluvia, alquiler +X %, multa distinta.

### Caso obligatorio (punto 16) — se implementa como test
Datos: 30.000 m³ pendientes, 40 días, 3 excavadoras de 120 m³/h, 8 h efectivas, 85 % de disponibilidad, multa de $5.000.000/día y 20 días de retraso proyectado.

1. **Rendimiento requerido:** 30.000 ÷ 40 = **750 m³/día**.
2. **Rendimiento de referencia por excavadora:** 120 × 8 × 0,85 = **816 m³/día**. Con 3 excavadoras son 2.448 m³/día, y terminarían en unos 12,3 días.
3. **Inconsistencia detectada:** los 20 días de retraso implican un ritmo real de 30.000 ÷ 60 = **500 m³/día**, es decir, 166,7 m³/día por excavadora (20 % de la referencia).
   - El motor debe **advertir que el recurso limitante no son las excavadoras**: lo probable son las volquetas o el acarreo, la compactación o los permisos.
   - Por eso el análisis de cuellos de botella va antes de comprar más excavadoras.
4. **Equipos necesarios:**
   - con la referencia: ⌈750 ÷ 816⌉ = 1, así que sobran equipos;
   - con el ritmo real: ⌈750 ÷ 166,7⌉ = **5 excavadoras (+2)**, o reforzar el recurso limitante.
5. **Multa base:** 20 × $5.000.000 = **$100.000.000**, sujeta al tope.
6. **Costo de aceleración y punto de equilibrio:** se calculan con los costos editables de alquiler, operador, combustible y movilización, más los indirectos diarios. El test usa supuestos explícitos marcados como "estimados", que el usuario debe validar.
7. **Recomendación:** el texto se genera a partir del mínimo de la curva.

## Plano georreferenciado con avance marcado en campo (solicitado)
**Carga del plano.** El administrador sube el plano en la web, en uno de estos formatos:
- **PDF o imagen** (PNG/JPG): se georreferencia con 3 o 4 puntos de control. El usuario pulsa sobre el plano y sobre el mapa satelital, y se calcula una transformación afín. Se guardan las 4 esquinas.
- **GeoTIFF / KML / GeoJSON:** se leen directamente.
- **DXF del layout solar:** se importan las geometrías de trackers, mesas e hincas como `elements` con su polígono o punto.

**Uso en campo, offline.**
1. El plano se descarga al dispositivo junto con el paquete de mapas de la zona.
2. Se muestra en MapLibre como `ImageSource` sobre el satélite cacheado.
3. Se ve la posición GPS del supervisor sobre el plano.

**Marcado del avance.** Dentro del registro, en el mismo flujo de 3 toques, el supervisor tiene dos opciones:
- **Dibujar el área trabajada aproximada**, sea un polígono a mano alzada o un rectángulo. Se calcula el área en m² y se propone la cantidad del día cuando la unidad es de área.
- **Tocar los elementos** (trackers, pilotes) para marcarlos como ejecutados. Funciona con selección múltiple por arrastre, y la cantidad se cuenta sola.

El área o los elementos quedan ligados al `progress_entry`, se guardan localmente y se sincronizan como cualquier otro dato.

**Visualización en móvil y web.** El plano se colorea por estado:
- sin iniciar: gris;
- en proceso: amarillo;
- terminado: verde;
- con hallazgo abierto: borde rojo.

Además hay un filtro por actividad y por rango de fechas, que permite "reproducir" el avance por día.

**Datos nuevos:**
- `site_plans` (archivo, versión, esquinas o transformación, proyecto/frente, tamaño de caché);
- `elements.geom` (geometría PostGIS);
- `progress_areas` (`entry_id`, geometría, área calculada, `is_approximate`).

Se usa PostGIS en Supabase. Localmente, las geometrías se guardan como GeoJSON en SQLite y el área se calcula con Turf.js.

**Conflictos:** las áreas son *append-only*. Si dos áreas se solapan, se unen en la vista (`ST_Union`) sin perder ninguno de los registros.

## Análisis de Pareto de causas (solicitado)
**Fuentes.** El Pareto se arma con dos fuentes:
- las causas de pérdida de tiempo de `progress_entries`: clima, material, equipo, permisos, personal, diseño/cliente, otra;
- las categorías de hallazgos.

**Métrica seleccionable:**
- horas perdidas;
- cantidad no ejecutada estimada (horas perdidas × rendimiento);
- costo estimado (horas × costo hora de los recursos parados);
- número de eventos.

**Gráfica.** Barras ordenadas de mayor a menor, con línea acumulada y la marca del 80 %. Tiene filtros por proyecto, frente, actividad, cuadrilla/subcontratista y periodo.

**Uso:**
- en el dashboard web y en el móvil del director;
- en el informe diario y el semanal, con el top 3 de causas;
- en la exportación a Excel.

**Enlaces con otros módulos:**
- Las causas imputables al cliente o a fuerza mayor (lluvia, cambios, permisos del cliente) se suman como **días reclamables** en el análisis de multa.
- El asistente de IA (fase posterior) usará el Pareto para sugerir causas de desviación.
- El motor incluye la función `pareto()` en `engine/src/pareto.ts`, con pruebas.

## Etapas de entrega (en este orden; cada una con explicación de decisiones)
1. **Fundaciones:**
   - monorepo, Supabase (migraciones + RLS + seed solar);
   - login (email/OTP);
   - proyectos, frentes, actividades y elementos;
   - importadores de Excel, MS Project XML y Primavera XER.
2. **Campo offline:**
   - PowerSync, registro de avance en 3 toques;
   - plano georreferenciado offline con marcado de área o elementos trabajados;
   - fotos con marca de agua, GPS, QR, plantillas y valores recientes;
   - firma, aprobación del residente;
   - indicador de sincronización y auditoría.
3. **Hallazgos y alertas:**
   - estados y lista de pendientes con filtros;
   - alertas locales y push;
   - correo, WhatsApp y Telegram;
   - jobs de `pg_cron`.
4. **Formatos y biblioteca:**
   - constructor arrastrar y soltar en la web (dnd-kit), con renderizador compartido;
   - versionado, importar/exportar en JSON y Excel;
   - catálogo de rendimientos y costos editable.
5. **Motor de cálculo:** con pruebas unitarias, incluido el caso del punto 16.
6. **Simulador de escenarios** (web y móvil):
   - 4 escenarios lado a lado y gráfica costo vs. retraso;
   - sensibilidad;
   - guardado de simulaciones y exportación a PDF y Excel.
7. **Dashboard web:**
   - curva S, semáforos, mapa;
   - plano coloreado por avance, con reproducción por fecha;
   - Pareto de causas con línea del 80 %;
   - top de pendientes, comparativo de cuadrillas;
   - resumen diario;
   - informe diario en PDF;
   - enlace de solo lectura.
8. **Plan de pruebas y hoja de ruta:**
   - extras: materiales, SST, asistente de IA, multiidioma.

## Verificación
- `pnpm -F engine test` debe pasar, incluido el caso del punto 16 con los valores de arriba.
- `supabase db reset` y luego tests de RLS (pgTAP): un usuario no ve otra organización y un registro aprobado no se puede borrar.
- App en un emulador Android:
  - en modo avión: registrar 10 avances con foto; al reconectar, se sincronizan y el contador baja a 0;
  - con conexión intermitente: mismo resultado;
  - con conflicto simulado (dos dispositivos editan el mismo hallazgo): aparece el aviso.
- Plano en modo avión: el plano se ve, se dibuja un área, el área calculada coincide con Turf y, tras sincronizar, el plano web la muestra coloreada.
- Pareto: test unitario con causas conocidas (orden, % acumulado, corte en el 80 %).
- Web: el simulador muestra la curva con el mínimo marcado y el PDF del informe diario se genera.
