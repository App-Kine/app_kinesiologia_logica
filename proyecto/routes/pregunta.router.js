"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/pregunta.service");

router.post("/crearPregunta",         services.crear);
router.post("/listarPreguntas",       services.listar);
router.post("/obtenerPregunta",       services.obtener);
router.post("/editarPregunta",        services.editar);
router.post("/eliminarPregunta",      services.eliminar);
router.post("/agregarPreguntaATest",  services.agregarATest);
router.post("/quitarPreguntaDeTest",  services.quitarDeTest);
// Bloque P3.R10: export del banco a CSV
router.post("/exportarBanco",         services.exportarBanco);

module.exports = router;
