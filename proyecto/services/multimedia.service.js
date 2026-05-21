"use strict";

/**
 * Service de multimedia (audios e imágenes de las preguntas).
 *
 * Los binarios viven en MongoDB GridFS (audio ≤10MB MP3/WAV,
 * RNF-39 imagen ≤2MB JPG/PNG). Los datos relacionales siguen en SQL Server;
 * la pregunta solo guarda el `grid_id` (ObjectId hex 24) en
 * audio_grid_id / imagen_grid_id.
 *
 * A diferencia del resto de la lógica, estos endpoints NO reciben `arg=...`:
 * el frontend sube el archivo como multipart/form-data DIRECTO a la lógica
 * (multer lo deja en request.file). La autenticación va por header
 * Authorization: Bearer <jwt> (ver base/utils/jwtAuth.js).
 *
 * Subir/eliminar: JWT profesor. Obtener (streaming): público (el estudiante
 * reproduce el audio sin estar logueado, RF-01).
 */

var reply = require("../../base/utils/reply");
var mongo = require("../../base/utils/mongo");

const TAG = "\x1b[36m[multimedia]\x1b[0m";
const TAG_ERR = "\x1b[31m[multimedia]\x1b[0m";

const GRID_ID_RE = /^[a-fA-F0-9]{24}$/;

const AUDIO_MAX = 10 * 1024 * 1024; // 10 MB
const IMAGEN_MAX = 2 * 1024 * 1024; // RNF-39
const AUDIO_MIME = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"];
const IMAGEN_MIME = ["image/jpeg", "image/jpg", "image/png"];

function _checkReady(response) {
    if (!mongo.isReady()) {
        response.json(
            reply.error(
                "MongoDB no está disponible. Revisa el bloque `mongo` en env/local.js y que el servidor Mongo esté arriba."
            )
        );
        return false;
    }
    return true;
}

/**
 * Sube un buffer (request.file de multer) al bucket indicado.
 * Devuelve una promesa con el grid_id (string hex 24).
 */
function _subirAGrid(bucket, file, metadata) {
    return new Promise((resolve, reject) => {
        const uploadStream = bucket.openUploadStream(file.originalname, {
            contentType: file.mimetype,
            metadata: metadata,
        });
        uploadStream.on("error", reject);
        uploadStream.on("finish", () => resolve(uploadStream.id.toString()));
        uploadStream.end(file.buffer);
    });
}

