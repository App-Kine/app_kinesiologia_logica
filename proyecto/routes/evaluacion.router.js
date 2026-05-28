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
// Deprecados — devuelven error pidiendo migrar al nuevo flujo
router.post("/evaluacion/responder",           services.responder);
router.post("/evaluacion/finalizar",           services.finalizar);
router.post("/evaluacion/enviarInforme",       services.enviarInforme);
router.post("/evaluacion/informeCompleto",     services.informeCompleto);

module.exports = router;
