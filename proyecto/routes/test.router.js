"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/test.service");

router.post("/crearTest",   services.crear);
router.post("/listarTests", services.listar);
router.post("/obtenerTest", services.obtener);
router.post("/editarTest",  services.editar);
router.post("/eliminarTest", services.eliminar);

module.exports = router;
