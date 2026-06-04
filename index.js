"use strict";

/* =============================================================================
 *  Auris · Capa Lógica — ARRANQUE DEL SERVICIO  (index.js)
 * -----------------------------------------------------------------------------
 *  Punto de entrada del backend de datos. Levanta Express en el puerto
 *  configurado (2000 por defecto) bajo la ruta base /base_logica.
 *
 *  ORDEN DE ARRANQUE (ver initApp(), más abajo):
 *    1. setRequestContext()  → correlación de requests (X-Request-Id).
 *    2. métricas Prometheus + parsers de body (urlencoded/json) + CORS allowlist.
 *    3. setConfig()    → carga env/local|development|production.js en global.config.
 *    4. setDatabases() → abre el/los pool(s) de SQL Server (con reintentos).
 *    5. setMongo()     → abre MongoDB/GridFS (OPCIONAL).
 *    6. setRouters()   → monta routers base + proyecto + health.
 *    7. setErrorHandlers() → error-handler de Express (SIEMPRE al final).
 *    8. launchApp()    → app.listen().
 *
 *  QUÉ PASA SI FALLA UNA DEPENDENCIA AL ARRANCAR:
 *    · SQL Server: es OBLIGATORIO. setDatabases() reintenta con backoff; si aun
 *      así no conecta, lanza y el proceso NO levanta (no se llega a launchApp).
 *      En producción, si faltan las env vars de BD, el pool queda inválido y
 *      db.initialize() corta el arranque con un error claro.
 *    · MongoDB: es OPCIONAL (solo multimedia). Si falla, se LOGUEA y la app
 *      igual arranca; solo se deshabilitan los endpoints de multimedia.
 *
 *  La configuración de cada conexión está en env/*.js (SQL en `databases`,
 *  Mongo en `mongo`). Esta capa NO debe exponerse a internet: en producción
 *  solo la alcanza el Controlador dentro de la red interna.
 * ============================================================================= */

var express = require("express");
var multer = require("multer");
var methodOverride = require("method-override");
var crypto = require("crypto");

var requestContext = require("./base/utils/requestContext");
var metrics = require("./base/utils/metrics");
var reply = require("./base/utils/reply");
var errorTracker = require("./base/utils/errorTracker");
global.logger = require("./base/utils/logConsola");

var loadConfig = require("./base/utils/loadConfig");
var db = require("./base/utils/db");
var mongo = require("./base/utils/mongo");
var infoApp = require("./package.json");
var { rootPath, largeEntity } = require("./config").app;

var app = express();

// Correlación de requests (ISO 25010 — Observabilidad): reutiliza el
// X-Request-Id que envía el gateway (o genera uno si la lógica se llama directo)
// y corre el request dentro de un AsyncLocalStorage para que el logger lo
// anteponga. Debe ser el PRIMER middleware.
let setRequestContext = () => {
    app.use((req, res, next) => {
        const incoming = req.headers["x-request-id"];
        const id = (incoming && String(incoming).slice(0, 64)) || crypto.randomUUID();
        req.id = id;
        res.setHeader("X-Request-Id", id);
        requestContext.run({ id }, () => next());
    });
};

let setRequestLargeEntity = () => {
    app.use(
        express.urlencoded(
            largeEntity
                ? { extended: false, limit: "500mb" }
                : { extended: false, limit: "5mb" }
        )
    );
    // 5mb por defecto para admitir el PDF del informe (base64) en enviarInforme.
    app.use(express.json(largeEntity ? { limit: "500mb" } : { limit: "5mb" }));
    app.use(methodOverride());
    logger.log(
        `\x1b[36m[${infoApp.name}]\x1b[0m Request entity: ${
            largeEntity ? "large" : "normal"
        }`
    );
};

