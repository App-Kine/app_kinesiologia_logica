"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/aplicacion.service");

router.post("/crearAplicacion",      services.crear);
router.post("/listarAplicaciones",   services.listar);
router.post("/setActivoAplicacion",  services.setActivo);
router.post("/eliminarAplicacion",   services.eliminar);

module.exports = router;
