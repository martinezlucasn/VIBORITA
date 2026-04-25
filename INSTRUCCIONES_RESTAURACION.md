# Manual de Restauración - Viborita v2.7

Este archivo contiene las instrucciones para volver al estado estable del 21 de Abril de 2026.

## 1. Restaurar Juego (AI Studio)
Si el código del juego se rompe, copia el contenido de `src/BACKUP_App_v2.7.tsx` y pégalo en `src/App.tsx`. Luego haz lo mismo con `BACKUP_server_juego.ts` en `server.ts`.

## 2. Restaurar Puente (Google Cloud Run)
Si el servidor de pagos falla, usa el archivo `BACKUP_puente_google_cloud.js`:

1. Abre Cloud Shell.
2. `cd ~/puente-viborita`
3. `cat BACKUP_puente_google_cloud.js > index.js`
4. `gcloud run deploy puente-viborita --source . --region us-central1 --allow-unauthenticated`

## 🔑 Credenciales Clave
- **Mercado Pago Token**: APP_USR-8338032777407473-041219-60a8de4c25c2273f599e7f4c30d48437-148608155
- **URL Webhook**: https://puente-viborita-955968394030.us-central1.run.app/api/webhook
