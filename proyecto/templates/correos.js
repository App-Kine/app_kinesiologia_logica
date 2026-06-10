"use strict";

/**
 * Plantillas de correo (HTML + texto plano) de Auris.
 *
 * Diseño "email-safe": layout con TABLAS + CSS INLINE (no flexbox/grid, no
 * <style> externo), que es lo único que renderiza consistente en Gmail,
 * Outlook, Apple Mail, etc. Incluye:
 *   - preheader oculto (texto de preview del inbox),
 *   - botón CTA "bulletproof" (tabla + ancla con padding/bgcolor),
 *   - fallback con el enlace en texto por si el botón no abre,
 *   - versión `text` plana (fallback y modo dev).
 *
 * Uso:
 *   const correos = require("../templates/correos");
 *   const { subject, html, text } = correos.invitacionProfesor({ link, horas, expiraEn });
 *   await mailer.send({ to, subject, html, text });
 */

const BRAND = {
    azul: "#1565c0",
    azulOscuro: "#0d47a1",
    texto: "#1f2933",
    textoSuave: "#52606d",
    borde: "#e4e7eb",
    fondo: "#f4f6fb",
    blanco: "#ffffff",
};

/** Escapa texto para insertarlo seguro en HTML/atributos. */
function _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));
}

/** Fecha legible en español; cae a ISO si la locale no está disponible. */
function _fechaLegible(d) {
    try {
        return new Date(d).toLocaleString("es-CL", {
            dateStyle: "long",
            timeStyle: "short",
        });
    } catch (e) {
        return new Date(d).toISOString();
    }
}

/**
 * Shell HTML branded reutilizable.
 * `contenido` debe ser HTML ya armado (confiable, no proviene del usuario).
 */
function layout({ preheader = "", titulo = "Auris", contenido = "" }) {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${_esc(titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.fondo};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.fondo};font-size:1px;line-height:1px;">${_esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.fondo};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${BRAND.blanco};border:1px solid ${BRAND.borde};border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="background:${BRAND.azul};padding:20px 28px;">
          <span style="font-size:22px;font-weight:700;letter-spacing:1px;color:#ffffff;">AURIS</span>
          <span style="display:block;margin-top:2px;font-size:12px;color:#cfe0f7;">Plataforma de auscultación clínica</span>
        </td></tr>
        <tr><td style="padding:28px;color:${BRAND.texto};font-size:15px;line-height:1.6;">
${contenido}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#fafbfc;border-top:1px solid ${BRAND.borde};color:${BRAND.textoSuave};font-size:12px;line-height:1.5;">
          Auris — Universidad de Valparaíso · Kinesiología.<br>
          Este es un correo automático, por favor no respondas.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Botón CTA "bulletproof" (tabla + ancla con padding y bgcolor). */
function boton(href, etiqueta) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr>
            <td align="center" bgcolor="${BRAND.azul}" style="border-radius:8px;">
              <a href="${_esc(href)}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:${BRAND.azul};">${_esc(etiqueta)}</a>
            </td></tr></table>`;
}

/**
 * Invitación para registrarse como PROFESOR.
 * @param {{ link:string, horas:number, expiraEn?:(Date|string) }} d
 * @returns {{ subject:string, html:string, text:string }}
 */
function invitacionProfesor({ link, horas, expiraEn }) {
    const venceTxt = `${horas} ${Number(horas) === 1 ? "hora" : "horas"}`;
    const contenido = `
          <h1 style="margin:0 0 14px;font-size:20px;color:${BRAND.azulOscuro};">Te invitaron a Auris</h1>
          <p style="margin:0 0 14px;">Hola,</p>
          <p style="margin:0 0 18px;">El administrador de <strong>Auris</strong> te invitó a registrarte como <strong>profesor</strong>. Con tu cuenta vas a poder gestionar cursos, preguntas, tests y ver la analítica de tus estudiantes.</p>
          ${boton(link, "Completar mi registro")}
          <p style="margin:18px 0 6px;color:${BRAND.textoSuave};font-size:13px;">Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>
          <p style="margin:0 0 18px;word-break:break-all;"><a href="${_esc(link)}" style="color:${BRAND.azul};font-size:13px;">${_esc(link)}</a></p>
          <div style="margin:0;padding:12px 14px;background:#fff8e1;border-left:3px solid #ffb300;border-radius:6px;color:#5d4200;font-size:13px;">
            ⏱ Por seguridad, este enlace <strong>vence en ${_esc(venceTxt)}</strong>${expiraEn ? ` (${_esc(_fechaLegible(expiraEn))})` : ""}.
          </div>
          <p style="margin:16px 0 0;color:${BRAND.textoSuave};font-size:13px;">Si no esperabas esta invitación, podés ignorar este correo.</p>`;

    const text = `Hola,

El administrador de Auris te invitó a registrarte como profesor.
Completá tu registro en este enlace:

${link}

Por seguridad, el enlace vence en ${venceTxt}.
Si no esperabas esta invitación, ignorá este correo.

— Equipo Auris`;

    return {
        subject: "Invitación a Auris — completá tu registro",
        html: layout({
            preheader: "Completá tu registro como profesor en Auris.",
            titulo: "Invitación a Auris",
            contenido,
        }),
        text,
    };
}

module.exports = { layout, boton, invitacionProfesor };
