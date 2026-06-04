# Auris · Checklist de seguridad para producción

Guía de handoff para DTIC / Ciberseguridad. Marca qué ya viene resuelto en el
código y qué debe ajustar el equipo de infraestructura al pasar a producción.

> El desarrollo es **local y por HTTP**. Los cambios de infraestructura (HTTPS,
> dominio, hosting) los realiza DTIC. Este código deja todo **preparado** para
> ese switch.

## ✅ Ya resuelto en la aplicación
- Contraseñas con **bcrypt (cost 12)** y política RNF-13 (min 10, mayús/minús/núm/símbolo).
- **SQL 100% parametrizado** (sin inyección) y transacciones.
- **JWT v9** con algoritmo fijado (`HS256`), bloqueo por intentos de login, refresh token guardado solo como hash SHA-256.
- **CORS por allowlist** (env `CORS_ORIGINS`), **helmet**, **rate-limiting** (global + auth).
- Secretos por **variables de entorno** (nada hardcodeado en prod).
- Auditoría de acciones, health checks (`/healthz`, `/readyz`), XSS de contenido enriquecido sanitizado.

## ☐ Lo que DTIC / infraestructura debe ajustar para producción

1. **HTTPS/TLS en todo el tráfico** (lo nº1).
   - Terminar TLS en un reverse proxy (nginx) delante del controlador y la lógica.
   - Certificado institucional o Let's Encrypt. Activar **HSTS**.

2. **Apuntar el frontend/panel al dominio real.**
   - Editar `environment.prod.ts` (app y panel): reemplazar `https://CAMBIAR-DOMINIO-PRODUCCION/...` por el dominio HTTPS real, y recompilar.

3. **Quitar banderas de desarrollo inseguras (móvil).**
   - `capacitor.config.ts`: poner `server.cleartext: false` (o quitarlo).
   - iOS `App/App/Info.plist`: quitar `NSAllowsArbitraryLoads` (solo dev lo necesita para HTTP local).

4. **Secretos fuertes en variables de entorno** (nunca en Git):
   - `JWT_SECRET`: aleatorio largo (≥ 32 bytes), **idéntico** en controlador y lógica.
   - `DB_USER` / `DB_PASS`, `SMTP_*`, `MONGO_URI`.

5. **Base de datos con privilegios mínimos.**
   - Ejecutar `database/PROD_db_user.sql` → crea el usuario `auris_app` (CRUD sobre el esquema `auris`, sin `sa`). Configurar `DB_USER=auris_app`.

6. **Seed de producción sin credenciales por defecto.**
   - Definir el superadmin con clave fuerte: entrar al panel con `admin@auris.local` (del instalador) y cambiar su contraseña + correo desde la app (la app hashea sola), o usar el SQL `database/PROD_superadmin.sql`. NO dejar las claves demo por defecto.
   - No cargar los usuarios demo (`ChangeMe!2026`).

## ☐ Hardening recomendado (opcional, suma en la revisión)
- Token del móvil en **Keychain/SecureStorage** (hoy usa NativeStorage; requiere agregar plugin Capacitor de almacenamiento seguro).
- `npm audit` (mayo 2026): **controlador = 0 vulnerabilidades**; **lógica = 5 moderadas** transitivas (`multer` 1.x, `node-fetch` 2.x, etc.). Solo se resuelven con saltos de versión mayor que rompen la API (`multer` 2.x, `node-fetch` 3 es ESM), así que requieren refactor — pendiente, riesgo bajo (severidad moderada). No se aplicó `--force` para no romper runtime.
- Backups de BD probados + plan de restauración (ver `database/BACKUP.md`).
- Monitoreo/alertas (el error tracker tipo Sentry ya está integrado, solo falta el DSN en prod).
