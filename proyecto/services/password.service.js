"use strict";

/**
 * Service de recuperación de contraseña (RF-59).
 *
 * Flujo:
 *  1) solicitar: el usuario pide reseteo con su correo. Se CORROBORA que exista
 *     una cuenta activa con ese correo; si NO existe, se rechaza la solicitud
 *     (pedido del cliente). Si existe, se genera un token de un solo uso, se
 *     guarda su hash y se envía un enlace por correo (mailer en modo dev = solo
 *     loguea / devuelve devLink).
 *     NOTA: rechazar correos inexistentes revela cuáles están registrados
 *     (enumeración); es un trade-off de UX aceptado explícitamente.
 *  2) resetear: con el token + nueva contraseña (política RNF-13), se valida el
 *     token (vigente y no usado), se hashea con bcrypt (RNF-11) y se actualiza.
 */

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const reply = require("../../base/utils/reply");
const mailer = require("../../base/utils/mailer");
const { escapeHtml, maskEmail } = require("../../base/utils/seguridad");
const pwRepo = require("../repositories/password.repository");

const TAG = "\x1b[36m[password]\x1b[0m";
const TAG_ERR = "\x1b[31m[password]\x1b[0m";

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_MIN = 60; // RF-59: enlace corto (1 hora)

function _leerArg(request) {
    try {
        if (request.body && typeof request.body.arg === "string") {
            return JSON.parse(request.body.arg);
        }
        return request.body || {};
    } catch (e) {
        return {};
    }
}

function _sha256Hex(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}

/** Política de contraseña RNF-13. Devuelve array de errores (vacío = OK). */
function _validarPassword(p) {
    const errs = [];
    if (!p || p.length < 10) errs.push("mínimo 10 caracteres");
    if (!/[A-Z]/.test(p)) errs.push("una mayúscula");
    if (!/[a-z]/.test(p)) errs.push("una minúscula");
    if (!/[0-9]/.test(p)) errs.push("un número");
    if (!/[^A-Za-z0-9]/.test(p)) errs.push("un símbolo");
    return errs;
}

/**
 * POST /base_logica/solicitarReset  body.arg = { correo }
 * Siempre responde OK. En modo dev devuelve `devLink` para poder probar.
 */
