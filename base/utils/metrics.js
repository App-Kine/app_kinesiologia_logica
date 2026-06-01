"use strict";

/**
 * Métricas mínimas en memoria, formato texto Prometheus, SIN dependencias
 * (ISO 25010 — Observabilidad/Visibilidad). Un Prometheus/Grafana puede scrapear
 * GET /metrics para graficar tráfico, errores y memoria de la lógica.
 *
 * Liviano a propósito (contadores en proceso). Para histograma de latencias por
 * ruta, migrar a prom-client.
 */

var counters = {
    total: 0,
    byClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
};
var inFlight = 0;

function middleware(req, res, next) {
    inFlight++;
    var done = false;
    function finalize() {
        if (done) return;
        done = true;
        inFlight--;
        counters.total++;
        var cls = Math.floor(res.statusCode / 100) + "xx";
        if (counters.byClass[cls] !== undefined) counters.byClass[cls]++;
    }
    res.on("finish", finalize);
    res.on("close", finalize);
    next();
}

function render(service) {
    var mem = process.memoryUsage().rss;
    var lines = [
        "# HELP auris_uptime_seconds Process uptime in seconds.",
        "# TYPE auris_uptime_seconds gauge",
        'auris_uptime_seconds{service="' + service + '"} ' + Math.round(process.uptime()),
        "# HELP auris_http_requests_total Total HTTP requests handled.",
        "# TYPE auris_http_requests_total counter",
        'auris_http_requests_total{service="' + service + '"} ' + counters.total,
        "# HELP auris_http_requests_class_total HTTP requests by status class.",
        "# TYPE auris_http_requests_class_total counter",
    ];
    Object.keys(counters.byClass).forEach(function (k) {
        lines.push('auris_http_requests_class_total{service="' + service + '",class="' + k + '"} ' + counters.byClass[k]);
    });
    lines.push("# HELP auris_http_in_flight Current in-flight requests.");
    lines.push("# TYPE auris_http_in_flight gauge");
    lines.push('auris_http_in_flight{service="' + service + '"} ' + inFlight);
    lines.push("# HELP auris_process_resident_memory_bytes Resident memory size in bytes.");
    lines.push("# TYPE auris_process_resident_memory_bytes gauge");
    lines.push('auris_process_resident_memory_bytes{service="' + service + '"} ' + mem);
    return lines.join("\n") + "\n";
}

module.exports = { middleware, render };
