# Plan de pruebas · AvanceObra

Este plan define cómo se comprueba que AvanceObra funciona antes del piloto y durante él. Cubre la app de campo (Android/iOS), la web de administración, la base de datos (Supabase) y las alertas. Tiene tres capas:

1. **Pruebas automáticas.** Corren en el PC con un solo comando y deben pasar antes de cada versión.
2. **Pruebas manuales guiadas.** Son casos paso a paso para el equipo (supervisor, residente, director y administrador).
3. **Piloto en obra.** Cuatro semanas en el parque solar, con métricas de uso y de calidad del dato.

## 1. Pruebas automáticas

Se corren con:

```bash
npm run verify
```

El comando compila todo, revisa los tipos, corre las pruebas unitarias, las funciones de alertas y la validación de la base de datos. Si algo falla, la versión no sale.

| Componente | Pruebas | Qué cubre |
|---|---:|---|
| Motor de cálculo (`packages/engine`) | 63 | Calendario con festivos de Colombia, rendimiento real vs. referencia, equipos necesarios, saturación, CPM, **caso obligatorio del punto 16**, escenarios acelerar vs. multa, sensibilidad, Pareto, geometría del plano, curva S, semáforos, ponderación, seguimiento semanal y resumen del parte diario (lluvia sin doble conteo) |
| Formatos (`packages/forms`) | 34 | Esquema, fórmulas, lógica condicional, validación, versionado y plantillas |
| Importadores (`packages/importers`) | 14 | Excel, MS Project XML y Primavera XER; fechas y números en formato colombiano; duplicados, ciclos y comparación con la obra existente; exportación del avance a MS Project (ida y vuelta) y a Primavera P6 |
| App móvil (`apps/mobile`) | 39 | Envío de la cola a Supabase, reintentos, marca de agua en hora de Colombia, selección masiva en el plano (1.000 hincas), cuadre reportado vs. marcado, borrador automático, catálogo del admin, parte diario (horas de lluvia, validación, envío) |
| Alertas, informe diario y equipo (`supabase/tests`) | 22 | Destinatarios por tipo y rol, canal por severidad, mensajes, Telegram, push y correo simulados; cálculo del informe diario, mensaje, PDF (A4, paginado) y envío del PDF; validación al crear usuarios del equipo |
| Base de datos (`npm run db:check`) | 112 | Migraciones en PostgreSQL + PostGIS (PGlite), semilla demo, **RLS por rol**, aprobados inmutables, transiciones de hallazgos, conflictos, alertas programadas, formatos versionados, simulaciones inmutables, enlaces de solo lectura, datos del informe solo para el servicio, parte diario (solo inserción, vale el último), ensayos y restricciones por rol, equipo solo para el administrador y nunca sin administrador |
| Web de punta a punta (`npm run test:e2e`, Playwright) | 18 | Inicio de sesión, dashboard y fecha de corte, enlace compartido (válido e inválido), informe semanal con su Excel de 4 hojas, informe diario, simulador, importación de Primavera, exportación del avance a MS Project y P6, pesos del proyecto, ensayos y restricciones, equipo (crear persona, correo repetido, cambio de rol), contraseña temporal obligatoria y modo lectura del supervisor. Corre contra un Supabase simulado: sin cuentas reales ni datos en vivo |
| **Total** | **192 + 112** | |

### Reglas de seguridad que se prueban en cada corrida

- Un usuario sin membresía no ve nada del proyecto.
- El supervisor registra avance, pero no puede aprobar, ni borrar lo enviado, ni registrar a nombre de otro.
- Nadie modifica un registro aprobado (ni el residente): se corrige con un registro de ajuste.
- Las transiciones de hallazgos las valida la base de datos; solo el residente cierra.
- Las simulaciones guardadas no se modifican ni se borran: son el soporte de la decisión.
- Los contactos para alertas solo los lee la función de despacho.

### Qué no cubren las pruebas automáticas (se prueba a mano)

- La interfaz de la app móvil de punta a punta (la de la web sí: ver la tabla). La conexión real con Supabase la cubren la validación de la base y las pruebas manuales.
- La cámara, el GPS, el modo avión y la sincronización real con PowerSync.
- La impresión a PDF del informe diario y del simulador.
- iOS: el APK de Android está probado en teléfono real; falta la compilación de iOS.

