"use strict";

/**
 * Service de autenticación.
 * Cubre: RF-52..RF-57, RF-60, RNF-11, RNF-16..RNF-18.
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const reply = require("../../base/utils/reply");
const usuarioRepo = require("../repositories/usuario.repository");

/**
 * El controlador nos envía la data como `arg=<urlencoded JSON>`.
 * Esta función desempaqueta y devuelve el objeto.
 */
function _leerArg(request) {
    try {
        if (request.body && typeof request.body.arg === "string") {
            return JSON.parse(request.body.arg);
        }
        // fallback: si llega como JSON puro
        return request.body || {};
    } catch (e) {
        return {};
    }
}

function _ipOrigen(req) {
    return (
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.socket.remoteAddress ||
        null
    );
}

function _userAgent(req) {
    return (req.headers["user-agent"] || "").substring(0, 400);
}

function _sha256Hex(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * POST /base_logica/login
 * Body (desde controlador): arg = JSON.stringify({correo, password})
 *
 * Respuesta OK:
 * {
 *   token:        "<JWT access>",
 *   refreshToken: "<random hex>",
 *   tokenType:    "Bearer",
 *   expiresIn:    "8h",
 *   usuario: { usuario_id, nombre, correo, roles: [...] }
 * }
 *
 * Respuesta error: mensaje genérico "Credenciales inválidas" (RF-57).
 */
async function login(request, response) {
    const args = _leerArg(request);
    const correo = (args.correo || "").trim().toLowerCase();
    const password = args.password || "";
    const ip = _ipOrigen(request);
    const ua = _userAgent(request);

    const sec = (global.config && global.config.security) || {};
    const maxIntentos = sec.loginBlockMaxAttempts || 5;
    const ventanaMin = sec.loginBlockWindowMinutes || 15;

    try {
        if (!correo || !password) {
            return response.json(
                reply.error("Credenciales inválidas")
            );
        }

        // 1) Bloqueo por intentos fallidos (RF-60)
        const fallidos = await usuarioRepo.contarIntentosFallidosRecientes(
            correo,
            ventanaMin
        );
        if (fallidos >= maxIntentos) {
            // No revelamos si la cuenta existe ni damos pistas (RF-57).
            // Pero registramos el intento bloqueado.
            await usuarioRepo.registrarIntentoLogin(correo, false, ip);
            return response.json(
                reply.error(
                    `Cuenta bloqueada por ${ventanaMin} minutos tras ${maxIntentos} intentos fallidos.`
                )
            );
        }

        // 2) Lookup usuario
        const u = await usuarioRepo.findByCorreo(correo);
        if (!u || !u.activo) {
            await usuarioRepo.registrarIntentoLogin(correo, false, ip);
            return response.json(reply.error("Credenciales inválidas"));
        }

        // 3) Comparar password
        const ok = bcrypt.compareSync(password, u.password_hash);
        if (!ok) {
            await usuarioRepo.registrarIntentoLogin(correo, false, ip);
            return response.json(reply.error("Credenciales inválidas"));
        }

        // 4) Roles
        const roles = await usuarioRepo.findRoles(u.usuario_id);

        // 5) Firmar JWT (RNF-16, RNF-17)
        if (!sec.jwtSecret) {
            return response.json(
                reply.fatal(
                    new Error("JWT secret no configurado en env.security.jwtSecret")
                )
            );
        }
        const accessToken = jwt.sign(
            {
                sub: u.usuario_id,
                correo: u.correo,
                nombre: u.nombre,
                roles: roles,
            },
            sec.jwtSecret,
            { expiresIn: sec.jwtAccessExpiresIn || "8h" }
        );

        // 6) Refresh token: string aleatorio; almacenamos solo el hash (RNF-18)
        const refreshTokenPlain = crypto.randomBytes(48).toString("hex");
        const refreshTokenHash = _sha256Hex(refreshTokenPlain);
        const expiraRefresh = new Date();
        expiraRefresh.setDate(expiraRefresh.getDate() + 7);
        await usuarioRepo.guardarRefreshToken(
            u.usuario_id,
            refreshTokenHash,
            expiraRefresh,
            ip,
            ua
        );

        // 7) Registrar intento exitoso
        await usuarioRepo.registrarIntentoLogin(correo, true, ip);

        // 8) Responder al controlador
        response.json(
            reply.ok({
                token: accessToken,
                refreshToken: refreshTokenPlain,
                tokenType: "Bearer",
                expiresIn: sec.jwtAccessExpiresIn || "8h",
                usuario: {
                    usuario_id: u.usuario_id,
                    nombre: u.nombre,
                    correo: u.correo,
                    roles: roles,
                },
            })
        );
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

module.exports = {
    login,
};
