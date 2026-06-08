"use strict";

var dateFormat = require("dateformat");
var requestContext = require("./requestContext");

// Logging estructurado opcional (ISO 25010 — Observabilidad): si LOG_JSON=1 (o
// "true") cada línea sale como un objeto JSON de una línea, listo para un
// agregador (ELK, Datadog, Loki). Por defecto, formato legible para desarrollo.
// En ambos modos se incluye el id de correlación del request.
const JSON_MODE = process.env.LOG_JSON === "1" || process.env.LOG_JSON === "true";

let _getDateFormat = () => {
    return dateFormat(new Date(), "dd/mm/yyyy HH:MM:ss");
};

let _reqTag = () => {
    let id = requestContext.getId();
    return id ? `[req:${String(id).slice(0, 8)}]` : "";
};

// Los Error no se serializan bien con JSON.stringify (quedan {}). Extraemos
// mensaje y stack para que el log JSON sea útil.
let _serialize = (v) => {
    if (v instanceof Error) return { message: v.message, stack: v.stack };
    return v;
};

let _emit = (level, fn, msg, moreMsg) => {
    const id = requestContext.getId();
    if (JSON_MODE) {
        const entry = { ts: new Date().toISOString(), level, service: "logica" };
        if (id) entry.req = id;
        entry.msg = _serialize(msg);
        if (moreMsg && moreMsg.length) {
            entry.extra = moreMsg.length === 1 ? _serialize(moreMsg[0]) : moreMsg.map(_serialize);
        }
        fn(JSON.stringify(entry));
    } else {
        const tag = _reqTag();
        if (moreMsg && moreMsg.length > 0) fn(_getDateFormat(), tag, msg, ...moreMsg);
        else fn(_getDateFormat(), tag, msg);
    }
};

let log = (msg, ...moreMsg) => {
    _emit("info", console.log, msg, moreMsg);
};

let error = (msg, ...moreMsg) => {
    _emit("error", console.error, msg, moreMsg);
};

module.exports = {
    log,
    error,
};
