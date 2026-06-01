/*
 * Test de carga sobre el flujo del estudiante (Bloque P1.R2).
 *
 * Simula 100 estudiantes concurrentes (configurable) resolviendo una
 * aplicación de test:
 *   1. GET / POST aplicacionesActivas    (descubrir el test)
 *   2. POST iniciar                       (cargar preguntas, no persiste)
 *   3. POST corregir N veces              (una por pregunta, no persiste)
 *   4. POST enviar                        (única operación que persiste)
 *
 * Cómo correrlo:
 *   1. Instalar k6:                       https://k6.io/docs/getting-started/installation/
 *   2. Levantar lógica + controlador      (cd app_kinesiologia_logica && npm run dev-unix)
 *   3. Sembrar la BD con AurisDB_INSTALL.sql para tener 1 aplicación activa
 *   4. Correr:
 *        k6 run tests/loadtest/evaluacion-flow.k6.js
 *
 *   O bien con parámetros:
 *        k6 run \
 *           --vus 200 \
 *           --duration 5m \
 *           -e BASE_URL=http://localhost:3000 \
 *           -e CURSO_ID=1 \
 *           tests/loadtest/evaluacion-flow.k6.js
 *
 * Métricas que k6 reporta por defecto:
 *   - http_req_duration            (latencia p95, p99)
 *   - http_req_failed              (% de errores)
 *   - vus                          (usuarios virtuales activos)
 *   - iterations                   (flujos completados)
 *
 * Umbrales (thresholds) declarados abajo: el test falla con exit code != 0
 * si no se cumplen, útil para CI/CD.
 */

import http from "k6/http";
import { check, sleep, fail } from "k6";

// ---------- Configuración por variable de entorno ----------
// Opción A — atacar la lógica directamente (más simple, mide solo el backend):
//     -e BASE_URL=http://localhost:2000 -e PREFIX=/base_logica
// Opción B — atacar el controlador (mide stack completo: proxy + lógica):
//     (defaults)  → controlador en :3000 con prefijo /controlador_base
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const PREFIX = __ENV.PREFIX || "/controlador_base";
const CURSO_ID = parseInt(__ENV.CURSO_ID || "1", 10);
const THINK_TIME_MS = parseInt(__ENV.THINK_TIME_MS || "1500", 10);

// Default: rampa hasta 100 VUs durante 30s, sostener 1 min, bajar 30s.
// Override con --vus / --duration en la línea de comandos.
export const options = {
    stages: [
        { duration: "30s", target: 100 },
        { duration: "1m",  target: 100 },
        { duration: "30s", target: 0 },
    ],
    thresholds: {
        // 95% de los requests deben responder en menos de 500ms
        http_req_duration: ["p(95)<500"],
        // Menos del 1% de errores HTTP aceptable
        http_req_failed: ["rate<0.01"],
        // Cada VU debe completar al menos 1 flujo completo en su sesión
        iterations: ["count>50"],
    },
};

// ---------- Helpers ----------
function post(path, body) {
    return http.post(`${BASE_URL}${path}`, JSON.stringify({ arg: JSON.stringify(body) }), {
        headers: { "Content-Type": "application/json" },
        tags: { endpoint: path },
    });
}

function parseOk(res, etiqueta) {
    if (res.status !== 200) {
        fail(`${etiqueta}: HTTP ${res.status}`);
    }
    let body;
    try {
        body = JSON.parse(res.body);
    } catch (_) {
        fail(`${etiqueta}: respuesta no es JSON`);
    }
    if (body.error) {
        fail(`${etiqueta}: error API = ${body.error.message}`);
    }
    return body.data;
}