## 2. Entornos y datos

| Entorno | Uso | Datos |
|---|---|---|
| PC local | Pruebas automáticas | PGlite en memoria; no toca la nube |
| Supabase + PowerSync (nube, plan gratis) | Pruebas manuales y piloto | Proyecto **Parque Solar Demo · Cesar**: 4 frentes, 11 actividades, 48 trackers, 384 pilotes, plano georreferenciado |
| Teléfono Android con el APK *preview* | Campo | Recibe actualizaciones OTA del canal `preview` |
| Web de administración | Dashboard, simulador, formatos, biblioteca, importación | `http://localhost:3100` (hasta que se despliegue) |

**Usuarios de prueba (uno por rol):** supervisor de campo, residente, director y administrador. Cada persona entra con su propia contraseña: nunca se comparten.

**Precaución:** lo que se guarda en la nube es real. Las simulaciones guardadas y los registros aprobados no se pueden borrar. Para pruebas destructivas, use nombres que empiecen por "Prueba".

## 3. Pruebas manuales

**Cómo se registran.** Cada caso tiene un código, el rol que lo ejecuta, los pasos y el resultado esperado. Se marca ✅ (pasa), ❌ (falla) u ⚠ (pasa con observación). Ante ❌, se reporta con el formato de la sección 5.

### 3.1 Campo sin señal (app móvil) · supervisor

| Código | Pasos | Resultado esperado |
|---|---|---|
| C-01 | Entrar con correo y contraseña | Barra verde "Sincronizado"; aparece el proyecto |
| C-02 | Plano → "Descargar mapa de la zona"; luego activar modo avión | El plano se sigue viendo sin señal |
| C-03 | En modo avión: Registrar → frente → actividad → cantidad → foto → Guardar. **Repetir 10 veces**, alternando actividades | Cada registro tarda menos de 60 s; la barra muestra "Sin conexión · N pendientes" |
| C-04 | Desactivar el modo avión | Los 10 registros suben en segundos; las fotos suben después; el contador baja a **0** |
| C-05 | Conexión intermitente: subir y bajar los datos móviles cada 20 s mientras se registran 5 avances | No se pierde ni se duplica ningún registro (revisar en el dashboard) |
| C-06 | La foto tiene marca de agua | Fecha y hora de Colombia, coordenadas, frente y usuario |
| C-07 | Escribir una cantidad, salir de la pantalla, cerrar la app y volver | El borrador se recupera con la cantidad y las fotos |
| C-08 | Marcar en el plano con un rectángulo sobre 20 pilotes y reportar 15 | Muestra "marcaste 20, reportaste 15: sobran 5"; deja guardar con advertencia |
| C-09 | Dibujar un área trabajada (polígono) | El área en m² coincide con la del dashboard web (±1 %) |
| C-10 | Escanear el QR de un tracker | Abre el registro de la actividad del elemento |
| C-11 | Registrar para "ayer" | El registro queda con la fecha de ayer |
| C-12 | Registrar → Parte diario, sin señal: contar personal y equipos, agregar una lluvia con "Empezó ahora" / "Paró ahora", enviar | Queda "Enviado a las HH:MM"; al reconectar sube; en el informe semanal aparece en Personal, Equipos y Lluvia |
| C-13 | Corregir el parte (cambiar una cantidad) y volver a enviar | El informe usa el último envío |

### 3.2 Hallazgos y alertas · supervisor, residente y director

| Código | Pasos | Resultado esperado |
|---|---|---|
| H-01 | Crear un hallazgo crítico con foto, sin señal | Notificación local inmediata; sube al reconectar |
| H-02 | Con señal, crear un hallazgo crítico | Llega por Telegram al residente, al director y al admin vinculados |
| H-03 | El supervisor intenta cerrar un hallazgo | No puede: solo el residente cierra |
| H-04 | Residente: Abierto → En corrección → Por revisar → Cerrado | Cada cambio queda en el historial |
| H-05 | Dos teléfonos sin señal cambian el mismo hallazgo y luego reconectan | Aparece el aviso de conflicto; no se pierde ningún cambio |
| H-06 | Dejar un frente sin reporte hasta la hora del job | Llega la alerta "frente sin reporte" |
| H-07 | Hallazgo con fecha límite vencida | Llega la alerta de vencido y sube al director si es crítico |
| H-08 | Esperar a las 6:00 p. m. de un día hábil (residente, director o admin con Telegram vinculado) | Llega el resumen del día y el PDF adjunto; en Supabase, `daily_report_deliveries` muestra "sent" |

