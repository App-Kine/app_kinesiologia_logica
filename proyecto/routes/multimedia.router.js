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
 */

var express = require("express");
var multer = require("multer");
var router = express.Router();

var services = require("../services/multimedia.service");
var { requireRole } = require("../../base/utils/jwtAuth");

// memoryStorage: el buffer va directo a GridFS, no tocamos disco.
// El límite duro lo ponemos al máximo de los dos (5MB); el service
// vuelve a validar tamaño/MIME por tipo (RNF-38 / RNF-39).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: services.AUDIO_MAX },
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

// Streaming (público)
router.get("/multimedia/audio/:id", services.obtenerAudio);
router.get("/multimedia/imagen/:id", services.obtenerImagen);

// Eliminar (profesor)
router.post("/multimedia/eliminar", requireRole("PROFESOR"), services.eliminar);

module.exports = router;
