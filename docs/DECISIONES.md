# Decisiones técnicas (ADR resumidas)

| # | Decisión | Por qué |
|---|----------|---------|
| 1 | **npm workspaces + Turborepo** (en vez de pnpm) | pnpm no estaba instalado; npm 11 ya trae workspaces y no hay que tocar herramientas globales. Se puede migrar a pnpm sin cambiar código. |
| 2 | **Motor de cálculo como paquete TS puro** (`@avanceobra/engine`) | Sin dependencias de UI ni de red: corre igual offline en el móvil, en la web y en Edge Functions. Probado con Vitest. |
| 3 | **PowerSync + SQLite** para offline-first | Sincroniza Postgres (Supabase) ↔ SQLite con cola persistente y reglas de sincronización parcial; evita construir un backend de sync propio (WatermelonDB) o integraciones débiles con Postgres (RxDB). |
| 4 | **UUID generados en el dispositivo** | Un registro creado sin señal ya tiene identidad definitiva; no hay remapeo de IDs al sincronizar. |
| 5 | **Registros de avance append-only** | Varios usuarios en el mismo frente ("cuadrilla compartida") crean filas distintas y la fusión es una suma: no hay conflictos. Los aprobados son inmutables por trigger; se corrigen con registros de ajuste. |
| 6 | **Hallazgos con versión + última modificación gana** | Conflicto real (estado o cantidad distintos sobre la misma versión) se marca y se muestra al usuario. |
| 7 | **Transiciones de hallazgos validadas en la BD** | Abierto → En corrección → Por revisar → Cerrado; solo el residente cierra. La regla no depende del cliente. |
| 8 | **PostGIS + plano con transformación afín** | El plano (PDF/imagen) se georreferencia con 3–4 puntos de control y se dibuja en MapLibre como ImageSource; las áreas trabajadas se guardan como polígonos (área calculada en servidor con `geography`, y en el móvil con la misma fórmula de Turf). |
| 9 | **Costos de los equipos actuales incluidos en la decisión** | Acelerar acorta la duración y también reduce lo que se paga por los equipos ya alquilados; ignorarlo sesga la decisión hacia la multa. Configurable (`includeCurrentUnitsCost`). |
| 10 | **Saturación del frente explícita** | Sin rendimientos decrecientes, agregar máquinas siempre parece rentable. Se modela con unidades a plena eficiencia, factor de decaimiento y máximo físico. |
| 11 | **Contraste real vs. referencia en la recomendación** | Si el rendimiento real es < 60 % de la referencia, el limitante suele ser otro recurso; la recomendación lo advierte antes de sugerir movilizar equipos. |
| 12 | **Festivos de Colombia calculados** (Ley Emiliani + Pascua) | Los días disponibles no dependen de una tabla que hay que actualizar cada año. |

## Etapa 2 · App móvil

| # | Decisión | Por qué |
|---|----------|---------|
| 13 | **Expo SDK 57 + development build** | Un código para Android e iOS; SQLite, MapLibre y Skia son nativos, así que no sirve Expo Go. EAS compila en la nube sin Android Studio. |
| 14 | **Cola de archivos separada de la cola de datos** | Los registros (KB) suben primero por PowerSync; las fotos (cientos de KB) van después con backoff propio. Una foto atascada no frena el avance del día. |
| 15 | **Ruta local de la foto derivada del id** | PowerSync reemplaza la fila con la versión del servidor al sincronizar; una columna local se perdería. `documents/photos/{id}.jpg` no depende de eso. |
| 16 | **Errores permanentes apartados a `upload_errors`** | Un registro rechazado por RLS o por estar aprobado no puede bloquear toda la cola de un dispositivo sin señal por días. |
| 17 | **Conflictos de hallazgos por RPC con `base_version`** | El servidor compara la versión que vio el usuario con la actual y solo marca conflicto si otro usuario cambió campos sensibles; dos ediciones offline del mismo usuario no son conflicto. |
| 18 | **`project_id` desnormalizado en tablas hijas** | Las reglas de PowerSync no admiten subconsultas; así cada dispositivo descarga solo sus proyectos. |
| 19 | **Marca de agua con Skia, offline** | Se dibuja sobre la imagen en el teléfono (fecha/hora de Colombia, coordenadas, frente, usuario); si falla por memoria se conserva la foto sin marca para no perder evidencia. |
| 20 | **Plano como ImageSource con 4 esquinas** | El plano (PDF convertido a imagen) se superpone al mapa sin servidor de tiles; el móvil lo descarga una vez y funciona sin señal. |
| 21 | **Marcar en plano apilado sobre la captura** | Abrir el plano como pestaña desmontaría la captura y se perdería lo escrito; se abre como pantalla apilada y comparte un borrador en memoria. |

## Mejoras de campo (retroalimentación de Marta) y etapa 3

| # | Decisión | Por qué |
|---|----------|---------|
| 22 | **Selección masiva por rectángulo o polígono** (agregar / quitar) | Con 1.000 hincas no es viable tocarlas una a una. Se usa el centroide de cada elemento y se omiten los ya ejecutados para no reportarlos dos veces. |
| 23 | **Cuadre en vivo cantidad vs. plano** | "Reportaste 20 y marcaste 15: faltan 5". Se muestra en la captura y en el plano; al guardar es advertencia, no bloqueo: el supervisor decide. |
| 24 | **Borrador automático por usuario y actividad** (tabla local) | Salir de la pantalla, una llamada o batería baja no hacen perder lo escrito ni las fotos. Se guarda 0,5 s después de cada cambio y al salir; se borra al guardar el registro. |
| 25 | **Fecha del registro: hoy / ayer / antier** | En obra es común reportar a primera hora lo del día anterior. |
| 26 | **Advertencias antes de guardar** | Acumulado mayor que lo contratado, cuadre con el plano y posible registro repetido (misma cantidad en los últimos 15 min). |
| 27 | **Frentes y actividades editables por el admin en la app**, con plantillas solares | La obra cambia en campo. El servidor solo acepta los cambios de un admin (RLS) y rechaza códigos repetidos. |
| 28 | **Actualizaciones OTA (expo-updates)** | Los cambios de JavaScript llegan en minutos sin esperar la cola de compilación ni reinstalar. |
| 29 | **Alertas programadas en SQL + despacho en Edge Function** | La generación (vencidos, por vencer, frente sin reporte) es SQL probado con PGlite; el envío vive en una función con reglas puras probadas (destinatarios por tipo y rol, canales por severidad). |
| 30 | **Contactos solo para el despacho** | `alert_member_contacts` rechaza a cualquier usuario autenticado aunque los privilegios por defecto le den EXECUTE (encontrado en la validación). |
| 31 | **Canales opcionales** | Push, Telegram, correo y WhatsApp se activan con sus credenciales; sin ellas se omiten. Cada envío queda en `alert_deliveries`; máximo 5 reintentos. |

## Caso del punto 16

Ver `packages/engine/test/case16.test.ts` y ejecutar:

```
npm run caso16 -w @avanceobra/engine
```

Los costos de alquiler, operador, combustible, movilización, indirectos, reproceso y saturación son **estimados** (marcados en `test/fixtures.ts`) y deben reemplazarse por los reales de la empresa.