### 3.3 Aprobación · residente

| Código | Pasos | Resultado esperado |
|---|---|---|
| A-01 | Pestaña Revisar → Aprobar un registro | Pasa a aprobado con el nombre del residente |
| A-02 | Intentar editar el registro aprobado | No se permite; se ofrece el registro de ajuste |
| A-03 | Rechazar un registro con motivo | El supervisor ve el motivo |

### 3.4 Web de administración · administrador y director

| Código | Pasos | Resultado esperado |
|---|---|---|
| W-01 | **Dashboard:** abrir con la fecha de hoy | Indicadores, curva S, semáforos, Pareto, pendientes y plano cargan en menos de 5 s |
| W-02 | Cambiar la fecha de corte a hace 2 semanas | Todos los indicadores se recalculan a esa fecha |
| W-03 | Plano → "Reproducir avance" | El plano se colorea día a día hasta hoy |
| W-04 | Pareto: cambiar a costo de recursos parados y a hallazgos por tipo | El orden y la línea del 80 % cambian; la tabla coincide con la gráfica |
| W-05 | **Informe diario** → Imprimir / Guardar PDF | El PDF sale en A4, sin menús, con fotos del día y espacio para firmas |
| W-06 | **Simulador:** revisar los 4 escenarios | La recomendación coincide con el escenario de menor costo total |
| W-07 | Simulador: cambiar la multa diaria y la productividad del 2.º turno | La curva y la recomendación se actualizan al instante |
| W-08 | Guardar una simulación ("Prueba …") | Aparece en el historial; no se puede editar ni borrar |
| W-09 | Exportar Excel del simulador | El archivo abre con las hojas Escenarios, Supuestos, Curva y Sensibilidad |
| W-10 | **Formatos:** crear un campo condicional, publicar | El formato llega al teléfono tras sincronizar y aplica la condición |
| W-11 | **Biblioteca:** cambiar el costo de un equipo | El simulador usa el nuevo costo |
| W-12 | **Importar:** descargar la plantilla, cambiar una fecha y volver a subirla | La vista previa muestra solo ese cambio; al importar, el semáforo lo refleja |
| W-13 | Importar un .xml de MS Project real de la empresa | Los frentes se reconocen por nombre; se completan unidad y cantidad; no se borra nada |
| W-14 | Importar un .xer de Primavera real | Igual a W-13; los hitos se omiten con aviso |
| W-21 | Programación → Exportar a MS Project y abrir el .xml en MS Project (combinar con el cronograma) | % completado, comienzo y fin reales por actividad; las importadas de MS Project se emparejan por UID |
| W-23 | Equipo: crear una persona con contraseña temporal, enviarle el mensaje; ella entra a la web, cambia la contraseña y vincula Telegram desde la app | Aparece con su rol; tras vincular, la columna Telegram pasa a "Vinculado" y le llegan las alertas |
| W-22 | Programación → Exportar a Primavera P6 e importar la hoja en P6 («Actualizar existentes») | Estado, % físico y fechas reales actualizados por ID de actividad |
| W-15 | Entrar a la web con un usuario que no es admin | Modo lectura: no puede importar ni editar formatos |
| W-16 | Dashboard → Compartir → crear enlace de 7 días y abrirlo en otro navegador sin sesión | Se ve el dashboard en solo lectura, sin costos ni menú; el contador de visitas sube |
| W-17 | Revocar ese enlace y recargarlo | "Este enlace no es válido, venció o fue revocado" |
| W-18 | Proyecto: llenar la cabecera (cliente, contrato, código), desactivar festivos y poner pesos que sumen 100 % | Guarda; con pesos que no suman 100 % no deja guardar |
| W-20 | Ensayos y restricciones: registrar un ensayo, cambiar su estado a "Enviado", crear y liberar una restricción | Aparecen en el informe semanal (ensayos en su tabla; restricción abierta en alertas, liberada en su sección) |
| W-19 | Informe semanal → semana en curso → Exportar Excel | Abre con las hojas REPORTE SEMANAL, EJECUTADO, % y SEGUIMIENTO SEMANAL; el avance ponderado coincide con el de la pantalla |

