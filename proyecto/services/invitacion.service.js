"use strict";

/**
 * Service de invitaciones de profesor.
 * Cubre RF-76 a RF-87, RNF-12.
 */

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const reply = require("../../base/utils/reply");
const mailer = require("../../base/utils/mailer");
const invRepo = require("../repositories/invitacion.repository");
const usuarioRepo = require("../repositories/usuario.repository");

/* ---------- helpers ---------- */

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

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RE_PASSWORD = {
    minLen: 10,
    upper: /[A-Z]/,
    lower: /[a-z]/,
    digit: /[0-9]/,
    symbol: /[^A-Za-z0-9]/,
};

/** Valida política de password RNF-13. Devuelve array de errores, vacío si OK. */
function _validarPassword(p) {
    const errs = [];
    if (!p || p.length < RE_PASSWORD.minLen)
        errs.push("mínimo 10 caracteres");
    if (!RE_PASSWORD.upper.test(p)) errs.push("una mayúscula");
    if (!RE_PASSWORD.lower.test(p)) errs.push("una minúscula");
    if (!RE_PASSWORD.digit.test(p)) errs.push("un número");
    if (!RE_PASSWORD.symbol.test(p)) errs.push("un símbolo");
    return errs;
}

/* ---------- 1) Admin invita ---------- */

/**
 * POST /base_logica/crearInvitacion
 * body.arg = { correo, creadaPor }
 * Devuelve { invitacion_id, expira_en, link } (link visible solo en modo dev).
 */
