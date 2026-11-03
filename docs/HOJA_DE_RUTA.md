# Hoja de ruta · AvanceObra

Estado al 21 de octubre de 2026. Las 8 etapas del plan inicial están construidas y probadas (ver [PLAN_DE_PRUEBAS.md](PLAN_DE_PRUEBAS.md)). Esta hoja ordena lo que falta, en cuatro bloques:

1. Lo que **bloquea el piloto**.
2. Lo que se hace **durante el piloto**.
3. La **versión 1.1**, que endurece lo existente.
4. Los **módulos nuevos** de la versión 2: materiales, SST, asistente de IA y multiidioma.

## Lo construido

| Etapa | Entregado |
|---|---|
| 1. Fundaciones | Monorepo, Supabase con RLS por empresa y rol, auditoría, semilla del parque solar |
| 2. Campo offline | App Expo (Android/iOS) con PowerSync: registro en 3 toques, fotos con marca de agua, GPS, QR, plano georreferenciado con selección masiva, borrador automático, aprobación |
| 3. Hallazgos y alertas | Ciclo de hallazgos validado en la base, alertas programadas, Telegram (en uso), push y correo listos para activar |
| 4. Formatos y biblioteca | Constructor arrastrar y soltar con lógica condicional y versiones; biblioteca de rendimientos y costos |
| 5. Motor de cálculo | Rendimientos, equipos, saturación, CPM, Pareto, caso del punto 16 |
| 6. Simulador | Acelerar vs. multa: 4 escenarios, curva de costo, sensibilidad, decisión guardada e inmutable, Excel y PDF |
| 7. Dashboard | Curva S, semáforos, Pareto, pendientes, plano coloreado con reproducción, informe diario en PDF |
| 8. Importadores | Excel, MS Project y Primavera P6, con vista previa y sin borrar nada |
| 1.1 · Avance real al cronograma | Exporta a MS Project (XML con % completado y fechas reales, conserva los UID) y a Primavera P6 (hoja para «Actualizar existentes») |
| 1.1 · Pruebas de punta a punta de la web | 13 pruebas con Playwright contra un Supabase simulado, dentro de `npm run verify` |
| 1.1 · Parte diario, ensayos y restricciones | Parte diario en el teléfono sin señal (personal por cargo, equipos, lluvia con hora de inicio y fin); ensayos de laboratorio y restricciones en la web; todo entra al informe semanal y su Excel |
| 1.1 · Informe semanal del cliente | Formato CNX-PSS-001 (Helios) en pantalla, impresión y Excel con sus 4 hojas; ponderación por actividad, calendario configurable y cabecera del contrato |
| 1.1 · Informe diario automático | Resumen y PDF por Telegram a las 6 p. m. (lunes a sábado) a residente, director y admin; sin reenvíos duplicados |
| 1.1 · Enlace de solo lectura | Dashboard para cliente o interventoría sin usuario: vence, se revoca, cuenta visitas y no expone costos, notas, fotos ni nombres |

## Antes del piloto (bloqueante)

| # | Tarea | Quién | Por qué |
|---|---|---|---|
| ~~P1~~ | ✅ Hecho el 22/10/2026: token de Supabase revocado y reemplazado; token del bot rotado, con el secreto de las funciones y el webhook actualizados | Eddie + Claude | Se habían compartido en el chat durante la configuración |
| ~~P2~~ | ✅ Hecho el 22/10/2026: borrado del editor SQL el fragmento con la contraseña de `powersync_role` | Eddie | Quedaba en el historial del editor SQL |
| P3 | ✅ Web publicada en https://avanceobra-six.vercel.app. Opcional: dominio propio (p. ej. avanceobra.tuempresa.co) | Eddie + Claude | Para usarla fuera del PC |
| P4 | Compilar e instalar la app de iOS (EAS + cuenta Apple Developer) | Eddie | Solo está probado Android |
| P5 | Reemplazar los costos estimados de la biblioteca por los reales | Director | El simulador decide con esos números |
| P6 | Crear los usuarios reales con su rol (web → **Equipo**) y que cada uno vincule Telegram desde la app | Admin | Las alertas llegan solo a quien está vinculado |
| P7 | Importar la programación real (MS Project o Primavera) y el plano del proyecto | Admin | Los semáforos y la curva S dependen de las fechas programadas |
| P8 | Activar las copias de seguridad diarias de Supabase (plan Pro) | Eddie | El plan gratis no garantiza la recuperación a un punto en el tiempo |