### 3.5 Motor de cálculo con datos reales · director

| Código | Pasos | Resultado esperado |
|---|---|---|
| M-01 | Cargar en la biblioteca los costos reales de alquiler, operador, combustible y movilización (hoy son **estimados**) | El simulador deja de mostrar supuestos estimados |
| M-02 | Comparar la recomendación del simulador con el criterio del director en una decisión real | Se registra si coinciden y, si no, por qué |
| M-03 | Revisar el caso del punto 16 (`npm run caso16 -w @avanceobra/engine`) | 750 m³/día requeridos, 816 de referencia, aviso de que el limitante no son las excavadoras |

## 4. Pruebas no funcionales

| Tipo | Prueba | Meta |
|---|---|---|
| Rendimiento en campo | Tiempo de un registro completo con foto | < 60 s; mediana < 30 s |
| Offline | Días sin señal que el teléfono aguanta sin perder datos | ≥ 3 días y 200 registros con foto |
| Almacenamiento | Espacio que ocupan las fotos pendientes | ~300 KB por foto (1600 px, JPEG 0,7) |
| Batería | Jornada de 10 h con GPS al registrar (sin rastreo continuo) | < 15 % de consumo atribuible a la app |
| Sincronización | Tiempo desde que hay señal hasta "Sincronizado" con 50 pendientes | < 1 min (sin contar las fotos) |
| Escala | Dashboard con 300 usuarios y 50.000 registros (datos sintéticos) | Carga < 5 s; si no, se agregan vistas resumidas en la base |
| Seguridad | Revisión de RLS con un usuario de otra empresa | No ve nada (prueba automática + manual) |
| Secretos | Ningún token en git ni en el código | `git grep` limpio antes de cada commit |
| Accesibilidad | Gráficas con leyenda y tabla; semáforo con forma además de color | Legible en blanco y negro y con daltonismo |

## 5. Reporte de defectos

Cada falla se reporta con:

- código del caso (p. ej. C-05);
- rol, teléfono o navegador, y versión de la app (Sincronía → actualización);
- pasos exactos, resultado esperado y resultado obtenido;
- foto o captura de pantalla.

| Severidad | Definición | Tiempo de respuesta |
|---|---|---|
| Crítica | Se pierde un dato, alguien ve datos que no le corresponden o la app no abre | Arreglo inmediato (OTA el mismo día) |
| Alta | Un flujo principal no se puede completar (registrar, aprobar, sincronizar) | ≤ 2 días |
| Media | Funciona con un rodeo o un cálculo sale mal en un caso poco común | Siguiente versión |
| Baja | Texto, presentación o comodidad | Se agrupa |

## 6. Criterios para empezar el piloto

- `npm run verify` en verde.
- Todos los casos C, H y A en ✅ en al menos dos teléfonos Android (uno de gama baja).
- Casos W-01 a W-12 en ✅.
- Cero defectos críticos o altos abiertos.
- Tokens rotados y web desplegada (ver hoja de ruta, "Antes del piloto").

## 7. Piloto en obra (4 semanas)

| Semana | Foco | Qué se mide |
|---|---|---|
| 1 | Un frente, 2 supervisores, acompañamiento diario | Registros por día, tiempo por registro, dudas de uso |
| 2 | Todos los frentes; el residente aprueba a diario | % de registros aprobados en 24 h; hallazgos con foto |
| 3 | El director usa el dashboard y el informe diario en la reunión de obra | Decisiones tomadas con el dashboard; diferencias con el reporte manual |
| 4 | Simulador con costos reales en una decisión de aceleración | Recomendación vs. decisión final y su justificación |

**Metas del piloto:**

- ≥ 95 % de los días con reporte en todos los frentes activos;
- 0 registros perdidos;
- diferencia < 2 % entre el avance de la app y la medición topográfica de cierre de mes;
- los supervisores califican la captura con 4 de 5 o más.

**Cierre del piloto:** un informe con las métricas, los defectos encontrados y los ajustes que pasan a la hoja de ruta.
