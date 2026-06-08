"use strict";

/**
 * ============================ CONFIGURACIÓN PRODUCCIÓN ============================
 * En producción los secretos NUNCA quedan hardcodeados: este archivo SOLO lee
 * de process.env (ver .env.example). Si faltan valores de BD, el pool queda
 * inválido y db.initialize() corta el arranque con un error claro.
 *
 * QUÉ HAY QUE DEFINIR EN EL ENTORNO (env vars) AL DESPLEGAR:
 *   PORT ......................... puerto del servicio (default 2000, interno).
 *   DB_HOST / DB_PORT ............ host y puerto de SQL Server.
 *   DB_USER / DB_PASS ............ credenciales SQL.            ← SECRETO (DB_PASS)
 *   DB_NAME ...................... base de datos (AurisDB).
 *   MONGO_URI / MONGO_DB ......... MongoDB de multimedia (GridFS).
 *   JWT_SECRET ................... ← SECRETO. DEBE coincidir EXACTAMENTE con el
 *                                  del Controlador (auth.service firma y jwtAuth
 *                                  verifica con este mismo valor) o la
 *                                  autenticación entre capas falla.
 *   MAIL_MODE .................... "smtp" para enviar de verdad; otro valor = solo loguea.
 *   SMTP_HOST/PORT/SECURE/USER ... servidor de correo saliente.
 *   SMTP_PASS .................... ← SECRETO (App Password de Gmail u otro).
 *   MAIL_FROM .................... remitente de los correos.
 *   FRONTEND_BASE_URL ........... URL del Panel (links de invitación).
 *   CORS_ORIGINS ................ orígenes permitidos (subida directa de multimedia).
 *
 * Los marcados como ← SECRETO se inyectan por variable de entorno / gestor de
 * secretos; nunca se escriben en archivos versionados.
 * ================================================================================
 */
module.exports = {
    app: {
        port: parseInt(process.env.PORT || "2000", 10),
    },
    databases: [
        {
            code: "auris",
            server: process.env.DB_HOST || "",
            port: parseInt(process.env.DB_PORT || "1433", 10),
            user: process.env.DB_USER || "",
            password: process.env.DB_PASS || "",
            database: process.env.DB_NAME || "AurisDB",
            options: {
                encrypt: true,
                trustServerCertificate: false,
            },
            pool: { max: 20, min: 2, idleTimeoutMillis: 30000 },
        },
    ],
    security: {
        jwtSecret: process.env.JWT_SECRET || "",
        jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "8h",
        jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12", 10),
        loginBlockMaxAttempts: 5,
        loginBlockWindowMinutes: 15,
    },
    mail: {
        mode: process.env.MAIL_MODE || "smtp",
        from: process.env.MAIL_FROM || "Auris <no-reply@auris.local>",
        smtp: {
            host: process.env.SMTP_HOST || "",
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: (process.env.SMTP_SECURE || "false") === "true",
            user: process.env.SMTP_USER || "",
            password: process.env.SMTP_PASS || "",
        },
    },
    frontend: {
        baseUrl: process.env.FRONTEND_BASE_URL || "",
    },
    // Orígenes CORS permitidos (lista separada por comas en CORS_ORIGINS).
    // Ej: "https://panel.auris.cl,https://app.auris.cl,capacitor://localhost"
    corsOrigins: (process.env.CORS_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    invitaciones: {
        expiraHoras: parseInt(process.env.INVITACION_EXPIRA_HORAS || "24", 10),
    },
    mongo: {
        uri: process.env.MONGO_URI || "",
        database: process.env.MONGO_DB || "auris_media",
    },
};
