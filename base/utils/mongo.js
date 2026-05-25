"use strict";

/**
 * Conexión a MongoDB + helpers GridFS para multimedia (audios e imágenes
 * de las preguntas, RNF-38 / RNF-39).
 *
 * - initialize(): abre UN MongoClient usando global.config.mongo. Se llama
 *   una vez al arranque (index.js), después de cargar la config.
 * - getDb(): devuelve la instancia de la base (auris_media).
 * - bucketAudios() / bucketImagenes(): devuelven GridFSBucket reutilizables.
 * - close(): cierra el cliente (shutdown limpio / tests).
 *
 * Buckets: fs_audios y fs_imagenes (ver database/mongodb/init_mongo.js).
 * Es opcional: si no hay bloque `mongo` en la config, se salta sin romper
 * el resto de la app (login, cursos, etc. siguen funcionando).
 */

const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");

const BUCKET_AUDIOS = "fs_audios";
const BUCKET_IMAGENES = "fs_imagenes";

let _client = null;
let _db = null;
let _bucketAudios = null;
let _bucketImagenes = null;

const initialize = async () => {
    const conf = (global.config && global.config.mongo) || null;

    if (!conf || !conf.uri) {
        logger.log(
            `\x1b[33m[mongo]\x1b[0m Sin bloque "mongo" en env. Multimedia deshabilitada.`
        );
        return;
    }

    const dbName = conf.database || "auris_media";

    try {
        _client = new MongoClient(conf.uri, {
            serverSelectionTimeoutMS: 8000,
            ...(conf.options || {}),
        });
        await _client.connect();
        _db = _client.db(dbName);

        _bucketAudios = new GridFSBucket(_db, { bucketName: BUCKET_AUDIOS });
        _bucketImagenes = new GridFSBucket(_db, {
            bucketName: BUCKET_IMAGENES,
        });

        logger.log(
            `\x1b[36m[mongo]\x1b[0m Conectado a ${dbName} (${BUCKET_AUDIOS}, ${BUCKET_IMAGENES})`
        );
    } catch (e) {
        // No tiramos la app: la multimedia es opcional. Avisamos y seguimos.
        logger.log(
            `\x1b[31m[mongo]\x1b[0m Conexión FALLÓ: ${e.message}. Multimedia deshabilitada.`
        );
        _client = null;
        _db = null;
        _bucketAudios = null;
        _bucketImagenes = null;
    }
};

const isReady = () => _db !== null;

const getDb = () => {
    if (!_db) {
        throw new Error(
            "MongoDB no inicializado. ¿Configuraste el bloque `mongo` en env y corriste mongo.initialize()?"
        );
    }
    return _db;
};

const bucketAudios = () => {
    if (!_bucketAudios) throw new Error("Bucket fs_audios no disponible (Mongo no inicializado).");
    return _bucketAudios;
};

const bucketImagenes = () => {
    if (!_bucketImagenes) throw new Error("Bucket fs_imagenes no disponible (Mongo no inicializado).");
    return _bucketImagenes;
};

const close = async () => {
    if (_client) {
        try {
            await _client.close();
        } catch (e) {
            // ignore
        }
    }
    _client = null;
    _db = null;
    _bucketAudios = null;
    _bucketImagenes = null;
};

module.exports = {
    ObjectId,
    BUCKET_AUDIOS,
    BUCKET_IMAGENES,
    initialize,
    isReady,
    getDb,
    bucketAudios,
    bucketImagenes,
    close,
};
