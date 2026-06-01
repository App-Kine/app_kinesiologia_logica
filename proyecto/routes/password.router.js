"use strict";

/**
 * Rutas de recuperación de contraseña (RF-59). Públicas (el usuario olvidó
 * su contraseña, no tiene sesión). El controlador las expone sin token.
 */

var express = require("express");
var router = express.Router();
var services = require("../services/password.service");

router.post("/solicitarReset",   services.solicitar);
router.post("/resetearPassword", services.resetear);

// Cambio de contraseña del usuario autenticado. El controlador exige JWT y le
// inyecta el usuario_id verificado antes de reenviar acá.
router.post("/cambiarPassword",  services.cambiar);

module.exports = router;