async function solicitar(request, response) {
    const b = _leerArg(request);
    const correo = (b.correo || "").trim().toLowerCase();
    logger.log(`${TAG} solicitar: correo=${maskEmail(correo)}`);
    try {
        if (!correo || !RE_CORREO.test(correo)) {
            return response.json(reply.error("Correo inválido"));
        }

        const usuario = await pwRepo.buscarUsuarioActivoPorCorreo(correo);

        // Pedido del cliente: CORROBORAR que el correo exista en la BD. Si no hay
        // una cuenta activa con ese correo, se RECHAZA la solicitud y no se envía
        // nada (el frontend muestra el error y no deja continuar).
        // NOTA DE SEGURIDAD: esto revela si un correo está registrado
        // (enumeración de cuentas), a diferencia de la respuesta neutra anterior.
        // Es un trade-off de usabilidad pedido explícitamente.
        if (!usuario) {
            logger.log(`${TAG} solicitar: correo no registrado → rechazado`);
            return response.json(
                reply.error("No existe una cuenta activa con ese correo.")
            );
        }

        await pwRepo.invalidarResetsPrevios(usuario.usuario_id);

        const tokenPlano = crypto.randomBytes(48).toString("hex");
        const tokenHash = _sha256Hex(tokenPlano);
        const expiraEn = new Date();
        expiraEn.setMinutes(expiraEn.getMinutes() + RESET_TTL_MIN);

        await pwRepo.crearReset(usuario.usuario_id, tokenHash, expiraEn);

        const frontBase =
            (global.config.frontend && global.config.frontend.baseUrl) ||
            "http://localhost:4200";
        const link = `${frontBase}/restablecer-password/${tokenPlano}`;

        const r = await mailer.send({
            to: correo,
            subject: "Auris — recuperación de contraseña",
            text: `Hola ${usuario.nombre || ""},\n\nRecibimos una solicitud para restablecer tu contraseña.\nAbre el siguiente enlace (válido por ${RESET_TTL_MIN} minutos):\n\n${link}\n\nSi no fuiste tú, ignora este correo.\n\n— Equipo Auris`,
            html: `<p>Hola ${escapeHtml(usuario.nombre || "")},</p><p>Recibimos una solicitud para restablecer tu contraseña.</p><p><a href="${link}">Restablecer mi contraseña</a></p><p>El enlace vence en ${RESET_TTL_MIN} minutos. Si no fuiste tú, ignora este correo.</p>`,
            devLink: link,
        });
        const devLink = r && r.devLink ? r.devLink : null;
        logger.log(`${TAG} solicitar: token emitido para usuario_id=${usuario.usuario_id}`);

        response.json(
            reply.ok({
                mensaje:
                    "Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo.",
                devLink: devLink, // solo presente en modo dev
            })
        );
    } catch (e) {
        logger.log(`${TAG_ERR} solicitar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /base_logica/resetearPassword  body.arg = { token, password }
 */
async function resetear(request, response) {
    const b = _leerArg(request);
    const token = (b.token || "").trim();
    const password = b.password || "";
    logger.log(`${TAG} resetear: token=${token ? token.slice(0, 8) + "…" : "(vacío)"}`);
    try {
        if (!token) return response.json(reply.error("Token requerido"));

        const errs = _validarPassword(password);
        if (errs.length) {
            return response.json(
                reply.error("La contraseña debe incluir: " + errs.join(", "))
            );
        }

        const reset = await pwRepo.buscarPorTokenHash(_sha256Hex(token));
        if (!reset) {
            return response.json(reply.error("Enlace inválido"));
        }
        if (reset.usado_en) {
            return response.json(reply.error("Este enlace ya fue utilizado"));
        }
        if (new Date(reset.expira_en) < new Date()) {
            return response.json(reply.error("El enlace expiró. Solicita uno nuevo."));
        }

        const rounds =
            (global.config.security && global.config.security.bcryptRounds) || 12;
        const passwordHash = await bcrypt.hash(password, rounds);

        await pwRepo.aplicarNuevaPassword(reset.reset_id, reset.usuario_id, passwordHash);

        logger.log(`${TAG} resetear: OK usuario_id=${reset.usuario_id}`);
        response.json(reply.ok({ ok: true }));
    } catch (e) {
        logger.log(`${TAG_ERR} resetear: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /base_logica/cambiarPassword  body.arg = { usuario_id, passwordActual, passwordNueva }
 *
 * Cambio de contraseña del usuario AUTENTICADO. El `usuario_id` lo inyecta el
 * controlador desde el JWT verificado (NO viene del cliente). Verifica la clave
 * actual con bcrypt, valida la nueva (RNF-13) y que sea distinta de la actual.
 */
async function cambiar(request, response) {
    const b = _leerArg(request);
    const usuarioId = b.usuario_id;
    const actual = b.passwordActual || "";
    const nueva = b.passwordNueva || "";
    logger.log(`${TAG} cambiar: usuario_id=${usuarioId}`);
    try {
        if (!usuarioId) return response.json(reply.error("Sesión no válida"));
        if (!actual || !nueva) {
            return response.json(reply.error("Debes ingresar la contraseña actual y la nueva"));
        }

        const u = await pwRepo.obtenerPorId(usuarioId);
        if (!u || !u.activo) {
            return response.json(reply.error("Usuario no encontrado o inactivo"));
        }

        if (!(await bcrypt.compare(actual, u.password_hash))) {
            return response.json(reply.error("La contraseña actual no es correcta"));
        }

        const errs = _validarPassword(nueva);
        if (errs.length) {
            return response.json(
                reply.error("La nueva contraseña debe incluir: " + errs.join(", "))
            );
        }

        if (await bcrypt.compare(nueva, u.password_hash)) {
            return response.json(
                reply.error("La nueva contraseña debe ser distinta de la actual")
            );
        }

        const rounds =
            (global.config.security && global.config.security.bcryptRounds) || 12;
        const nuevoHash = await bcrypt.hash(nueva, rounds);
        await pwRepo.cambiarPasswordPorId(usuarioId, nuevoHash);

        logger.log(`${TAG} cambiar: OK usuario_id=${usuarioId}`);
        response.json(reply.ok({ ok: true }));
    } catch (e) {
        logger.log(`${TAG_ERR} cambiar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    solicitar,
    resetear,
    cambiar,
};
