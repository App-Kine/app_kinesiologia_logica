"use strict";

/**
 * Utilidades de seguridad compartidas.
 *
 *  - escapeHtml: escapa datos dinámicos antes de interpolarlos en HTML
 *    (correos, informes) para mitigar XSS almacenado/reflejado.
 *  - maskEmail: enmascara correos (PII) antes de loguearlos en claro.
 */

/**
 * Escapa los caracteres HTML peligrosos de un valor dinámico.
 * Mismo comportamiento que el _escapeHtml usado en el informe (RF-41).
 */
function escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Enmascara un correo para logs (PII). Ej: "ana@uv.cl" => "a***@uv.cl".
 * Si no parece un correo válido, devuelve un marcador genérico para no
 * filtrar el valor en claro.
 */
function maskEmail(correo) {
    if (!correo || typeof correo !== "string") return "(sin correo)";
    const at = correo.indexOf("@");
    if (at <= 0) return "(correo inválido)";
    const local = correo.slice(0, at);
    const dominio = correo.slice(at); // incluye "@"
    const visible = local.charAt(0);
    return `${visible}***${dominio}`;
}

module.exports = {
    escapeHtml,
    maskEmail,
};
