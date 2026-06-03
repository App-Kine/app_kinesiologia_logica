# MongoDB (multimedia) · Setup

Auris guarda **audios, imágenes y videos de las preguntas** en MongoDB GridFS.
Los datos relacionales siguen en SQL Server; aquí solo viven los binarios.

## 1. Tener MongoDB corriendo

### Opción A — MongoDB propio (recomendado · sin Docker)

Usa tu instancia de **MongoDB 6+**: una instalación nativa en el servidor, un
MongoDB existente, o **MongoDB Atlas** (nube). Tu connection string será del estilo:

- Local / nativo: `mongodb://localhost:27017`
- Atlas / nube: `mongodb+srv://usuario:password@cluster.xxxx.mongodb.net`

### Opción B — Docker (solo desarrollo local, opcional)

Si en tu equipo de desarrollo no tienes MongoDB nativo:

```bash
docker run -d --name auris-mongo -p 27017:27017 -v auris-mongo-data:/data/db mongo:7
```

## 2. Inicializar los buckets GridFS

Necesitas `mongosh` (viene con MongoDB, o instálalo aparte).

```bash
cd app_kinesiologia_logica
mongosh "mongodb://localhost:27017/auris_media" database/mongodb/init_mongo.js
```

> Si usas Atlas, reemplaza la URI por la tuya + `/auris_media` al final.

Esto crea los buckets `fs_audios`, `fs_imagenes` y `fs_videos` con índices y
validadores de tamaño/MIME (RNF-38 y RNF-39). Es idempotente: puedes correrlo
varias veces.

## 3. Configurar la conexión en el backend

En `app_kinesiologia_logica/env/local.js`, ajusta el bloque `mongo`:

```js
mongo: {
  uri: "mongodb://localhost:27017",   // <-- tu connection string
  database: "auris_media",
},
```

Reinicia la lógica (`npm run dev-unix`). En consola verás:

```
[mongo] Conectado a auris_media (fs_audios, fs_imagenes, fs_videos)
```

## 4. Límites enforced

| Tipo | Formatos | Tamaño máx | Dónde se valida |
|------|----------|-----------|-----------------|
| Audio | MP3, WAV | 10 MB | multer (HTTP) + MIME + validador Mongo |
| Imagen | JPG, PNG | 2 MB (RNF-39) | multer (HTTP) + MIME + validador Mongo |
| Video | MP4, WebM, MOV | 50 MB | multer (HTTP) + MIME + validador Mongo |

## 5. Endpoints (en la lógica, puerto 2000)

| Método | Ruta | Auth | Qué hace |
|--------|------|------|----------|
| POST | `/base_logica/multimedia/subirAudio` | JWT profesor | Sube audio, devuelve `grid_id` |
| POST | `/base_logica/multimedia/subirImagen` | JWT profesor | Sube imagen, devuelve `grid_id` |
| POST | `/base_logica/multimedia/subirVideo` | JWT profesor | Sube video, devuelve `grid_id` |
| GET | `/base_logica/multimedia/audio/:id` | público | Streaming del audio (para el estudiante) |
| GET | `/base_logica/multimedia/imagen/:id` | público | Streaming de la imagen |
| GET | `/base_logica/multimedia/video/:id` | público | Streaming del video |
| POST | `/base_logica/multimedia/eliminar` | JWT profesor | Borra un archivo por grid_id + tipo |

El `grid_id` devuelto se guarda en `auris.pregunta.audio_grid_id` /
`imagen_grid_id` / `video_grid_id` (SQL Server). Así se enlaza la multimedia con
la pregunta.
