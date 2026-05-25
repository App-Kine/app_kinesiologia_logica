"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/analitica.service");

router.post("/analitica/resumen",     services.resumen);
router.post("/analitica/aplicacion",  services.detalleAplicacion);

module.exports = router;
