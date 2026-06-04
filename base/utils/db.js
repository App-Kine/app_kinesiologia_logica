"use strict";

/**
 * Manejador centralizado de pools de conexión a SQL Server (mssql).
 *
 * - initialize(): abre un ConnectionPool por cada entrada en
 *   global.config.databases. Se llama UNA vez al arranque (index.js).
 * - getPool(code): devuelve el pool de la BD identificada por `code`.
 * - request(code): atajo para getPool(code).request().
 * - close(): cierra todos los pools (útil en tests o shutdown limpio).
 *
 * Convención: el `code` viene de los archivos env/*.js. Para AurisDB
 * usamos `code: "auris"`.
 */

const sql = require("mssql");

const pools = {};

const _toMssqlConfig = (dbConf) => ({
    user: dbConf.user,
    password: dbConf.password,
    server: dbConf.server,
    port: dbConf.port || 1433,
    database: dbConf.database,
    options: dbConf.options || {
        encrypt: true,
        trustServerCertificate: true,
    },
    pool: dbConf.pool || {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
});

/**
 * Abre un ConnectionPool reintentando con backoff lineal (ISO 25010 —
 * Fiabilidad/Recuperabilidad). Si la BD aún no está lista al arrancar
 * (típico en docker-compose donde SQL Server tarda en aceptar conexiones),
 * no abortamos al primer fallo: reintentamos antes de propagar el error.
 */
const _conectarConReintentos = async (dbConf, intentos = 5, esperaBaseMs = 2000) => {
    let ultimoError;
    for (let i = 1; i <= intentos; i++) {
        try {
            return await new sql.ConnectionPool(_toMssqlConfig(dbConf)).connect();
        } catch (e) {
            ultimoError = e;
            logger.log(
                `\x1b[33m[db]\x1b[0m Pool "${dbConf.code}" intento ${i}/${intentos} falló: ${e.message}`
            );
            if (i < intentos) {
                await new Promise((r) => setTimeout(r, esperaBaseMs * i));
            }
        }
    }
    throw ultimoError;
};

const initialize = async () => {
    const list = (global.config && global.config.databases) || [];

    if (list.length === 0) {
        logger.log(
            `\x1b[33m[db]\x1b[0m No hay bases declaradas en env. Saltando initialize.`
        );
        return;
    }

    for (const dbConf of list) {
        if (!dbConf.code) {
            logger.log(`\x1b[31m[db]\x1b[0m Entrada sin "code", se ignora.`);
            continue;
        }
        if (!dbConf.server || !dbConf.database) {
            logger.log(
                `\x1b[31m[db]\x1b[0m "${dbConf.code}" falta server/database, se ignora.`
            );
            continue;
        }
        try {
            const pool = await _conectarConReintentos(dbConf);
            pools[dbConf.code] = pool;
            logger.log(
                `\x1b[36m[db]\x1b[0m Pool "${dbConf.code}" → ${dbConf.server}:${
                    dbConf.port || 1433
                }/${dbConf.database} listo`
            );
        } catch (e) {
            logger.log(
                `\x1b[31m[db]\x1b[0m Pool "${dbConf.code}" FALLÓ: ${e.message}`
            );
            throw e;
        }
    }
};

const getPool = (code) => {
    const p = pools[code];
    if (!p) {
        // Servicio no disponible (ISO 25010 — Disponibilidad): el pool no existe
        // (SQL caído en runtime o nunca inicializado). Lanzamos un error tipado
        // y con mensaje claro para que las capas superiores lo traduzcan a una
        // respuesta de "servicio no disponible". El stack NO se filtra al
        // cliente (ver base/utils/reply.js en producción).
        const err = new Error(
            `Base de datos no disponible (code="${code}"). El servicio no puede atender la solicitud en este momento.`
        );
        err.code = "DB_UNAVAILABLE";
        throw err;
    }
    return p;
};

const request = (code) => getPool(code).request();

const close = async () => {
    for (const code of Object.keys(pools)) {
        try {
            await pools[code].close();
        } catch (e) {
            // ignore
        }
        delete pools[code];
    }
};

module.exports = {
    sql, // re-export por si hace falta usar tipos: sql.Int, sql.NVarChar, etc.
    initialize,
    getPool,
    request,
    close,
};
