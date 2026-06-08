/* =============================================================================
   Auris – Inicialización de MongoDB GridFS para multimedia
   Uso:
     mongosh "mongodb://localhost:27017/auris_media" database/mongodb/init_mongo.js
   o con tu URI:
     mongosh "<TU_URI>/auris_media" database/mongodb/init_mongo.js
   -----------------------------------------------------------------------------
   GridFS guarda audios MP3/WAV (≤10 MB) e imágenes JPG/PNG (≤2 MB,
   RNF-39) asociados a preguntas. Cada archivo guarda en `metadata` el
   pregunta_id (cuando ya existe) y quién lo subió.

   Los buckets crean automáticamente: fs_audios.files / fs_audios.chunks
   y fs_imagenes.files / fs_imagenes.chunks al insertar el primer archivo.
   Aquí solo creamos índices y validadores (idempotente).
   ============================================================================= */

db = db.getSiblingDB("auris_media");

// --- Índices recomendados para cada bucket ---
["fs_audios", "fs_imagenes", "fs_videos"].forEach((bucket) => {
  const chunks = db.getCollection(bucket + ".chunks");
  const files = db.getCollection(bucket + ".files");

  // Crear las colecciones si no existen (para poder ponerles índice/validador)
  if (!db.getCollectionNames().includes(bucket + ".files")) {
    db.createCollection(bucket + ".files");
  }
  if (!db.getCollectionNames().includes(bucket + ".chunks")) {
    db.createCollection(bucket + ".chunks");
  }

  // Índice único estándar de GridFS
  try {
    chunks.createIndex({ files_id: 1, n: 1 }, { unique: true, name: "uq_files_id_n" });
  } catch (e) { print("chunks index ya existe: " + bucket); }

  // Índice por pregunta_id para buscar rápido la multimedia de una pregunta
  files.createIndex({ "metadata.pregunta_id": 1 }, { name: "ix_metadata_pregunta" });
  files.createIndex({ uploadDate: -1 }, { name: "ix_upload_date" });
});

// --- Validador del bucket de audios (10 MB) ---
db.runCommand({
  collMod: "fs_audios.files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["filename", "length"],
      properties: {
        length: {
          bsonType: ["int", "long"],
          maximum: 10 * 1024 * 1024,
          description: "Audio: máximo 10 MB",
        },
        contentType: {
          bsonType: "string",
          enum: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"],
          description: "Solo MP3 o WAV",
        },
      },
    },
  },
  validationLevel: "moderate",
  validationAction: "error",
});

// --- Validador del bucket de imágenes (RNF-39) ---
db.runCommand({
  collMod: "fs_imagenes.files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["filename", "length"],
      properties: {
        length: {
          bsonType: ["int", "long"],
          maximum: 2 * 1024 * 1024,
          description: "RNF-39: máximo 2 MB",
        },
        contentType: {
          bsonType: "string",
          enum: ["image/jpeg", "image/jpg", "image/png"],
          description: "Solo JPG o PNG",
        },
      },
    },
  },
  validationLevel: "moderate",
  validationAction: "error",
});

// --- Validador del bucket de videos (50 MB MP4/WebM, pedido cliente 2026-05-26) ---
db.runCommand({
  collMod: "fs_videos.files",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["filename", "length"],
      properties: {
        length: {
          bsonType: ["int", "long"],
          maximum: 50 * 1024 * 1024,
          description: "Video: máximo 50 MB",
        },
        contentType: {
          bsonType: "string",
          enum: ["video/mp4", "video/webm", "video/quicktime"],
          description: "Solo MP4, WebM o MOV",
        },
      },
    },
  },
  validationLevel: "moderate",
  validationAction: "error",
});

print("MongoDB GridFS inicializado: fs_audios, fs_imagenes y fs_videos listos en auris_media.");
