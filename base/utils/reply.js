"use strict";

const status_ok = "OK";
const status_error = "ERROR";

const type_error = "ERROR";
const type_fatal = "FATAL";

const code_error = "0";

var config = require("../../config");

let _createResp = (status, message, value, type, level, code, trace) => {
    let resp = {
        status: status,
    };

    if (value != undefined && value != null) {
        // Antes se hacía JSON.parse(JSON.stringify(value)): doble serialización
        // innecesaria. structuredClone hace una copia profunda en una sola
        // pasada nativa (mantiene el contrato de "copia distinta del original"
        // sin compartir referencias). Express serializa el response final.
        resp.data = structuredClone(value);
    }

    if (status == status_error) {
        // Confidencialidad (ISO 25010 — Seguridad): en producción NUNCA
        // exponemos el stack trace al cliente (fuga de rutas internas,
        // versiones, estructura del código). El logging del stack al servidor
        // se conserva en otras capas (CORS res.send / errorTracker). En dev se
        // mantiene el trace para depurar.
        const esProduccion = process.env.NODE_ENV === "production";
        let traceSalida;
        if (esProduccion) {
            traceSalida = "";
        } else {
            traceSalida =
                trace == undefined
                    ? ""
                    : trace instanceof Object
                    ? trace
                    : trace.split("\n");
        }

        resp.error = {
            type: type,
            level: level,
            code: code == undefined || code == null ? code_error : code,
            message: message,
            trace: traceSalida,
        };
    }

    return resp;
};

let ok = (value) => {
    if (value != undefined && value != null) {
        return _createResp(status_ok, null, value);
    } else {
        return _createResp(status_ok);
    }
};

let error = (error, code) => {
    if (error instanceof Error) {
        return _createResp(
            status_error,
            error.message,
            null,
            type_error,
            config.app.level,
            code,
            error.stack
        );
    } else {
        return _createResp(
            status_error,
            error,
            null,
            type_error,
            config.app.level,
            code
        );
    }
};

let fatal = (error, code) => {
    if (error instanceof Error) {
        return _createResp(
            status_error,
            error.message,
            null,
            type_fatal,
            config.app.level,
            code,
            error.stack
        );
    } else {
        if (error.hasOwnProperty("type")) {
            return _createResp(
                status_error,
                error.message,
                null,
                error.type,
                error.level,
                error.code,
                error.trace
            );
        } else {
            return _createResp(
                status_error,
                error,
                null,
                type_fatal,
                config.app.level,
                code
            );
        }
    }
};

let throwsError = (error) => {
    return _createResp(
        status_error,
        error.message,
        null,
        error.type,
        error.level,
        error.code,
        error.trace
    );
};

module.exports = {
    ok,
    error,
    fatal,
    throwsError,
};
