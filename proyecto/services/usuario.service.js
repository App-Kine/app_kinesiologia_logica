"use strict";

/**
 * Service de administración de usuarios (solo SUPERADMIN, vía controlador).
 * - listar: lista todos los usuarios internos con sus roles.
 * - cambiarEstado: activa/desactiva (soft-delete) un usuario.
 *
 * "Eliminar" = desactivar (activo = 0): el usuario deja de poder iniciar
 * sesión, pero se preserva la integridad referencial (cursos, tests, etc.).
 */

const reply = require("../../base/utils/reply");
const usuarioRepo = require("../repositories/usuario.repository");

const TAG = "\x1b[36m[usuario]\x1b[0m";
const TAG_ERR = "\x1b[31m[usuario]\x1b[0m";

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

/** POST /base_logica/listarUsuarios */
async function listar(request, response) {
    try {
        const items = await usuarioRepo.listarUsuarios();
        response.json(reply.ok(items));
    } catch (e) {
        logger.log(`${TAG_ERR} listar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /base_logica/cambiarEstadoUsuario
 * body.arg = { usuario_id, activo, solicitante_id }
 *
 * `solicitante_id` lo inyecta el controlador desde el JWT (quién hace la acción).
 * Al DESACTIVAR aplica dos guardas de seguridad:
 *   - no puedes desactivar tu propia cuenta;
 *   - no puedes desactivar al único superadmin activo.
 */
async function cambiarEstado(request, response) {
    const b = _leerArg(request);
    const usuarioId = Number(b.usuario_id);
    const activo = b.activo === true || b.activo === 1 || b.activo === "true";
    const solicitanteId = Number(b.solicitante_id);
    logger.log(`${TAG} cambiarEstado: usuario_id=${usuarioId} activo=${activo}`);
    try {
        if (!usuarioId) return response.json(reply.error("Usuario no válido"));

        if (!activo) {
            if (usuarioId === solicitanteId) {
                return response.json(
                    reply.error("No puedes eliminar tu propia cuenta.")
                );
            }
            if (await usuarioRepo.esUltimoSuperadminActivo(usuarioId)) {
                return response.json(
                    reply.error("No puedes eliminar al único superadministrador activo.")
                );
            }
        }

        const filas = await usuarioRepo.setActivoUsuario(usuarioId, activo);
        if (!filas) return response.json(reply.error("Usuario no encontrado"));

        response.json(reply.ok({ usuario_id: usuarioId, activo }));
    } catch (e) {
        logger.log(`${TAG_ERR} cambiarEstado: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    listar,
    cambiarEstado,
};
