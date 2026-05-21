"use strict";

/**
 * Middleware JWT para rutas de la LÓGICA que el frontend llama directamente
 * (sin pasar por el controlador). Hoy lo usa el módulo de multimedia, donde
 * el archivo se sube como multipart/form-data directo a la lógica (puerto
 * 2000) y por eso no puede ir envuelto en el `arg=` del controlador.
 *
 * Valida el header `Authorization: Bearer <token>` con el mismo secreto
 * (global.config.security.jwtSecret) con que la lógica firma el access token
 * en auth.service.js. Si es válido, adjunta `request.usuario` con el payload:
 *   { sub, correo, nombre, roles }
 *
 * - requireAuth: exige token válido.
 * - requireRole(rol): exige token válido + que `roles` incluya `rol`.
 */

const jwt = require("jsonwebtoken");
const reply = require("./reply");

const TAG_ERR = "\x1b[31m[jwtAuth]\x1b[0m";

function _extraerToken(request) {
    const h = request.headers["authorization"] || request.headers["Authorization"];
    if (!h || typeof h !== "string") return null;
    const partes = h.trim().split(/\s+/);
    if (partes.length === 2 && /^Bearer$/i.test(partes[0])) {
        return partes[1];
    }
    // Permitir token "pelado" por si acaso
    if (partes.length === 1) return partes[0];
    return null;
}

function requireAuth(request, response, next) {
    const sec = (global.config && global.config.security) || {};
    if (!sec.jwtSecret) {
        return response.json(
            reply.fatal(new Error("JWT secret no configurado en env.security.jwtSecret"))
        );
    }

    const token = _extraerToken(request);
    if (!token) {
        return response.status(401).json(reply.error("Token ausente (RNF-19)"));
    }

    try {
        const payload = jwt.verify(token, sec.jwtSecret);
        request.usuario = {
            sub: payload.sub,
            correo: payload.correo,
            nombre: payload.nombre,
            roles: Array.isArray(payload.roles) ? payload.roles : [],
        };
        return next();
    } catch (e) {
        logger.log(`${TAG_ERR} token inválido: ${e.message}`);
        return response.status(401).json(reply.error("Token inválido o expirado"));
    }
}

function requireRole(rol) {
    return function (request, response, next) {
        requireAuth(request, response, function () {
            const roles = (request.usuario && request.usuario.roles) || [];
            if (!roles.includes(rol)) {
                return response
                    .status(403)
                    .json(reply.error(`Se requiere rol ${rol} (RF-58)`));
            }
            return next();
        });
    };
}

module.exports = {
    requireAuth,
    requireRole,
};
