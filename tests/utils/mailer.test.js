"use strict";

/**
 * Tests unitarios de base/utils/mailer.js
 *  - modo "dev": NO envía nada real → { delivered:false, mode:"dev" } y loguea.
 *  - modo "smtp": usa nodemailer (mockeado, nunca sale a la red), soporta
 *    attachments y configura timeouts en createTransport.
 *
 * nodemailer está mockeado: jamás se abre un socket SMTP.
 */

jest.mock("nodemailer", () => {
    const sendMail = jest.fn();
    const createTransport = jest.fn(() => ({ sendMail }));
    return { createTransport, __sendMail: sendMail };
});

const nodemailer = require("nodemailer");
const createTransportMock = nodemailer.createTransport;
const sendMailMock = nodemailer.__sendMail;

const mailer = require("../../base/utils/mailer");

describe("mailer.send — modo dev", () => {
    let logSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        global.config = { mail: { mode: "dev" } };
        logSpy = jest.spyOn(global.logger, "log").mockImplementation(() => {});
    });
    afterEach(() => logSpy.mockRestore());

    test("NO envía: devuelve delivered:false, mode:dev", async () => {
        const r = await mailer.send({
            to: "ana@uv.cl",
            subject: "Hola",
            text: "cuerpo",
            devLink: "http://x/link",
        });
        expect(r).toEqual({ delivered: false, mode: "dev", devLink: "http://x/link" });
        // En dev jamás se toca nodemailer.
        expect(createTransportMock).not.toHaveBeenCalled();
        expect(sendMailMock).not.toHaveBeenCalled();
    });

    test("loguea el correo (destinatario y asunto)", async () => {
        await mailer.send({ to: "ana@uv.cl", subject: "Asunto X", text: "t" });
        const loggedText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(loggedText).toMatch(/ana@uv\.cl/);
        expect(loggedText).toMatch(/Asunto X/);
    });

    test("loguea los adjuntos cuando hay attachments", async () => {
        await mailer.send({
            to: "ana@uv.cl",
            subject: "S",
            attachments: [{ filename: "informe.pdf", content: "AAA" }],
        });
        const loggedText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(loggedText).toMatch(/informe\.pdf/);
    });

    test("devLink null cuando no se pasa", async () => {
        const r = await mailer.send({ to: "a@b.cl", subject: "S" });
        expect(r.devLink).toBeNull();
    });
});

describe("mailer.send — modo smtp (nodemailer mockeado)", () => {
    let hostSeq = 0;
    beforeEach(() => {
        jest.clearAllMocks();
        sendMailMock.mockResolvedValue({ messageId: "msg-123" });
        createTransportMock.mockImplementation(() => ({ sendMail: sendMailMock }));
        // Host único por test: cambia la clave de cache del transporter en el
        // módulo (lazy/reutilizado), garantizando que createTransport se invoque
        // en cada test y las aserciones sobre sus args sean válidas.
        global.config = {
            mail: {
                mode: "smtp",
                from: "auris@uv.cl",
                smtp: {
                    host: `smtp${hostSeq++}.uv.cl`,
                    port: 587,
                    secure: false,
                    user: "auris@uv.cl",
                    password: "secreto",
                },
            },
        };
        jest.spyOn(global.logger, "log").mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    test("envía con nodemailer y devuelve delivered:true + messageId", async () => {
        const r = await mailer.send({
            to: "ana@uv.cl",
            subject: "Informe",
            html: "<b>hola</b>",
            text: "hola",
        });
        expect(r.delivered).toBe(true);
        expect(r.mode).toBe("smtp");
        expect(r.messageId).toBe("msg-123");
        expect(sendMailMock).toHaveBeenCalledTimes(1);
        const arg = sendMailMock.mock.calls[0][0];
        expect(arg.to).toBe("ana@uv.cl");
        expect(arg.from).toBe("auris@uv.cl");
    });

    test("configura timeouts en createTransport (Disponibilidad ISO 25010)", async () => {
        await mailer.send({ to: "ana@uv.cl", subject: "S", text: "t" });
        expect(createTransportMock).toHaveBeenCalled();
        const cfg = createTransportMock.mock.calls[0][0];
        expect(cfg.connectionTimeout).toBeGreaterThan(0);
        expect(cfg.greetingTimeout).toBeGreaterThan(0);
        expect(cfg.socketTimeout).toBeGreaterThan(0);
    });

    test("pasa attachments a sendMail cuando hay adjuntos", async () => {
        const attachments = [
            { filename: "informe.pdf", content: "QkFTRTY0", encoding: "base64" },
        ];
        await mailer.send({ to: "ana@uv.cl", subject: "S", text: "t", attachments });
        const arg = sendMailMock.mock.calls[0][0];
        expect(arg.attachments).toEqual(attachments);
    });

    test("sin attachments NO incluye el campo attachments", async () => {
        await mailer.send({ to: "ana@uv.cl", subject: "S", text: "t" });
        const arg = sendMailMock.mock.calls[0][0];
        expect(arg.attachments).toBeUndefined();
    });

    test("config SMTP incompleta tira error claro", async () => {
        global.config.mail.smtp = { host: "", user: "", password: "" };
        await expect(
            mailer.send({ to: "a@b.cl", subject: "S", text: "t" })
        ).rejects.toThrow(/Config SMTP incompleta/);
    });

    test("propaga el error si sendMail falla", async () => {
        sendMailMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
        await expect(
            mailer.send({ to: "a@b.cl", subject: "S", text: "t" })
        ).rejects.toThrow(/ETIMEDOUT/);
    });
});