async function _subir(request, response, tipo) {
    if (!_checkReady(response)) return;

    const usuarioId = request.usuario ? request.usuario.sub : null;
    const file = request.file;
    const esAudio = tipo === "audio";
    const bucket = esAudio ? mongo.bucketAudios() : mongo.bucketImagenes();
    const mimePermitidos = esAudio ? AUDIO_MIME : IMAGEN_MIME;
    const maxBytes = esAudio ? AUDIO_MAX : IMAGEN_MAX;
    const rnf = esAudio ? "10MB MP3/WAV" : "RNF-39 (2MB JPG/PNG)";

    logger.log(`${TAG} subir ${tipo}: prof=${usuarioId} file=${file ? file.originalname : "—"}`);

    try {
        if (!file || !file.buffer) {
            return response.json(reply.error("No se recibió ningún archivo (campo 'archivo')"));
        }
        if (!mimePermitidos.includes(file.mimetype)) {
            return response.json(
                reply.error(`Tipo no permitido (${file.mimetype}). ${rnf}`)
            );
        }
        if (file.size > maxBytes) {
            return response.json(
                reply.error(`Archivo demasiado grande. Máximo ${rnf}`)
            );
        }

        // pregunta_id es opcional al subir (la pregunta puede no existir aún).
        const preguntaIdRaw = request.body ? request.body.preguntaId : null;
        const preguntaId =
            preguntaIdRaw && Number.isInteger(Number(preguntaIdRaw))
                ? Number(preguntaIdRaw)
                : null;

        const metadata = {
            pregunta_id: preguntaId,
            subido_por: usuarioId,
            tipo: tipo,
        };

        const gridId = await _subirAGrid(bucket, file, metadata);
        logger.log(`${TAG} subir ${tipo}: OK grid_id=${gridId}`);
        response.json(reply.ok({ grid_id: gridId, contentType: file.mimetype }));
    } catch (e) {
        logger.log(`${TAG_ERR} subir ${tipo}: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function subirAudio(request, response) {
    return _subir(request, response, "audio");
}

async function subirImagen(request, response) {
    return _subir(request, response, "imagen");
}

/**
 * Streaming público de un archivo por su grid_id. `tipo` decide el bucket.
 * Soporta Range parcial básico para que el <audio> haga seek.
 */
async function _obtener(request, response, tipo) {
    if (!mongo.isReady()) {
        return response.status(503).send("MongoDB no disponible");
    }

    const id = request.params.id;
    const esAudio = tipo === "audio";
    const bucket = esAudio ? mongo.bucketAudios() : mongo.bucketImagenes();
    const colName = esAudio ? mongo.BUCKET_AUDIOS : mongo.BUCKET_IMAGENES;

    try {
        if (!GRID_ID_RE.test(id || "")) {
            return response.status(400).send("grid_id inválido");
        }
        const _id = new mongo.ObjectId(id);
        const fileDoc = await mongo
            .getDb()
            .collection(colName + ".files")
            .findOne({ _id });

        if (!fileDoc) {
            return response.status(404).send("Archivo no encontrado");
        }

        response.setHeader(
            "Content-Type",
            fileDoc.contentType || "application/octet-stream"
        );
        response.setHeader("Accept-Ranges", "bytes");

        const total = fileDoc.length;
        const range = request.headers.range;

        if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
            const start = m[1] ? parseInt(m[1], 10) : 0;
            const end = m[2] ? parseInt(m[2], 10) : total - 1;
            response.status(206);
            response.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
            response.setHeader("Content-Length", end - start + 1);
            return bucket
                .openDownloadStream(_id, { start, end: end + 1 })
                .on("error", () => response.end())
                .pipe(response);
        }

        response.setHeader("Content-Length", total);
        bucket
            .openDownloadStream(_id)
            .on("error", () => response.end())
            .pipe(response);
    } catch (e) {
        logger.log(`${TAG_ERR} obtener ${tipo}: ${e.message}`, e);
        if (!response.headersSent) response.status(500).send("Error al leer el archivo");
    }
}

async function obtenerAudio(request, response) {
    return _obtener(request, response, "audio");
}

async function obtenerImagen(request, response) {
    return _obtener(request, response, "imagen");
}

/**
 * Borra un archivo por grid_id + tipo. JWT profesor.
 * Body (arg= o JSON puro): { gridId, tipo: "audio" | "imagen" }
 */
async function eliminar(request, response) {
    if (!_checkReady(response)) return;

    let b = request.body || {};
    try {
        if (typeof b.arg === "string") b = JSON.parse(b.arg);
    } catch (e) {
        b = request.body || {};
    }

    const gridId = b.gridId;
    const tipo = b.tipo;
    logger.log(`${TAG} eliminar: gridId=${gridId} tipo=${tipo}`);

    try {
        if (!GRID_ID_RE.test(gridId || "")) {
            return response.json(reply.error("gridId inválido"));
        }
        if (tipo !== "audio" && tipo !== "imagen") {
            return response.json(reply.error("tipo debe ser 'audio' o 'imagen'"));
        }

        const bucket =
            tipo === "audio" ? mongo.bucketAudios() : mongo.bucketImagenes();
        const _id = new mongo.ObjectId(gridId);

        try {
            await bucket.delete(_id);
        } catch (e) {
            // GridFS lanza si el archivo no existe; lo tratamos como idempotente.
            logger.log(`${TAG} eliminar: ${e.message} (idempotente)`);
        }

        logger.log(`${TAG} eliminar: OK gridId=${gridId}`);
        response.json(reply.ok({ gridId, tipo }));
    } catch (e) {
        logger.log(`${TAG_ERR} eliminar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    subirAudio,
    subirImagen,
    obtenerAudio,
    obtenerImagen,
    eliminar,
    // límites expuestos por si el router los necesita para multer
    AUDIO_MAX,
    IMAGEN_MAX,
};
