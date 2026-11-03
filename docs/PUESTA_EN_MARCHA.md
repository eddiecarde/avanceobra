# Puesta en marcha: Supabase + PowerSync + APK Android

Tiempo estimado: 30–40 minutos. Todo en planes gratuitos.
Lo que haces tú está marcado con 👤; lo que hace el asistente, con 🤖.

---

## 1. Supabase (base de datos, usuarios, fotos)

1. 👤 Entra a <https://supabase.com/dashboard> → **New project**.
   - Nombre: `avanceobra-demo` · Región: **East US** o **São Paulo** (la más cercana a Colombia).
   - Guarda la **Database password** (la necesitas en el paso 2).
2. 👤 **SQL Editor → New query** → pega todo `supabase/setup/01_esquema_y_semilla.sql` → **Run**.
   Debe terminar en "Success. No rows returned".
3. 👤 **SQL Editor → New query** → pega `supabase/setup/02_powersync_role.sql`, cambia
   `CAMBIA_ESTA_CLAVE` por una clave larga (guárdala) → **Run**.
4. 👤 **Authentication → Users → Add user → Create new user**: tu correo, una contraseña,
   marca **Auto Confirm User**. (Opcional: crea también `supervisor@…` y `residente@…` para probar roles).
5. 👤 **SQL Editor** → pega `supabase/setup/03_datos_demo.sql` con tu correo → **Run**.
   La última consulta muestra la **carpeta para el plano** (un UUID).
6. 👤 **Storage → plans** → crea una carpeta con ese UUID → sube `supabase/seed/plano-demo.png` dentro.
7. 👤 (Para el inicio con código) **Authentication → Emails → Magic Link**: agrega `{{ .Token }}`
   al cuerpo del correo, por ejemplo: `Tu código de AvanceObra es {{ .Token }}`.
   > El correo gratuito de Supabase solo envía unos pocos mensajes por hora y solo a miembros
   > del equipo del proyecto. Para pruebas usa **Contraseña** en la app.
8. 👤 **Project Settings → API**: copia **Project URL** y la clave **anon / publishable**
   (es pública, va dentro de la app). **No compartas la `service_role`.**

## 2. PowerSync (sincronización offline)

1. 👤 Entra a <https://dashboard.powersync.com> → crea un proyecto → **Add Instance**
   (región US).
2. 👤 **Database Connection → Postgres**:
   - En Supabase: botón **Connect** (arriba) → copia la cadena de **Direct connection**.
   - Pégala en **URI**. Cambia **Username** a `powersync_role` y **Password** a la clave del paso 1.3.
   - **Test Connection** → **Save Connection**.
3. 👤 **Client Auth** → marca **Use Supabase Auth** → **Save and Deploy**.
4. 👤 **Sync Streams** → reemplaza el contenido por `powersync/sync-config.yaml` → **Validate** → **Deploy**.
5. 👤 Botón **Connect** (arriba) → copia la **instance URL** (`https://….powersync.journeyapps.com`).

## 3. Configurar la app

🤖 Con la Project URL, la clave anon y la URL de PowerSync, el asistente llena
`apps/mobile/eas.json` (y `apps/mobile/.env` para desarrollo local).

## 4. Compilar e instalar el APK

1. 👤 Crea una cuenta gratuita en <https://expo.dev/signup>.
2. 👤 En la terminal del proyecto (no compartas la contraseña con nadie):
   ```
   cd apps/mobile
   npx eas-cli@latest login
   ```
3. 🤖 `npx eas-cli init` (vincula el proyecto) y `npx eas-cli build -p android --profile preview`.
   La compilación tarda ~15–25 min en la cola gratuita y entrega un enlace + QR.
4. 👤 Abre el enlace en el teléfono Android → descarga el APK → permite "instalar apps desconocidas"
   para el navegador → instala.

## 5. Prueba guiada (10 minutos)

| # | Qué hacer | Qué debe pasar |
|---|-----------|----------------|
| 1 | Entrar con correo y contraseña | Barra verde "Sincronizado"; aparece "Parque Solar Demo" |
| 2 | Pestaña **Plano** → "Descargar mapa de la zona" | Bloque A con pilotes en verde, Bloque B casi gris, zanjas en amarillo, hallazgo rojo |
| 3 | Activar **modo avión** | Barra gris "Sin conexión" |
| 4 | Registrar → Bloque B → Hincado → 6 → 📷 Foto → Guardar | "Guardado"; la barra muestra "Sin conexión · N pendientes" (registros + fotos) |
| 5 | Registrar otra vez con "Más datos" → Marcar en el plano → tocar 6 pilotes → Listo | La cantidad se propone sola: "Usar elementos marcados: 6" |
| 6 | Pendientes → Nuevo hallazgo crítico con foto | Notificación local inmediata |
| 7 | Desactivar modo avión | "Sincronizando…" → "Sincronizado" en segundos; las fotos suben después |
| 8 | En Supabase → Table editor → `progress_entries` | Aparecen los registros con `location`; en Storage → photos, las fotos con marca de agua |
| 9 | Pestaña **Revisar** → Aprobar | En Supabase el registro pasa a `approved` con `approved_by` |