// ---------- Flujo principal por VU ----------
export default function () {
    // Paso 1: aplicaciones activas del curso
    let res = post(`${PREFIX}/evaluacion/aplicacionesActivas`, { cursoId: CURSO_ID });
    check(res, { "aplicacionesActivas 200": (r) => r.status === 200 });
    const apls = parseOk(res, "aplicacionesActivas");
    if (!Array.isArray(apls) || apls.length === 0) {
        fail(`No hay aplicaciones activas en curso ${CURSO_ID}. Siembra la BD con AurisDB_INSTALL.sql.`);
    }
    // Elegimos una aplicación al azar
    const apl = apls[Math.floor(Math.random() * apls.length)];

    sleep(THINK_TIME_MS / 1000);

    // Paso 2: iniciar (carga preguntas, NO persiste)
    res = post(`${PREFIX}/evaluacion/iniciar`, {
        aplicacionId: apl.aplicacion_id,
        modalidad: Math.random() < 0.5 ? "ANONIMA" : "IDENTIFICADA",
        correo: "carga@uv.cl",
    });
    check(res, { "iniciar 200": (r) => r.status === 200 });
    const ev = parseOk(res, "iniciar");

    if (!ev.preguntas || ev.preguntas.length === 0) {
        fail("iniciar devolvió un test sin preguntas");
    }

    // Paso 3: corregir cada pregunta (NO persiste, solo simula clicks)
    const respuestas = [];
    for (const p of ev.preguntas) {
        sleep(THINK_TIME_MS / 1000);
        // Elegimos la primera alternativa (no nos importa si es correcta — esto
        // mide carga, no calidad pedagógica)
        const alt = p.alternativas[0];

        res = post(`${PREFIX}/evaluacion/corregir`, {
            aplicacionId: ev.aplicacion_id,
            preguntaId: p.pregunta_id,
            alternativaId: alt.alternativa_id,
            intento: 1,
        });
        check(res, { "corregir 200": (r) => r.status === 200 });
        const corr = parseOk(res, "corregir");

        respuestas.push({
            preguntaId: p.pregunta_id,
            ordenPresentacion: p.orden_presentacion,
            alternativaIntento1Id: alt.alternativa_id,
            alternativaIntento2Id: null,
            tiempoSegundos: Math.floor(THINK_TIME_MS / 1000),
        });

        // Si no fue correcta y permite reintentar, gastamos el intento 2
        if (corr.puedeReintentar && p.alternativas.length > 1) {
            sleep(THINK_TIME_MS / 1000);
            const alt2 = p.alternativas[1];
            res = post(`${PREFIX}/evaluacion/corregir`, {
                aplicacionId: ev.aplicacion_id,
                preguntaId: p.pregunta_id,
                alternativaId: alt2.alternativa_id,
                intento: 2,
            });
            check(res, { "corregir intento 2 200": (r) => r.status === 200 });
            parseOk(res, "corregir intento 2");

            // Reemplazamos la respuesta para incluir el intento 2
            respuestas[respuestas.length - 1].alternativaIntento2Id = alt2.alternativa_id;
        }
    }

    sleep(THINK_TIME_MS / 1000);

    // Paso 4: enviar (ÚNICA operación que persiste — transacción atómica)
    res = post(`${PREFIX}/evaluacion/enviar`, {
        aplicacionId: ev.aplicacion_id,
        modalidad: ev.modalidad,
        correo: ev.correo,
        respuestas,
    });
    check(res, {
        "enviar 200": (r) => r.status === 200,
        "enviar devuelve evaluacion_id": (r) => {
            try {
                return JSON.parse(r.body).data?.evaluacion_id != null;
            } catch (_) { return false; }
        },
    });
    parseOk(res, "enviar");

    // Pausa entre iteraciones (un VU vuelve a empezar)
    sleep(THINK_TIME_MS / 1000);
}

/**
 * Resumen final personalizado. k6 lo imprime al terminar la corrida.
 */
export function handleSummary(data) {
    const m = data.metrics;
    const stdout = [
        "",
        "==================================================================",
        "  Resumen — flujo de evaluación bajo carga",
        "==================================================================",
        `  Flujos completados:            ${m.iterations?.values?.count ?? 0}`,
        `  Requests totales:              ${m.http_reqs?.values?.count ?? 0}`,
        `  Errores HTTP (%):              ${((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}`,
        `  Latencia p95:                  ${(m.http_req_duration?.values?.["p(95)"] ?? 0).toFixed(0)} ms`,
        `  Latencia p99:                  ${(m.http_req_duration?.values?.["p(99)"] ?? 0).toFixed(0)} ms`,
        `  Latencia máxima:               ${(m.http_req_duration?.values?.max ?? 0).toFixed(0)} ms`,
        `  Throughput:                    ${(m.http_reqs?.values?.rate ?? 0).toFixed(1)} req/s`,
        "==================================================================",
        "",
    ].join("\n");
    return {
        "stdout": stdout,
        "tests/loadtest/last-summary.json": JSON.stringify(data, null, 2),
    };
}
