"use strict";

/**
 * Tests de evaluacion.service → enviarInforme (RF-41/42).
 *
 * Cubre:
 *  - Idempotencia: si informe_enviado_en ya existe, NO reenvía correo.
 *  - Tolerancia a fallo de marcarInformeEnviado tras envío OK (no responde
 *    fatal → evita correos duplicados por reintento del cliente).
 *  - Validación de pdfBase64: base64 inválido o gigante se OMITE sin tirar,
 *    el correo sale igual.
 *  - Resolución por UUID público (no por id secuencial).
 *
 * evalRepo y mailer mockeados: sin BD ni SMTP.
 */

jest.mock("../../proyecto/repositories/evaluacion.repository", () => ({
    resolverIdPorUuid: jest.fn(),
    obtenerInforme: jest.fn(),
    obtenerDetallePorPregunta: jest.fn(),
    marcarInformeEnviado: jest.fn(),
}));
jest.mock("../../base/utils/mailer", () => ({ send: jest.fn() }));

const evalRepo = require("../../proyecto/repositories/evaluacion.repository");
const mailer = require("../../base/utils/mailer");
const evalService = require("../../proyecto/services/evaluacion.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

const UUID_OK = "11111111-2222-3333-4444-555555555555";

/** Informe base FINALIZADA + IDENTIFICADA, listo para enviar. */
function informeBase(extra) {
    return {
        evaluacion_id: 100,
        estado: "FINALIZADA",
        modalidad: "IDENTIFICADA",
        correo_estudiante: "alumno@uv.cl",
        test_nombre: "Test A",
        curso_nombre: "Kine",
        curso_codigo: "K1",
        total_preguntas: 1,
        aciertos_primer: 1,
        aciertos_segundo: 0,
        incorrectas: 0,
        porcentaje_global: 100,
        informe_enviado_en: null,
        ...extra,
    };
}

describe("evaluacion.service.enviarInforme", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        evalRepo.resolverIdPorUuid.mockResolvedValue(100);
        evalRepo.obtenerDetallePorPregunta.mockResolvedValue([]);
        mailer.send.mockResolvedValue({ delivered: false, mode: "dev" });
    });

    describe("resolución por UUID", () => {
        test("UUID inválido → error genérico, no toca obtenerInforme", async () => {
            const req = mockRequest({ evaluacionUuid: "no-es-uuid" });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);
            expect(res.jsonBody.error.message).toMatch(/evaluacionUuid requerido/);
            expect(evalRepo.obtenerInforme).not.toHaveBeenCalled();
        });

        test("UUID no resuelve a id → 'Evaluación no encontrada'", async () => {
            evalRepo.resolverIdPorUuid.mockResolvedValue(null);
            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);
            expect(res.jsonBody.error.message).toMatch(/no encontrada/i);
            expect(evalRepo.obtenerInforme).not.toHaveBeenCalled();
        });
    });

    describe("idempotencia", () => {
        test("si informe_enviado_en ya existe → NO reenvía correo", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(
                informeBase({ informe_enviado_en: "2026-06-01T10:00:00Z" })
            );
            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);

            expect(res.jsonBody.error).toBeUndefined();
            expect(res.jsonBody.data.yaEnviado).toBe(true);
            expect(res.jsonBody.data.enviado).toBe(true);
            // Crítico: no se vuelve a enviar el correo.
            expect(mailer.send).not.toHaveBeenCalled();
            expect(evalRepo.marcarInformeEnviado).not.toHaveBeenCalled();
        });
    });

    describe("estado / modalidad", () => {
        test("rechaza si no está FINALIZADA", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase({ estado: "EN_CURSO" }));
            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);
            expect(res.jsonBody.error.message).toMatch(/no está finalizada/i);
            expect(mailer.send).not.toHaveBeenCalled();
        });

        test("rechaza evaluación ANONIMA (sin correo)", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(
                informeBase({ modalidad: "ANONIMA", correo_estudiante: null })
            );
            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);
            expect(res.jsonBody.error.message).toMatch(/anónima/i);
            expect(mailer.send).not.toHaveBeenCalled();
        });
    });

    describe("tolerancia a fallo de marcarInformeEnviado", () => {
        test("correo OK pero marcar falla → responde OK igual (no fatal)", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase());
            mailer.send.mockResolvedValue({ delivered: true, mode: "smtp" });
            evalRepo.marcarInformeEnviado.mockRejectedValue(new Error("SQL timeout"));

            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);

            // El correo salió → respondemos OK aunque el marcado falle.
            expect(res.jsonBody.error).toBeUndefined();
            expect(res.jsonBody.data.enviado).toBe(true);
            expect(mailer.send).toHaveBeenCalledTimes(1);
            expect(evalRepo.marcarInformeEnviado).toHaveBeenCalledTimes(1);
        });
    });

    describe("validación de pdfBase64", () => {
        test("base64 válido → adjunta el PDF al correo", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase());
            const req = mockRequest({
                evaluacionUuid: UUID_OK,
                pdfBase64: "QkFTRTY0RGF0YQ==", // base64 válido
            });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);

            expect(res.jsonBody.error).toBeUndefined();
            const arg = mailer.send.mock.calls[0][0];
            expect(arg.attachments).toHaveLength(1);
            expect(arg.attachments[0].encoding).toBe("base64");
            expect(arg.attachments[0].contentType).toBe("application/pdf");
        });

        test("base64 inválido → omite adjunto, envía correo igual (no tira)", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase());
            const req = mockRequest({
                evaluacionUuid: UUID_OK,
                pdfBase64: "no-es-base64-!!!@@@",
            });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);

            expect(res.jsonBody.error).toBeUndefined();
            expect(res.jsonBody.data.enviado).toBe(true);
            const arg = mailer.send.mock.calls[0][0];
            expect(arg.attachments).toHaveLength(0);
        });

        test("base64 gigante (>8MB) → omite adjunto sin tirar", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase());
            const gigante = "A".repeat(8 * 1024 * 1024 + 10); // > 8MB y base64-válido
            const req = mockRequest({ evaluacionUuid: UUID_OK, pdfBase64: gigante });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);

            expect(res.jsonBody.error).toBeUndefined();
            const arg = mailer.send.mock.calls[0][0];
            expect(arg.attachments).toHaveLength(0);
        });

        test("sin pdfBase64 → envía sin adjuntos", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase());
            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);
            const arg = mailer.send.mock.calls[0][0];
            expect(arg.attachments).toHaveLength(0);
        });
    });

    describe("envío exitoso", () => {
        test("envía, marca y responde con correo + modo", async () => {
            evalRepo.obtenerInforme.mockResolvedValue(informeBase());
            evalRepo.marcarInformeEnviado.mockResolvedValue(undefined);
            mailer.send.mockResolvedValue({ delivered: true, mode: "smtp" });

            const req = mockRequest({ evaluacionUuid: UUID_OK });
            const res = mockResponse();
            await evalService.enviarInforme(req, res);

            expect(res.jsonBody.data.enviado).toBe(true);
            expect(res.jsonBody.data.correo).toBe("alumno@uv.cl");
            expect(res.jsonBody.data.modo).toBe("smtp");
            expect(evalRepo.marcarInformeEnviado).toHaveBeenCalledWith(100);
        });
    });
});