## Solución de problemas

| Síntoma | Causa probable |
|---------|----------------|
| La app abre pero no aparece el proyecto | El usuario no tiene membresía: ejecuta `03_datos_demo.sql` con ese correo. Revisa en PowerSync → Logs. |
| "Sin conexión" con internet | URL de PowerSync mal copiada o Sync Streams sin desplegar. |
| Registros en "Rechazados por el servidor" | Mensaje exacto en la pestaña Sincronía; suele ser RLS (usuario sin rol en el proyecto). |
| El plano no se ve | No se subió `plano-demo.png` a `plans/<uuid>/plano-demo.png`. Los pilotes y trackers se ven igual. |
| Mapa base en blanco sin señal | No se descargó la zona antes de entrar a modo avión. |

---

## 6. Activar el envío de alertas (etapa 3)

Las alertas ya se crean solas (al guardar en el teléfono, con hallazgos críticos y con los jobs
programados). Para que **lleguen** a las personas hay que desplegar dos Edge Functions y elegir canales.
Un canal sin credenciales simplemente no se usa.

### 6.1 Base de datos
👤 **SQL Editor** → pega `supabase/migrations/20261016000004_alerts_dispatch.sql` → **Run**.

### 6.2 Telegram (recomendado para empezar: gratis, 5 minutos)
1. 👤 En Telegram abre **@BotFather** → `/newbot` → nombre `AvanceObra Alertas` → usuario terminado en `bot`
   (ej. `avanceobra_alertas_bot`). Guarda el **token** (no lo compartas).
2. 🤖 El asistente pone el usuario del bot en `EXPO_PUBLIC_TELEGRAM_BOT` y publica una actualización OTA.

### 6.3 Desplegar las funciones
👤 En la terminal (inicia sesión en el navegador cuando lo pida):
```
npx.cmd supabase login
npx.cmd supabase functions deploy alerts-dispatch --project-ref jxhewajalkuarupdwwiq --no-verify-jwt --use-api
npx.cmd supabase functions deploy telegram-webhook --project-ref jxhewajalkuarupdwwiq --no-verify-jwt --use-api
```
👤 **Edge Functions → Secrets** en Supabase, agrega:

| Secreto | Valor |
|---------|-------|
| `DISPATCH_SECRET` | una clave larga inventada por ti (la usas también en 6.4) |
| `TELEGRAM_BOT_TOKEN` | el token de BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | otra clave larga inventada (solo letras, números, `_` y `-`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | opcional: correo (resend.com) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE` | opcional: WhatsApp Cloud API |

👤 Conecta el bot al webhook abriendo en el navegador (reemplaza TOKEN y SECRETO):
`https://api.telegram.org/botTOKEN/setWebhook?url=https://jxhewajalkuarupdwwiq.supabase.co/functions/v1/telegram-webhook&secret_token=SECRETO`
Debe responder `"ok":true`.

### 6.4 Programar los jobs
👤 **SQL Editor** → pega `supabase/setup/04_alertas.sql`, cambia `PEGA_AQUI_EL_SECRETO` por tu `DISPATCH_SECRET` → **Run**.
Crea 3 jobs: despacho cada minuto, vencimientos a las 6:00 a. m. y frentes sin reporte a las 5:00 p. m. (lun–sáb).

### 6.5 Probar
1. En la app: **Sincronía → Vincular Telegram** → se abre el bot → **Iniciar** → responde "✅ Listo".
2. Crea un **hallazgo crítico** → en menos de un minuto llega el mensaje a residente, director y admin vinculados.
3. Revisa en Supabase la tabla `alert_deliveries` (estado de cada envío) y **Edge Functions → Logs**.

### 6.6 Informe diario automático (6 p. m.)
🤖 Ya está desplegado y programado. Para repetirlo en otro proyecto de Supabase:
```
npm run build:functions
npx.cmd supabase functions deploy daily-report --project-ref jxhewajalkuarupdwwiq --no-verify-jwt --use-api
```
y en **SQL Editor** ejecuta `supabase/setup/05_informe_diario.sql`. Usa los mismos secretos de 6.3
(`DISPATCH_SECRET`, `TELEGRAM_BOT_TOKEN`); `WEB_URL` es opcional (dirección de la web para el enlace).
Llega a residente, director y administrador que tengan Telegram vinculado; los envíos quedan en
`daily_report_deliveries`.

### Push en el teléfono (opcional)
Android exige Firebase: crea un proyecto en console.firebase.google.com, agrega la app `co.avanceobra.app`,
descarga `google-services.json` y sube la llave de cuenta de servicio en expo.dev → Credentials → FCM V1.
Luego se recompila el APK. Mientras tanto la app registra el token en silencio y usa los otros canales.

## 7. Actualizaciones sin reinstalar (OTA)

Desde la versión **1.1.0**, los cambios de pantallas y lógica se publican con:
```
cd apps/mobile
npx.cmd eas-cli update --channel preview --message "descripción del cambio"
```
El teléfono descarga la actualización al abrir la app (con señal) y la aplica en el siguiente inicio.
Cambios nativos (permisos, Firebase, nuevas librerías nativas) sí requieren un APK nuevo.
