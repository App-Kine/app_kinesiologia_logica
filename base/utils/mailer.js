"use strict";

/**
 * Helper de envío de correo.
 *
 * Modos:
 *   - "dev":  no envía nada real. Solo imprime el mensaje en consola y
 *             devuelve un objeto { delivered:false, devLink }. El admin
 *             podrá copiar el link manualmente desde la UI.
 *   - "smtp": (no implementado todavía) enviar con nodemailer.
 *
 * Se elige el modo con global.config.mail.mode.
 */

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

    // ---- MODO SMTP (placeholder) ----
    throw new Error(
        "Modo SMTP aún no implementado. Configura global.config.mail.mode='dev' o agrega nodemailer."
    );
}

module.exports = { send };
