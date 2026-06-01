"use strict";

/**
 * Tracker de errores opcional (Bloque P2.R6 — auditoría ISO 25010).
 *
 * Diseñado para integrarse con Sentry (https://sentry.io) si la configuración
 * lo declara, pero NO obliga a tenerlo. Si `global.config.errorTracking.dsn`
 * está vacío o no se instala @sentry/node, el tracker hace fallback a logs
 * en consola — el sistema sigue funcionando.
 *
 * Uso desde un service o middleware:
 *
 *     const errorTracker = require("./base/utils/errorTracker");
 *     errorTracker.captureException(e, { tags: { route: "/login" } });
 *
 * Configuración (env/local.js):
 *
 *     errorTracking: {
 *         dsn: "https://xxxx@oXXXX.ingest.sentry.io/YYYY",
 *         environment: "production",     // "development" | "production"
 *         tracesSampleRate: 0.1,         // 10% de transacciones (opcional)
 *         release: "auris@1.0.5",        // opcional
 *     },
 *
 * Si `dsn` está vacío o ausente, el tracker NO inicializa Sentry y todos los
 * `captureException` quedan como logs locales.
 */

let _sentry = null;
let _initialized = false;

const TAG = "\x1b[36m[errorTracker]\x1b[0m";

function initialize() {
    if (_initialized) return;
    _initialized = true;

    const conf = (global.config && global.config.errorTracking) || {};
    if (!conf.dsn) {
        if (global.logger) {
            global.logger.log(`${TAG} desactivado (no hay errorTracking.dsn en config)`);
        }
        return;
    }

    try {
        // require dinámico para no romper si @sentry/node no está instalado.
        _sentry = require("@sentry/node");
        _sentry.init({
            dsn: conf.dsn,
            environment: conf.environment || process.env.NODE_ENV || "development",
            tracesSampleRate: typeof conf.tracesSampleRate === "number"
                ? conf.tracesSampleRate
                : 0.0,
            release: conf.release || undefined,
            // No mandamos PII por defecto (correos, IPs en cabeceras)
            sendDefaultPii: false,
        });
        if (global.logger) {
            global.logger.log(`${TAG} Sentry inicializado (env=${conf.environment || "?"})`);
        }
    } catch (e) {
        _sentry = null;
        if (global.logger) {
            global.logger.log(`${TAG} @sentry/node no disponible, usando logs locales: ${e.message}`);
        }
    }
}

/**
 * Captura una excepción.
 * Si Sentry está inicializado, la envía allá. Si no, queda en logs.
 *
 * @param {Error} err
 * @param {object} ctx contexto adicional (tags, extra, user)
 */
function captureException(err, ctx) {
    if (!_initialized) initialize();
    if (_sentry) {
        _sentry.withScope((scope) => {
            if (ctx && ctx.tags) {
                for (const k of Object.keys(ctx.tags)) {
                    scope.setTag(k, ctx.tags[k]);
                }
            }
            if (ctx && ctx.extra) scope.setContext("extra", ctx.extra);
            if (ctx && ctx.user) scope.setUser(ctx.user);
            _sentry.captureException(err);
        });
    } else if (global.logger) {
        const ctxStr = ctx ? ` ctx=${JSON.stringify(ctx)}` : "";
        global.logger.log(`${TAG} EXCEPCION ${err && err.message}${ctxStr}`);
    }
}

/**
 * Captura un mensaje (no excepción), útil para warnings importantes.
 */
function captureMessage(message, level = "info") {
    if (!_initialized) initialize();
    if (_sentry) {
        _sentry.captureMessage(message, level);
    } else if (global.logger) {
        global.logger.log(`${TAG} ${level.toUpperCase()} ${message}`);
    }
}

/**
 * Middleware Express que captura excepciones no controladas en handlers.
 * Se monta DESPUÉS de todos los routes:
 *     app.use(errorTracker.expressErrorHandler());
 */
function expressErrorHandler() {
    return function (err, req, res, next) {
        captureException(err, {
            tags: { method: req.method, path: req.path },
            extra: { query: req.query, body: req.body },
        });
        next(err);
    };
}

module.exports = {
    initialize,
    captureException,
    captureMessage,
    expressErrorHandler,
};
