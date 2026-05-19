"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/pregunta.service");

router.post("/crearPregunta",   services.crear);
router.post("/listarPreguntas", services.listar);
router.post("/obtenerPregunta", services.obtener);

module.exports = router;