// CORS con allowlist (ISO 25010 — Seguridad/Confidencialidad).
// Orígenes permitidos vía env CORS_ORIGINS (lista separada por comas) o
// global.config.corsOrigins. En desarrollo se permiten los locales del panel,
// la app web del estudiante (que sube multimedia directo a la lógica) y los
// orígenes de Capacitor.
const CORS_DEV_ORIGINS = [
    "http://localhost:4200",
    "http://localhost:4201",
    "http://localhost:8100",
    "capacitor://localhost", // app nativa Capacitor — iOS
    "ionic://localhost",
    "http://localhost", // app nativa Android (androidScheme: 'http') — multimedia/audio
    "https://localhost", // app nativa Android (androidScheme: 'https')
];
let corsOrigenesPermitidos = () => {
    const fromEnv = (process.env.CORS_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const fromConfig = (global.config && global.config.corsOrigins) || [];
    const merged = [...fromEnv, ...fromConfig];
    return merged.length ? merged : CORS_DEV_ORIGINS;
};

let configCORS = () => {
    try {
        app.use(function (req, res, next) {
            const origin = req.headers.origin;
            if (origin && corsOrigenesPermitidos().includes(origin)) {
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Vary", "Origin");
            }
            res.setHeader(
                "Access-Control-Allow-Methods",
                "POST, GET, OPTIONS, DELETE"
            );
            res.setHeader("Access-Control-Max-Age", "60");
            res.setHeader(
                "Access-Control-Allow-Headers",
                "Origin, X-Requested-With, Content-Type, Accept, Authorization"
            );

            // Preflight CORS: el navegador manda OPTIONS antes de un POST con
            // header Authorization (como la subida de multimedia). Hay que
            // responder 204 aquí; si dejamos pasar el OPTIONS, no hace match con
            // la ruta POST y cae en 404 → el navegador bloquea (status 0).
            if (req.method === "OPTIONS") {
                return res.sendStatus(204);
            }

            let oldSend = res.send;

            res.send = function (data) {
                try {
                    let datos = JSON.parse(data);

                    if (
                        datos.status == "ERROR" &&
                        datos.error.type == "FATAL"
                    ) {
                        logger.log(datos.error);
                    }

                    oldSend.apply(res, arguments);
                } catch (e) {
                    oldSend.apply(res, arguments);
                }
            };
            return next();
        });
        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m CORS: listo`);
    } catch (e) {
        throw { msgs: "Error configurar permisos CORS", error: e };
    }
};

let setConfig = async () => {
    try {
        global.config = await loadConfig();
        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Config: listo`);
        // P2.R6: inicializar tracker de errores (no-op si no hay dsn configurado)
        require("./base/utils/errorTracker").initialize();
    } catch (e) {
        throw { msgs: "Error carga config/envConfig", error: e };
    }
};

