"use strict";

/**
 * Health check endpoints (Bloque P2.R7 — auditoría ISO 25010).
 * Rutas montadas SIN prefijo /base_logica para poder sondear con
 * herramientas estándar (kubectl, Cloudflare, nginx upstream check).
 */

var express = require("express");
var router = express.Router();
var svc = require("../services/health.service");

router.get("/healthz", svc.liveness);
router.get("/readyz",  svc.readiness);
router.get("/health",  svc.detailed);

module.exports = router;