## Durante el piloto (4 semanas)

- Ejecutar el plan de pruebas manual y el piloto por semanas ([PLAN_DE_PRUEBAS.md](PLAN_DE_PRUEBAS.md), secciones 3 y 7).
- Corregir por OTA los defectos de la app, sin reinstalar.
- Revisión semanal con supervisores: qué campos sobran o faltan en los formatos.
- Medir contra las metas: ≥ 95 % de días con reporte, 0 registros perdidos y < 2 % de diferencia con la topografía.

## Versión 1.1: endurecer lo existente

| Prioridad | Mejora | Valor |
|---|---|---|
| Media | Informe diario también por correo (hoy solo Telegram) | Para quien no usa Telegram |
| Media | Pruebas de punta a punta de la app móvil (Maestro en un emulador) | Las de la web ya corren en `npm run verify` |
| Media | Push en el teléfono con Firebase (Android) y APNs (iOS) | Alertas sin depender de Telegram |
| Media | WhatsApp Cloud API como canal de alertas | Es el canal más usado en obra; requiere plantillas aprobadas por Meta |
| Media | Vistas resumidas en la base para el dashboard (curva S y semáforos precalculados) | Mantener < 5 s con 50.000+ registros |
| Media | Ensayos y restricciones también desde el teléfono (hoy se registran en la web) | El residente los anota en campo |
| Baja | Simulador en el móvil para el director | Decidir en obra sin PC |
| Baja | Cronograma tipo Gantt en la web con la ruta crítica resaltada | Lectura más rápida que la tabla de semáforos |

## Versión 2: módulos nuevos

### Materiales

- Inventario por frente: entradas, salidas y consumo por actividad, por ejemplo módulos, pilotes, cable y concreto.
- Alerta de faltante cuando el consumo previsto (por rendimiento) supera el stock más las entregas programadas.
- La causa de pérdida "Material" del Pareto se enlaza con el pedido que llegó tarde.

### SST (seguridad y salud en el trabajo)

- Formatos precargados:
  - charla diaria;
  - permiso de trabajo en alturas o en caliente;
  - inspección preoperacional de equipos;
  - ATS (análisis de trabajo seguro).
  - Se arman con el constructor de formatos existente.
- Bloqueo suave: no se registra avance de una actividad de alto riesgo sin el permiso del día.
- Indicadores: horas hombre trabajadas, incidentes, días sin accidentes y hallazgos SST por tipo.

### Asistente de IA

- Integración con la API de Claude en una Edge Function. Los datos salen del proyecto solo con autorización de la empresa.
- Funciones:
  - **resumen del día** en lenguaje natural para el informe;
  - **explicación de desviaciones**, a partir del Pareto, el clima y las notas de campo;
  - **preguntas libres**, por ejemplo "¿por qué va atrasado el Bloque B?" o "¿cuánto cuesta terminar a tiempo?".
- Al responder, usa el motor de cálculo como herramienta, en lugar de "inventar" números.
- Sugerencia de la causa de pérdida a partir de la nota de voz del supervisor.

### Multiidioma

- Textos de la app y de la web en archivos de traducción. El español es el idioma base; se agrega el inglés para clientes e interventorías extranjeras.
- Formatos de número, fecha y moneda según el idioma y el país del proyecto.

### Otros tipos de obra

- Plantillas de actividades, formatos y rendimientos para obra vial, edificaciones y redes. El motor ya es independiente del tipo de obra.
- Elementos del plano por tipo: ejes, losas y tramos (ya existen en el modelo de datos).

## Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Los supervisores no adoptan la app | Captura en < 60 s, valores recientes, acompañamiento en la semana 1 del piloto |
| Datos de avance inflados o duplicados | Cuadre contra el plano, aviso de registro repetido, aprobación del residente y foto con GPS |
| Costos estimados llevan a una mala decisión | El simulador marca los supuestos, muestra la sensibilidad y guarda quién decidió y por qué |
| Límite del plan gratis de Supabase o PowerSync | Pasar a planes pagos antes de 50 usuarios activos (costo mensual a validar) |
| Dependencia de una sola persona técnica | Documentación ([PLAN.md](PLAN.md), [DECISIONES.md](DECISIONES.md), [PUESTA_EN_MARCHA.md](PUESTA_EN_MARCHA.md)), pruebas automáticas y git |
