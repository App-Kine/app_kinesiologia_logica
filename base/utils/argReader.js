"use strict";

/**
 * Utilidades compartidas para parseo y validación de inputs
 * (Bloque P3.R9 — auditoría ISO 25010).
 *
 * Centraliza el patrón duplicado que existía en cada service:
 *   - leerArg:    parseo del body que puede venir como { arg: JSON } o JSON puro
 *   - validarLongitud:    helper genérico de longitud
 *   - validarEmail:       formato RFC-like simple
 *   - intRequerido:       coerción + validación de id numérico
 *
 * Diseñado para ser importado desde cualquier service:
 *
 *     var { leerArg, validarLongitud } = require("../../base/utils/argReader");
 */

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parsea el body del request. Soporta dos formatos:
 *   - { arg: "<JSON urlencoded>" }  (convención original Auris)
 *   - JSON plano                     (fallback para clientes nuevos)
 *
 * Si el JSON viene malformado, loggea y devuelve {} en lugar de tirar.
 *
 * @param {object} request  Express request
 * @param {object} [opts]
 * @param {string} [opts.tag]  TAG para el log de error (ej. TAG_ERR del service)
 * @returns {object} body parseado
 */
function leerArg(request, opts) {
    const tag = (opts && opts.tag) || "[argReader]";
    try {
        if (request.body && typeof request.body.arg === "string") {
            return JSON.parse(request.body.arg);
        }
        return request.body || {};
    } catch (e) {
        if (global.logger) {
            global.logger.log(`${tag} leerArg: arg JSON inválido — ${e.message}`);
        }
        return {};
    }
}

/**
 * Valida que un campo string no exceda una longitud máxima.
 *
 * @param {string|null|undefined} valor
 * @param {number} max
 * @param {string} etiqueta  ej. "El nombre del curso"
 * @returns {string|null}    mensaje de error o null si OK
 */
function validarLongitud(valor, max, etiqueta) {
    if (typeof valor === "string" && valor.length > max) {
        return `${etiqueta} no puede superar ${max} caracteres`;
    }
    return null;
}

/**
 * Recorre múltiples campos con sus límites. Devuelve el primer error o null.
 *
 * @param {Array<{valor:any, max:number, etiqueta:string}>} reglas
 */
function validarLongitudes(reglas) {
    for (const r of reglas) {
        const err = validarLongitud(r.valor, r.max, r.etiqueta);
        if (err) return err;
    }
    return null;
}

/** True si el email pasa el regex (no garantiza entrega, solo formato). */
function esEmailValido(email) {
    return typeof email === "string" && RE_CORREO.test(email);
}

/**
 * Coerciona a entero positivo. Devuelve el número o null si no es válido.
 */
function aEnteroPositivo(v) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Coerciona a entero positivo opcional: devuelve null tanto si está vacío
 * como si es inválido. Útil para filtros opcionales (ej. profesorId).
 */
function aEnteroPositivoOpcional(v) {
    if (v === null || v === undefined || v === "") return null;
    return aEnteroPositivo(v);
}

/** Normaliza un string a trim() o null si queda vacío. */
function aStringOpcional(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
}

module.exports = {
    leerArg,
    validarLongitud,
    validarLongitudes,
    esEmailValido,
    aEnteroPositivo,
    aEnteroPositivoOpcional,
    aStringOpcional,
    RE_CORREO,
};
