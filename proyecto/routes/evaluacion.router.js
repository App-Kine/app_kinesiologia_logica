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
router.post("/evaluacion/responder",           services.responder);
router.post("/evaluacion/finalizar",           services.finalizar);
router.post("/evaluacion/enviarInforme",       services.enviarInforme);

module.exports = router;
