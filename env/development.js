"use strict";

/**
 * Configuración por defecto para entorno de desarrollo.
 *
 * NOTA: Este archivo SE COMMITEA al repo. NO pongas aquí credenciales reales.
 * Cada desarrollador define sus credenciales locales en env/local.js
 * (gitignored). Si env/local.js existe al arrancar con `npm run start`, sus
 * valores sobreescriben los de este archivo.
 *
 * Los placeholders de abajo (password "CHANGE_ME_IN_LOCAL_JS", jwtSecret de dev)
 * son SOLO para desarrollo local. La CONFIGURACIÓN PRODUCCIÓN no usa este
 * archivo: ver env/production.js (lee de variables de entorno / secretos).
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
        // DEBE coincidir EXACTAMENTE con el secret del controlador
        // (env/development.js → param_base_jwt_password) o la auth entre
        // capas falla. En producción se define vía la env var JWT_SECRET.
        jwtSecret: "AURIS_LOCAL_DEV_SECRET_CHANGE_ME",
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
    mongo: {
        // Multimedia GridFS. Define tu URI real en env/local.js (gitignored).
        uri: "mongodb://localhost:27017",
        database: "auris_media",
    },
};
