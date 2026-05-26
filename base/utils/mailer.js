"use strict";

/**
 * Helper de envío de correo.
 *
 * Modos (global.config.mail.mode):
 *   - "dev":  no envía nada real. Imprime el mensaje en consola y devuelve
 *             { delivered:false, mode:"dev", devLink }. El admin puede copiar
 *             el link manualmente desde la UI.
 *   - "smtp": envía de verdad con nodemailer usando global.config.mail.smtp
 *             { host, port, secure, user, password }. Devuelve
 *             { delivered:true, mode:"smtp", messageId }.
 *
 * El transporter SMTP se crea una sola vez (lazy) y se reutiliza.
 */

let nodemailer = null;
let _transporter = null;
let _transporterKey = null;

/** Crea/reutiliza el transporter SMTP según la config actual. */
function _getTransporter(smtp) {
    // Clave para detectar cambios de config y recrear si hace falta.
    const key = `${smtp.host}:${smtp.port}:${smtp.secure}:${smtp.user}`;
    if (_transporter && _transporterKey === key) return _transporter;

    if (!nodemailer) nodemailer = require("nodemailer");

    _transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: !!smtp.secure, // true => puerto 465 (SSL); false => 587 (STARTTLS)
        auth: {
            user: smtp.user,
            pass: smtp.password,
        },
    });
    _transporterKey = key;
    return _transporter;
}

async function send({ to, subject, html, text, devLink }) {
    const mailCfg = (global.config && global.config.mail) || { mode: "dev" };
    const stamp = new Date().toISOString();

    if (mailCfg.mode !== "smtp") {
        // ---- MODO DESARROLLO ----
        logger.log("");
        logger.log(`\x1b[33m========== [MAIL · DEV MODE] ${stamp} ==========\x1b[0m`);
        logger.log(`  Para:     ${to}`);
        logger.log(`  Asunto:   ${subject}`);
        if (devLink) logger.log(`  Link:     \x1b[36m${devLink}\x1b[0m`);
        if (text) {
            logger.log("  --- texto ---");
            text.split("\n").forEach((l) => logger.log("  " + l));
        }
        logger.log(`\x1b[33m================================================\x1b[0m`);
        logger.log("");

        return { delivered: false, mode: "dev", devLink: devLink || null };
    }

    // ---- MODO SMTP (envío real con nodemailer) ----
    const smtp = mailCfg.smtp || {};
    if (!smtp.host || !smtp.user || !smtp.password) {
        throw new Error(
            "Config SMTP incompleta: faltan host/user/password en global.config.mail.smtp"
        );
    }

    const transporter = _getTransporter(smtp);
    const from = mailCfg.from || smtp.user;

    try {
        const info = await transporter.sendMail({ from, to, subject, text, html });
        logger.log(`\x1b[32m[MAIL · SMTP]\x1b[0m enviado a ${to} (id=${info.messageId})`);
        return { delivered: true, mode: "smtp", messageId: info.messageId };
    } catch (e) {
        logger.log(`\x1b[31m[MAIL · SMTP]\x1b[0m error enviando a ${to}: ${e.message}`, e);
        throw e;
    }
}

module.exports = { send };
