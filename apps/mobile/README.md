# AvanceObra · App móvil (Expo SDK 57)

App de campo offline-first: registro de avance en 3 toques, fotos con marca de agua, GPS,
QR, plano georreferenciado, hallazgos, aprobación del residente y sincronización automática.

## Requisitos

1. Copia `.env.example` a `.env` y completa las URLs de Supabase y PowerSync.
2. Aplica las migraciones de `supabase/migrations` y carga `powersync/sync-rules.yaml` en el panel de PowerSync
   (conexión a la base con la publicación `powersync`).
3. La app usa módulos nativos (SQLite, MapLibre, Skia, cámara): **no funciona en Expo Go**.
   Necesita una *development build*:

```
npx expo run:android
```

o en la nube, sin Android Studio:

```
npx eas-cli@latest build --profile development --platform android
```

## Flujo de registro (3 toques)

1. **Frente**: botones grandes; muestra cuáles no tienen reporte hoy.
2. **Actividad**: las más usadas primero, con % acumulado.
3. **Cantidad + foto + Guardar**: horas, clima, personal y causa vienen prellenados con el último registro;
   "Más datos" abre el plano (marcar elementos o dibujar el área), observaciones y firma.

El QR de un elemento salta directo al paso 3 con el elemento marcado.

## Offline

| Qué | Cómo |
|-----|------|
| Datos | SQLite local (PowerSync). Todo se guarda primero en el teléfono. |
| Subida de registros | Cola CRUD de PowerSync en lotes; errores definitivos se apartan a "Rechazados" sin bloquear la cola. |
| Fotos y firmas | Comprimidas (1600 px, JPEG 70 %), con marca de agua, en `documents/photos`; cola propia con backoff exponencial (5 s → 30 min, ±20 %). |
| Conflictos | Avances append-only (sin conflicto). Hallazgos: última modificación gana + aviso si otro usuario cambió estado/severidad/responsable/fecha. |
| Alertas | Se evalúan al guardar (rendimiento bajo, proyección tardía) → notificación local inmediata + fila en `alerts` que el servidor reenvía al tener señal. |
| Mapa | Plano descargado al teléfono + caché del mapa base por zona ("Descargar mapa de la zona"). |

## Pruebas

```
npm test        # lógica pura: mapeo de sync, backoff, marca de agua, recientes, pendientes, plano
npm run typecheck
```