let setDatabases = async () => {
    try {
        await db.initialize();
        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Databases: listo`);
    } catch (e) {
        throw { msgs: "Error inicializar bases de datos", error: e };
    }
};

let setMongo = async () => {
    // Mongo es opcional (multimedia). Si falla, no tumbamos la app:
    // mongo.initialize() ya captura su propio error y solo deshabilita
    // los endpoints de multimedia.
    try {
        await mongo.initialize();
    } catch (e) {
        logger.log(
            `\x1b[33m[${infoApp.name}]\x1b[0m Mongo no disponible: ${e.message}`
        );
    }
};

let setRouters = (module) => {
    try {
        switch (module) {
            case "base":
                app.use(
                    `/${rootPath}/base`,
                    require("./base/routes/base.router")
                );
                // Health endpoints (Bloque P2.R7) — montados SIN prefijo
                // /base_logica para que las herramientas de monitoreo estándar
                // los puedan sondear (kubectl, nginx upstream, etc).
                app.use("/", require("./proyecto/routes/health.router"));
                break;
            case "proyecto":
                require("./routes")(app, rootPath);
                break;
        }
        logger.log(
            `\x1b[36m[${infoApp.name}]\x1b[0m Routers (${module}): listo`
        );
    } catch (e) {
        throw { msgs: `Error carga routers (${module})`, error: e };
    }
};

// Error-handler de Express (Bloque P2.R6 — auditoría ISO 25010). Se monta
// DESPUÉS de todos los routers. Dos capas:
//   1) errorTracker.expressErrorHandler(): captura la excepción (Sentry/logs)
//      y reenvía con next(err) sin responder.
//   2) Handler final (err,req,res,next): responde SIEMPRE con `reply` para no
//      filtrar el stack (reply ya lo omite en producción) y elige el status
//      adecuado: 413 para payload/archivo demasiado grande, 400 para JSON
//      malformado del body-parser, 503 para BD no disponible, 500 genérico.
let setErrorHandlers = () => {
    try {
        // Capa 1: tracking (no responde, solo captura y propaga).
        app.use(errorTracker.expressErrorHandler());

        // Capa 2: respuesta final al cliente.
        // eslint-disable-next-line no-unused-vars
        app.use(function (err, req, res, next) {
            // Si ya se empezó a responder (p.ej. streaming), delegamos a Express.
            if (res.headersSent) {
                return next(err);
            }

            // MulterError: archivo demasiado grande u otros límites de subida.
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(413).json(reply.error("Archivo demasiado grande"));
                }
                return res.status(400).json(reply.error(`Error al subir el archivo: ${err.message}`));
            }

            // body-parser: payload demasiado grande.
            if (err.type === "entity.too.large" || err.status === 413 || err.statusCode === 413) {
                return res.status(413).json(reply.error("La solicitud es demasiado grande"));
            }

            // body-parser: JSON malformado en el body.
            if (err.type === "entity.parse.failed" || (err.status === 400 && err.expose)) {
                return res.status(400).json(reply.error("Cuerpo de la solicitud con formato inválido"));
            }

            // BD no disponible (db.getPool con pool caído).
            if (err.code === "DB_UNAVAILABLE") {
                return res.status(503).json(reply.error("Servicio no disponible: la base de datos no responde en este momento"));
            }

            // Error genérico: el stack NO se filtra (reply lo omite en prod).
            logger.log(
                `\x1b[31m[${infoApp.name}]\x1b[0m Error no controlado: ${err && err.message ? err.message : err}`,
                err
            );
            return res.status(500).json(reply.fatal(err instanceof Error ? err : new Error(String(err))));
        });

        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Error handlers: listo`);
    } catch (e) {
        throw { msgs: "Error montar error-handlers", error: e };
    }
};

let httpServer = null;

let launchApp = () => {
    try {
        const server = app.listen(global.config.app.port, function () {
            logger.log(
                `\x1b[36m[${
                    infoApp.name
                }]\x1b[0m Env: ${global.config.app.NODE_ENV.toUpperCase()}, Port: ${
                    global.config.app.port
                }, Path: /${rootPath}, Tipo: LOGICA, v: ${infoApp.version}`
            );
        });
        httpServer = server;
        setupGracefulShutdown();

        // El error de listen (p.ej. EADDRINUSE) se emite de forma ASÍNCRONA
        // como evento 'error' del server; el try/catch de arriba NO lo atrapa.
        // Sin este handler, Node relanza el evento y mata el proceso con un
        // stack trace feo. Acá lo logueamos claro y salimos con código 1.
        server.on("error", (e) => {
            if (e.code === "EADDRINUSE") {
                logger.log(
                    `\x1b[31m[${infoApp.name}]\x1b[0m Puerto ${global.config.app.port} en uso. ` +
                        `¿Ya hay otra instancia de la lógica corriendo? Liberá el puerto y reintentá.`
                );
            } else {
                logger.log(
                    `\x1b[31m[${infoApp.name}]\x1b[0m Error del servidor HTTP: ${e.message}`,
                    e
                );
            }
            process.exit(1);
        });
    } catch (e) {
        throw { msgs: "Error lanzar app", error: e };
    }
};

let initApp = async () => {
    try {
        setRequestContext();
        app.use(metrics.middleware); // métricas Prometheus (GET /metrics)
        setRequestLargeEntity();
        configCORS();
        await setConfig();
        await setDatabases();
        await setMongo();
        setRouters("base");
        setRouters("proyecto");
        setErrorHandlers(); // DESPUÉS de los routers
        launchApp();
    } catch (e) {
        logger.log(
            `\x1b[36m[${infoApp.name}] \x1b[33m[${e.msgs}] ${e.error}\x1b[0m`
        );
    }
};

// Apagado limpio (ISO 25010 — Disponibilidad): ante SIGTERM/SIGINT dejamos de
// aceptar conexiones, esperamos a que terminen las en curso y cerramos los
// pools de SQL Server y el cliente de Mongo antes de salir. Así un deploy o
// reinicio no corta requests ni deja conexiones colgadas en la BD. Si no cierra
// en 10s, forzamos la salida para no quedar bloqueados.
let shuttingDown = false;
let setupGracefulShutdown = () => {
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m ${signal} recibido — cierre graceful…`);

        const liberarRecursos = async () => {
            try { await db.close(); logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Pools SQL cerrados.`); }
            catch (e) { logger.log(`\x1b[31m[${infoApp.name}]\x1b[0m Error cerrando SQL: ${e.message}`); }
            try { if (mongo.close) { await mongo.close(); logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Mongo cerrado.`); } }
            catch (e) { logger.log(`\x1b[31m[${infoApp.name}]\x1b[0m Error cerrando Mongo: ${e.message}`); }
            logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Recursos liberados. Bye.`);
            process.exit(0);
        };

        if (httpServer) httpServer.close(() => liberarRecursos());
        else liberarRecursos();

        setTimeout(() => {
            logger.log(`\x1b[31m[${infoApp.name}]\x1b[0m Cierre forzado tras timeout (10s).`);
            process.exit(1);
        }, 10000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
};

// Red de seguridad global: una excepción no atrapada en un handler de request
// (o una promesa rechazada sin catch) NO debe tumbar todo el servidor. La
// logueamos y dejamos el proceso vivo para seguir atendiendo el resto de
// requests. En producción conviene además reiniciar vía un process manager
// (pm2/systemd) tras un uncaughtException.
process.on("uncaughtException", (e) => {
    logger.log(
        `\x1b[31m[${infoApp.name}]\x1b[0m uncaughtException: ${e && e.message ? e.message : e}`,
        e
    );
});
process.on("unhandledRejection", (reason) => {
    logger.log(
        `\x1b[31m[${infoApp.name}]\x1b[0m unhandledRejection: ${
            reason && reason.message ? reason.message : reason
        }`,
        reason
    );
});

initApp();

module.exports = app;
