"use strict";

/**
 * Rutas de multimedia (GridFS).
 *
 * Subir/eliminar: JWT profesor (Authorization: Bearer <token>).
 * Obtener (streaming): público, para que el estudiante reproduzca sin login.
 *
 * El frontend sube el archivo como multipart/form-data DIRECTO a la lógica
 * (campo `archivo`), por eso usamos multer con memoryStorage y NO el envoltorio
 * `arg=` del controlador.
 *
 * El límite de multer es el más alto de los tres tipos (video = 50MB). Cada
 * tipo vuelve a validar su propio límite en el service (RNF-38 / RNF-39 /
 * pedido cliente 2026-05-26).
 */

var express = require("express");
var multer = require("multer");
var router = express.Router();

var services = require("../services/multimedia.service");
var { requireRole } = require("../../base/utils/jwtAuth");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: services.VIDEO_MAX },
});

// Subidas (profesor)
router.post(
    "/multimedia/subirAudio",
    requireRole("PROFESOR"),
    upload.single("archivo"),
    services.subirAudio
);
router.post(
    "/multimedia/subirImagen",
    requireRole("PROFESOR"),
    upload.single("archivo"),
    services.subirImagen
);
router.post(
    "/multimedia/subirVideo",
    requireRole("PROFESOR"),
    upload.single("archivo"),
    services.subirVideo
);

// Streaming (público)
router.get("/multimedia/audio/:id", services.obtenerAudio);
router.get("/multimedia/imagen/:id", services.obtenerImagen);
router.get("/multimedia/video/:id", services.obtenerVideo);

// Eliminar (profesor)
router.post("/multimedia/eliminar", requireRole("PROFESOR"), services.eliminar);

module.exports = router;
