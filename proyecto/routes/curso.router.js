"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/curso.service");

router.post("/cursos/listar",     services.listarActivos);
router.post("/cursos/detalle",    services.detalle);
router.post("/cursos/ping",       services.ping);
router.post("/cursos/misCursos",  services.listarDelProfesor);
router.post("/cursos/crear",      services.crear);
router.post("/cursos/obtener",    services.obtenerConAplicaciones);

module.exports = router;
