"use strict";

/**
 * Contexto por request basado en AsyncLocalStorage (ISO 25010 — Observabilidad).
 *
 * La lógica lee la cabecera X-Request-Id que envía el gateway y la guarda acá,
 * para que el logger anteponga el mismo id de correlación a cada línea. Así un
 * request se puede seguir de punta a punta (gateway → lógica) en los logs.
 */

var { AsyncLocalStorage } = require("async_hooks");

var als = new AsyncLocalStorage();

function run(store, fn) {
    return als.run(store, fn);
}

function get() {
    return als.getStore() || null;
}

function getId() {
    var s = als.getStore();
    return s ? s.id : null;
}

module.exports = { als, run, get, getId };
