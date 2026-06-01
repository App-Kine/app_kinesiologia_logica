"use strict";

/**
 * Rutas de administración de usuarios. El control de rol (SUPERADMIN) lo hace
 * el controlador antes de reenviar acá.
 */

var express = require("express");
var router = express.Router();
var services = require("../services/usuario.service");

router.post("/listarUsuarios",       services.listar);
router.post("/cambiarEstadoUsuario", services.cambiarEstado);

module.exports = router;
