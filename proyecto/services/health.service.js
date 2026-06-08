"use strict";

/**
 * Health check service (Bloque P2.R7 — auditoría ISO 25010).
 *
 * Expone tres endpoints:
 *   - GET  /healthz       — liveness:  el proceso responde
 *   - GET  /readyz        — readiness: el proceso responde Y las dependencias
 *                          (SQL Server + MongoDB) están disponibles
 *   - GET  /health        — detallado: snapshot de cada dependencia + versión
 *                          + uptime, útil para dashboards
 *
 * Pensado para que un balanceador (nginx, Cloudflare, k8s, etc) sondee
 * /readyz y deje de enviar tráfico si el backend no está sano.
 */

var db = require("../../base/utils/db");
var mongo = require("../../base/utils/mongo");
var metricsUtil = require("../../base/utils/metrics");

const TAG = "\x1b[36m[health]\x1b[0m";

const PKG = require("../../package.json");

/** Versión + uptime básico, siempre 200. */
function liveness(_request, response) {
    response.json({
        status: "ok",
        service: "auris-logica",
        version: PKG.version,
        uptime_seconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
    });
}

/** Pinguea SQL + Mongo. Devuelve 200 si todo OK, 503 si algo falla. */
async function readiness(_request, response) {
    const checks = { sql: false, mongo: false };
    const errors = {};

    // 1. SQL Server (pool "auris")
    try {
        const r = await db.request("auris").query("SELECT 1 AS ok;");
        checks.sql = r.recordset[0]?.ok === 1;
    } catch (e) {
        errors.sql = e.message;
    }

    // 2. MongoDB (opcional — el sistema funciona sin él, pero degradado)
    try {
        if (mongo.isReady && mongo.isReady()) {
            const dbm = mongo.getDb();
            await dbm.command({ ping: 1 });
            checks.mongo = true;
        } else {
            errors.mongo = "mongo no inicializado";
        }
    } catch (e) {
        errors.mongo = e.message;
    }

    const healthy = checks.sql; // SQL es crítico; Mongo es opcional
    const status = healthy ? "ok" : "degraded";
    if (!healthy) response.status(503);
    response.json({
        status,
        checks,
        errors: Object.keys(errors).length ? errors : undefined,
    });
}

/** Snapshot completo + versión + uptime, para dashboards. */
async function detailed(request, response) {
    const checks = { sql: { ok: false }, mongo: { ok: false } };

    try {
        const t0 = Date.now();
        const r = await db.request("auris")
            .query("SELECT 1 AS ok, GETUTCDATE() AS servertime;");
        checks.sql = {
            ok: r.recordset[0]?.ok === 1,
            servertime: r.recordset[0]?.servertime,
            latency_ms: Date.now() - t0,
        };
    } catch (e) {
        checks.sql = { ok: false, error: e.message };
    }

    try {
        if (mongo.isReady && mongo.isReady()) {
            const t0 = Date.now();
            await mongo.getDb().command({ ping: 1 });
            checks.mongo = { ok: true, latency_ms: Date.now() - t0 };
        } else {
            checks.mongo = { ok: false, error: "mongo no inicializado" };
        }
    } catch (e) {
        checks.mongo = { ok: false, error: e.message };
    }

    response.json({
        status: checks.sql.ok ? "ok" : "degraded",
        service: "auris-logica",
        version: PKG.version,
        uptime_seconds: Math.round(process.uptime()),
        node_version: process.version,
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        checks,
        time: new Date().toISOString(),
    });
}

/** Métricas en formato texto Prometheus (scrapeo de Grafana/Prometheus). */
function metrics(_request, response) {
    response.setHeader("Content-Type", "text/plain; version=0.0.4");
    response.send(metricsUtil.render("logica"));
}

module.exports = { liveness, readiness, detailed, metrics };
