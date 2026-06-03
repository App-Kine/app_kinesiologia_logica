"use strict";

/**
 * Rutas del flujo de evaluación del estudiante (público, sin token).
 * El controlador las expone antes de su middleware JWT.
 */

var express = require("express");
var router = express.Router();
var services = require("../services/evaluacion.service");

router.post("/evaluacion/aplicacionesActivas", services.aplicacionesActivas);
router.post("/evaluacion/iniciar",             services.iniciar);
// Flujo "no persistir incompletas" (auditoría 2026-05-28)
router.post("/evaluacion/corregir",            services.corregir);
router.post("/evaluacion/enviar",              services.enviar);
// VIGENTES: informe del estudiante ya finalizado.
//   enviarInforme   → manda el informe por correo (idempotente, PDF validado).
//   informeCompleto → detalle pregunta a pregunta de la evaluación.
router.post("/evaluacion/enviarInforme",       services.enviarInforme);
router.post("/evaluacion/informeCompleto",     services.informeCompleto);
// DEPRECADOS: stubs que devuelven error pidiendo migrar a /corregir + /enviar.
router.post("/evaluacion/responder",           services.responder);
router.post("/evaluacion/finalizar",           services.finalizar);

module.exports = router;
