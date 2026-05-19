"use strict";

/**
 * Configuración por defecto para entorno de desarrollo.
 *
 * NOTA: Este archivo SE COMMITEA al repo. NO pongas aquí credenciales reales.
 * Cada desarrollador define sus credenciales locales en env/local.js
 * (gitignored). Si env/local.js existe al arrancar con `npm run start`, sus
 * valores sobreescriben los de este archivo.
 */
module.exports = {
    app: {
        port: 2000,
    },
    databases: [
        {
            code: "auris",
            server: "localhost",
            port: 1433,
            user: "sa",
            password: "CHANGE_ME_IN_LOCAL_JS",
            database: "AurisDB",
            options: {
                encrypt: true,
                trustServerCertificate: true,
            },
            pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
        },
    ],
    security: {
        jwtSecret: "AURIS_DEV_SECRET_CHANGE_ME",
        jwtAccessExpiresIn: "8h",
        jwtRefreshExpiresIn: "7d",
        bcryptRounds: 12,
        loginBlockMaxAttempts: 5,
        loginBlockWindowMinutes: 15,
    },
    mail: {
        mode: "dev",
        from: "Auris <no-reply@auris.local>",
    },
    frontend: {
        baseUrl: "http://localhost:4200",
    },
    invitaciones: {
        expiraHoras: 24,
    },
};