async function crear(request, response) {
    try {
        const args = _leerArg(request);
        const correoRaw = (args.correo || "").trim();
        const correo = correoRaw.toLowerCase();
        const creadaPor = args.creadaPor; // viene del controlador después de validar JWT admin

        if (!correo || !RE_CORREO.test(correo)) {
            return response.json(reply.error("Correo inválido"));
        }
        if (!creadaPor) {
            return response.json(reply.error("Falta identificar al admin que invita"));
        }

        // RF-86: no permitir invitar a un correo ya registrado
        if (await usuarioRepo.correoYaRegistrado(correo)) {
            return response.json(
                reply.error("Ya existe un usuario con ese correo")
            );
        }

        // RF-78: si hay una pendiente previa, marcarla como REENVIADA
        const previa = await invRepo.buscarPendientePorCorreo(correo);
        if (previa) await invRepo.marcarReenviada(previa.invitacion_id);

        // Generar token cripto-seguro (RNF-12)
        const tokenPlano = crypto.randomBytes(48).toString("hex"); // 96 hex chars
        const tokenHash = _sha256Hex(tokenPlano);

        // Expiración (config), máximo 48h por RNF-12
        const horas = Math.min(
            (global.config.invitaciones && global.config.invitaciones.expiraHoras) || 24,
            48
        );
        const expiraEn = new Date();
        expiraEn.setHours(expiraEn.getHours() + horas);

        // Guardar
        const invitacionId = await invRepo.crearInvitacion(
            correo,
            tokenHash,
            expiraEn,
            creadaPor,
            previa ? previa.invitacion_id : null
        );

        // Construir el link
        const frontBase =
            (global.config.frontend && global.config.frontend.baseUrl) ||
            "http://localhost:8100";
        const link = `${frontBase}/registro-profesor/${tokenPlano}`;

        // Enviar correo. La invitación ya está guardada, así que capturamos el
        // fallo de envío aparte para informar con claridad (sin tirar 500).
        let correoEnviado = false;
        let modo = "dev";
        try {
            const envio = await mailer.send({
                to: correo,
                subject: "Invitación a Auris — completa tu registro",
                text: `Hola,\n\nEl administrador de Auris te invitó a registrarte como profesor.\nHaz clic en el siguiente enlace para crear tu cuenta:\n\n${link}\n\nEste enlace expira el ${expiraEn.toISOString()} (en ${horas} horas).\nSi no esperabas esta invitación puedes ignorar este correo.\n\n— Equipo Auris`,
                html: `<p>Hola,</p><p>El administrador de Auris te invitó a registrarte como profesor.</p><p><a href="${link}">Completa tu registro aquí</a></p><p>Este enlace expira en ${horas} horas.</p>`,
                devLink: link,
            });
            modo = (envio && envio.mode) || "dev";
            correoEnviado = !!(envio && envio.delivered); // true solo en SMTP real
        } catch (mailErr) {
            logger.log(`\x1b[31m[invitacion]\x1b[0m correo NO enviado a ${correo}: ${mailErr.message}`);
            correoEnviado = false;
            modo = "smtp";
        }

        const esDev = modo === "dev";
        response.json(
            reply.ok({
                invitacion_id: invitacionId,
                correo_destino: correo,
                expira_en: expiraEn.toISOString(),
                correo_enviado: correoEnviado, // true = salió por SMTP real
                modo: modo,                     // "dev" | "smtp"
                // El enlace solo se expone en modo dev (respaldo de pruebas).
                // En modo real el profesor lo recibe por correo.
                link: esDev ? link : null,
            })
        );
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/* ---------- 2) Verificar el token al abrir el link ---------- */

/**
 * POST /base_logica/verificarInvitacion
 * body.arg = { token }
 * Devuelve { invitacion_id, correo_destino, expira_en } si está vigente.
 */
async function verificar(request, response) {
    try {
        const args = _leerArg(request);
        const token = (args.token || "").trim();
        if (!token) return response.json(reply.error("Token requerido"));

        const tokenHash = _sha256Hex(token);
        const inv = await invRepo.buscarPorTokenHash(tokenHash);

        if (!inv) {
            return response.json(reply.error("Invitación inválida"));
        }

        if (inv.estado === "COMPLETADA") {
            return response.json(
                reply.error("Esta invitación ya fue utilizada")
            );
        }
        if (inv.estado === "REENVIADA") {
            return response.json(
                reply.error("Esta invitación fue reemplazada por una nueva. Busca el correo más reciente.")
            );
        }
        if (inv.estado === "EXPIRADA" || new Date(inv.expira_en) < new Date()) {
            return response.json(
                reply.error("Esta invitación expiró. Solicita una nueva al administrador.")
            );
        }

        response.json(
            reply.ok({
                invitacion_id: inv.invitacion_id,
                correo_destino: inv.correo_destino,
                expira_en: inv.expira_en,
            })
        );
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/* ---------- 3) Completar el registro ---------- */

/**
 * POST /base_logica/completarInvitacion
 * body.arg = { token, nombre, password }
 * Crea el usuario con rol PROFESOR (RF-81).
 */
async function completar(request, response) {
    try {
        const args = _leerArg(request);
        const token = (args.token || "").trim();
        const nombre = (args.nombre || "").trim();
        const password = args.password || "";

        if (!token) return response.json(reply.error("Token requerido"));
        if (!nombre || nombre.length < 2)
            return response.json(reply.error("Nombre requerido"));

        // RF-80: validar política de password (RNF-13)
        const errs = _validarPassword(password);
        if (errs.length) {
            return response.json(
                reply.error(
                    "La contraseña debe incluir: " + errs.join(", ")
                )
            );
        }

        // Re-validar invitación (RF-82)
        const tokenHash = _sha256Hex(token);
        const inv = await invRepo.buscarPorTokenHash(tokenHash);
        if (!inv || inv.estado !== "PENDIENTE") {
            return response.json(reply.error("Invitación no disponible"));
        }
        if (new Date(inv.expira_en) < new Date()) {
            return response.json(reply.error("Invitación expirada"));
        }

        // Race-protection: por si en paralelo se creó el usuario
        if (await usuarioRepo.correoYaRegistrado(inv.correo_destino)) {
            await invRepo.marcarCompletada(inv.invitacion_id, null);
            return response.json(
                reply.error("Ya existe un usuario con ese correo")
            );
        }

        // bcrypt (RNF-11)
        const rounds =
            (global.config.security && global.config.security.bcryptRounds) || 12;
        const passwordHash = bcrypt.hashSync(password, rounds);

        // Crear usuario + asignar rol PROFESOR
        const usuarioId = await usuarioRepo.crearUsuarioProfesor(
            nombre,
            inv.correo_destino,
            passwordHash
        );

        // Marcar invitación como completada
        await invRepo.marcarCompletada(inv.invitacion_id, usuarioId);

        response.json(
            reply.ok({
                usuario_id: usuarioId,
                correo: inv.correo_destino,
                nombre: nombre,
            })
        );
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/* ---------- 4) Admin lista invitaciones ---------- */

/**
 * POST /base_logica/listarInvitaciones
 * Devuelve array de invitaciones (con estado actualizado, RF-83).
 */
async function listar(request, response) {
    try {
        await invRepo.marcarPendientesVencidasComoExpiradas();
        const items = await invRepo.listarTodas();
        response.json(reply.ok(items));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

module.exports = {
    crear,
    verificar,
    completar,
    listar,
};
