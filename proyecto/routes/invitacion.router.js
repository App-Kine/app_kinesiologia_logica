"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/invitacion.service");

router.post("/crearInvitacion",       services.crear);
router.post("/verificarInvitacion",   services.verificar);
router.post("/completarInvitacion",   services.completar);
router.post("/listarInvitaciones",    services.listar);

module.exports = router;
