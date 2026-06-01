"use strict";

/**
 * Repositorio de preguntas + alternativas.
 * Cubre RF-62 a RF-66 (creación con validaciones de cardinalidad y única correcta).
 *
 * La invariante "exactamente 1 alternativa correcta" la garantiza el índice
 * único filtrado UX_alt_unica_correcta en SQL Server; aquí solo validamos
 * antes para devolver un error legible.
 */

var db = require("../../base/utils/db");

const TAG_ERR = "\x1b[31m[pregunta.repo]\x1b[0m";

/**
 * Inserta una pregunta junto a sus alternativas en una sola transacción.
 *
 * @param {object} p
 * @param {string} p.enunciado
 * @param {string} p.explicacionClinica
 * @param {string|null} p.audioGridId       ObjectId hex (24) o null
 * @param {string|null} p.imagenGridId      ObjectId hex (24) o null
 * @param {number} p.creadoPor              usuario_id del profesor
 * @param {number|null} p.cursoOrigenId
 * @param {Array<{texto:string, esCorrecta:boolean, orden:number}>} p.alternativas
 * @returns {Promise<number>} pregunta_id
 */
async function crearPreguntaConAlternativas(p) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        const reqP = new db.sql.Request(tx);
        const r = await reqP
            .input("enunciado", db.sql.NVarChar(2000), p.enunciado)
            .input("explicacion_clinica", db.sql.NVarChar(4000), p.explicacionClinica)
            .input("audio_grid_id", db.sql.VarChar(24), p.audioGridId || null)
            .input("imagen_grid_id", db.sql.VarChar(24), p.imagenGridId || null)
            .input("video_grid_id", db.sql.VarChar(24), p.videoGridId || null)
            .input("creado_por", db.sql.BigInt, p.creadoPor)
            .input("curso_origen_id", db.sql.BigInt, p.cursoOrigenId || null)
            .query(`
                INSERT INTO auris.pregunta
                    (enunciado, explicacion_clinica, audio_grid_id,
                     imagen_grid_id, video_grid_id, creado_por, curso_origen_id)
                OUTPUT INSERTED.pregunta_id
                VALUES (@enunciado, @explicacion_clinica, @audio_grid_id,
                        @imagen_grid_id, @video_grid_id, @creado_por, @curso_origen_id);
            `);
        const preguntaId = r.recordset[0].pregunta_id;

        for (const alt of p.alternativas) {
            const reqA = new db.sql.Request(tx);
            await reqA
                .input("pregunta_id", db.sql.BigInt, preguntaId)
                .input("texto", db.sql.NVarChar(1000), alt.texto)
                .input("es_correcta", db.sql.Bit, alt.esCorrecta ? 1 : 0)
                .input("orden", db.sql.TinyInt, alt.orden)
                .query(`
                    INSERT INTO auris.alternativa
                        (pregunta_id, texto, es_correcta, orden)
                    VALUES (@pregunta_id, @texto, @es_correcta, @orden);
                `);
        }

        await tx.commit();
        return preguntaId;
    } catch (e) {
        logger.log(`${TAG_ERR} crearPreguntaConAlternativas rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Lista preguntas creadas por un profesor (o todas si es null).
 * No retorna alternativas, pero sí su conteo.
 */
async function listarPorProfesor(profesorId, opciones = {}) {
    const { limit, offset } = opciones;
    const paginar = Number.isInteger(limit) && limit > 0;

    const req = db
        .request("auris")
        .input("profesor_id", db.sql.BigInt, profesorId || null);

    let paginacionSql = "";
    if (paginar) {
        req.input("offset", db.sql.Int, Number.isInteger(offset) && offset > 0 ? offset : 0);
        req.input("limit", db.sql.Int, limit);
        paginacionSql = "OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY";
    }

    const r = await req.query(`
            SELECT  p.pregunta_id,
                    p.enunciado,
                    p.curso_origen_id,
                    c.nombre        AS curso_nombre,
                    p.audio_grid_id,
                    p.imagen_grid_id,
                    p.video_grid_id,
                    p.activo,
                    p.created_at,
                    p.updated_at,
                    (SELECT COUNT(*) FROM auris.alternativa a
                     WHERE a.pregunta_id = p.pregunta_id) AS cantidad_alternativas
            FROM    auris.pregunta p
            LEFT JOIN auris.curso c ON c.curso_id = p.curso_origen_id
            WHERE   p.activo = 1
              AND  (@profesor_id IS NULL OR p.creado_por = @profesor_id)
            ORDER BY p.created_at DESC
            ${paginacionSql};
        `);
    return r.recordset;
}

/**
 * Actualiza enunciado/explicación/multimedia + reemplaza alternativas (RF-67).
 * Solo el creador puede editar (lo valida el caller con creadoPorEsperado).
 *
 * @param {number} preguntaId
 * @param {object} p (mismos campos que crearPreguntaConAlternativas pero sin creadoPor)
 * @param {number|null} creadoPorEsperado  si != null, valida que la pregunta sea de ese profesor
 * @returns {Promise<boolean>} true si se actualizó, false si no encontró o no tiene permiso
 */
async function editarPreguntaConAlternativas(preguntaId, p, creadoPorEsperado) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        // Verificación de propiedad (RF-67)
        const reqCheck = new db.sql.Request(tx);
        const rCheck = await reqCheck
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                SELECT pregunta_id, creado_por, activo, enunciado,
                       explicacion_clinica, audio_grid_id, imagen_grid_id, video_grid_id
                FROM   auris.pregunta
                WHERE  pregunta_id = @pregunta_id;
            `);
        if (rCheck.recordset.length === 0 || !rCheck.recordset[0].activo) {
            await tx.rollback();
            return { ok: false, reason: "NOT_FOUND" };
        }
        if (creadoPorEsperado != null && Number(rCheck.recordset[0].creado_por) !== Number(creadoPorEsperado)) {
            await tx.rollback();
            return { ok: false, reason: "FORBIDDEN" };
        }

        // Bloque P2.R8: lock cuando hay evaluaciones FINALIZADAS que usan esta pregunta.
        // Editar el enunciado o las alternativas de una pregunta YA respondida cambiaría
        // el significado histórico del resultado del estudiante. Se devuelve LOCKED;
        // el cliente debe clonar y editar la copia en lugar.
        const rLock = await new db.sql.Request(tx)
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                SELECT COUNT(*) AS evaluaciones_finalizadas
                FROM   auris.respuesta_pregunta rp
                JOIN   auris.evaluacion e ON e.evaluacion_id = rp.evaluacion_id
                WHERE  rp.pregunta_id = @pregunta_id
                  AND  e.estado = 'FINALIZADA';
            `);
        const finalizadas = rLock.recordset[0]?.evaluaciones_finalizadas || 0;
        if (finalizadas > 0) {
            await tx.rollback();
            return { ok: false, reason: "LOCKED", evaluacionesFinalizadas: finalizadas };
        }

        // Guardamos snapshot "antes" para auditoría (consumido por el service)
        const antes = rCheck.recordset[0];

        // Actualizar la pregunta
        const reqP = new db.sql.Request(tx);
        await reqP
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .input("enunciado", db.sql.NVarChar(2000), p.enunciado)
            .input("explicacion_clinica", db.sql.NVarChar(4000), p.explicacionClinica)
            .input("audio_grid_id", db.sql.VarChar(24), p.audioGridId || null)
            .input("imagen_grid_id", db.sql.VarChar(24), p.imagenGridId || null)
            .input("video_grid_id", db.sql.VarChar(24), p.videoGridId || null)
            .query(`
                UPDATE auris.pregunta
                SET    enunciado = @enunciado,
                       explicacion_clinica = @explicacion_clinica,
                       audio_grid_id = @audio_grid_id,
                       imagen_grid_id = @imagen_grid_id,
                       video_grid_id = @video_grid_id
                WHERE  pregunta_id = @pregunta_id;
            `);

        // Reemplazar las alternativas (más simple y menos error-prone que diff)
        // Antes: borrar las que se usaban en tests bloquearía por FK. Aquí solo
        // borramos las alternativas (cascade no aplica). Si una alternativa
        // está referenciada por respuesta_pregunta, mejor NO borrar el row,
        // solo actualizar; pero como las respuestas guardan alternativa_intento*_id
        // sí podría romper FK. Por simplicidad: si hay respuestas, conservamos
        // las viejas y agregamos las nuevas no usadas. Implementación segura:
        // - DELETE solo de alternativas que NO están referenciadas por respuestas
        const reqDel = new db.sql.Request(tx);
        await reqDel
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                DELETE FROM auris.alternativa
                WHERE pregunta_id = @pregunta_id
                  AND alternativa_id NOT IN (
                      SELECT alternativa_intento1_id FROM auris.respuesta_pregunta
                        WHERE alternativa_intento1_id IS NOT NULL
                      UNION
                      SELECT alternativa_intento2_id FROM auris.respuesta_pregunta
                        WHERE alternativa_intento2_id IS NOT NULL
                  );
            `);

        // Insertar nuevas alternativas con orden re-numerado a partir del MAX existente
        const reqMax = new db.sql.Request(tx);
        const rMax = await reqMax
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                SELECT ISNULL(MAX(orden), 0) AS max_orden
                FROM   auris.alternativa
                WHERE  pregunta_id = @pregunta_id;
            `);
        let nextOrden = (rMax.recordset[0].max_orden || 0) + 1;

        // Primero limpiamos la marca de correcta de las viejas que sobrevivieron
        const reqClearOk = new db.sql.Request(tx);
        await reqClearOk
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                UPDATE auris.alternativa
                SET    es_correcta = 0
                WHERE  pregunta_id = @pregunta_id;
            `);

        for (const alt of p.alternativas) {
            const reqA = new db.sql.Request(tx);
            await reqA
                .input("pregunta_id", db.sql.BigInt, preguntaId)
                .input("texto", db.sql.NVarChar(1000), alt.texto)
                .input("es_correcta", db.sql.Bit, alt.esCorrecta ? 1 : 0)
                .input("orden", db.sql.TinyInt, nextOrden++)
                .query(`
                    INSERT INTO auris.alternativa
                        (pregunta_id, texto, es_correcta, orden)
                    VALUES (@pregunta_id, @texto, @es_correcta, @orden);
                `);
        }

        await tx.commit();
        return { ok: true, antes };
    } catch (e) {
        logger.log(`${TAG_ERR} editarPreguntaConAlternativas rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Soft delete (RF-68): marca activo=0 + limpia test_pregunta.
 *
 * Conserva la pregunta para mantener integridad de respuestas previas en
 * evaluaciones ya realizadas (FK respuesta_pregunta → pregunta), pero
 * elimina las filas de test_pregunta para que:
 *   - la cantidad_preguntas mostrada en listar tests sea correcta
 *   - test-detalle no muestre una fila vacía/ausente
 *
 * Todo va en una transacción: si algo falla, rollback completo.
 *
 * @param {number} preguntaId
 * @param {number|null} creadoPorEsperado  validación de propiedad
 * @returns {Promise<{ok:boolean, reason?:string, tests_desvinculados?:number}>}
 */
async function eliminarPregunta(preguntaId, creadoPorEsperado) {
    const pool = db.getPool("auris");

    // Check fuera de la transacción: no escribe, no compite
    const rCheck = await pool
        .request()
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT creado_por, activo FROM auris.pregunta
            WHERE pregunta_id = @pregunta_id;
        `);
    if (rCheck.recordset.length === 0) return { ok: false, reason: "NOT_FOUND" };
    if (!rCheck.recordset[0].activo) return { ok: false, reason: "ALREADY_INACTIVE" };
    if (creadoPorEsperado != null && Number(rCheck.recordset[0].creado_por) !== Number(creadoPorEsperado)) {
        return { ok: false, reason: "FORBIDDEN" };
    }

    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        // 1) Soft-delete de la pregunta
        await new db.sql.Request(tx)
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                UPDATE auris.pregunta SET activo = 0
                WHERE pregunta_id = @pregunta_id;
            `);

        // 2) Cascade: desvincular de todos los tests para que el conteo
        //    en listar y test-detalle sea consistente.
        const rDel = await new db.sql.Request(tx)
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                DELETE FROM auris.test_pregunta
                WHERE  pregunta_id = @pregunta_id;
                SELECT @@ROWCOUNT AS desvinculados;
            `);
        const desvinculados = rDel.recordset[0]?.desvinculados || 0;

        await tx.commit();
        return { ok: true, tests_desvinculados: desvinculados };
    } catch (e) {
        logger.log(`${TAG_ERR} eliminarPregunta rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Devuelve una pregunta con sus alternativas. Null si no existe.
 */
async function obtenerConAlternativas(preguntaId) {
    const pool = db.getPool("auris");

    const rPreg = await pool
        .request()
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT  pregunta_id, enunciado, explicacion_clinica,
                    audio_grid_id, imagen_grid_id, video_grid_id,
                    creado_por, curso_origen_id, clonada_de_id,
                    activo, created_at, updated_at
            FROM    auris.pregunta
            WHERE   pregunta_id = @pregunta_id;
        `);
    if (rPreg.recordset.length === 0) return null;

    const rAlt = await pool
        .request()
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT  alternativa_id, texto, es_correcta, orden
            FROM    auris.alternativa
            WHERE   pregunta_id = @pregunta_id
            ORDER BY orden;
        `);

    const pregunta = rPreg.recordset[0];
    pregunta.alternativas = rAlt.recordset;
    return pregunta;
}

/**
 * Vincula una pregunta a un test en la tabla test_pregunta.
 * El orden se calcula como MAX(orden) + 1 dentro de ese test.
 *
 * @returns {Promise<number>} el orden asignado
 */
async function vincularATest(preguntaId, testId) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        const reqMax = new db.sql.Request(tx);
        const rMax = await reqMax
            .input("test_id", db.sql.BigInt, testId)
            .query(`
                SELECT ISNULL(MAX(orden), 0) AS max_orden
                FROM   auris.test_pregunta
                WHERE  test_id = @test_id;
            `);
        const nuevoOrden = (rMax.recordset[0].max_orden || 0) + 1;

        const reqIns = new db.sql.Request(tx);
        await reqIns
            .input("test_id", db.sql.BigInt, testId)
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .input("orden", db.sql.SmallInt, nuevoOrden)
            .query(`
                INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
                VALUES (@test_id, @pregunta_id, @orden);
            `);

        await tx.commit();
        return nuevoOrden;
    } catch (e) {
        logger.log(`${TAG_ERR} vincularATest rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Desvincula una pregunta de un test.
 * Si la pregunta queda huérfana (no está en ningún test) y no tiene
 * respuestas registradas, hacemos soft-delete para que no quede basura
 * en el banco invisible.
 */
async function desvincularDeTest(preguntaId, testId) {
    const pool = db.getPool("auris");

    // 1) Borrar del junction
    await pool
        .request()
        .input("test_id", db.sql.BigInt, testId)
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            DELETE FROM auris.test_pregunta
            WHERE  test_id = @test_id
              AND  pregunta_id = @pregunta_id;
        `);

    // 2) ¿Quedó huérfana?
    const r = await pool
        .request()
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT
                (SELECT COUNT(*) FROM auris.test_pregunta tp
                  WHERE tp.pregunta_id = @pregunta_id) AS en_tests,
                (SELECT COUNT(*) FROM auris.respuesta_pregunta rp
                  WHERE rp.pregunta_id = @pregunta_id) AS respuestas;
        `);
    const { en_tests, respuestas } = r.recordset[0];

    // Si no está en ningún test y nunca se respondió, soft-delete
    if (en_tests === 0 && respuestas === 0) {
        await pool
            .request()
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .query(`
                UPDATE auris.pregunta SET activo = 0
                WHERE pregunta_id = @pregunta_id;
            `);
        return { huerfanaEliminada: true };
    }
    return { huerfanaEliminada: false };
}

/**
 * Export completo del banco para reemplazabilidad (Bloque P3.R10).
 * Devuelve todas las preguntas activas (opcionalmente filtradas por profesor)
 * con sus alternativas, listas para serializar a CSV o QTI.
 */
async function exportarBanco(profesorId) {
    const pool = db.getPool("auris");
    const r1 = await pool
        .request()
        .input("profesor_id", db.sql.BigInt, profesorId || null)
        .query(`
            SELECT  p.pregunta_id, p.enunciado, p.explicacion_clinica,
                    p.curso_origen_id, c.codigo AS curso_codigo,
                    p.audio_grid_id, p.imagen_grid_id, p.video_grid_id,
                    p.creado_por, u.correo AS creado_por_correo,
                    p.created_at, p.updated_at
            FROM    auris.pregunta p
            LEFT JOIN auris.curso c    ON c.curso_id    = p.curso_origen_id
            LEFT JOIN auris.usuario u  ON u.usuario_id  = p.creado_por
            WHERE   p.activo = 1
              AND   (@profesor_id IS NULL OR p.creado_por = @profesor_id)
            ORDER BY p.pregunta_id;
        `);
    const preguntas = r1.recordset;
    if (preguntas.length === 0) return [];

    const ids = preguntas.map((p) => Number(p.pregunta_id));
    const req2 = pool.request();
    const placeholders = ids.map((_, i) => {
        req2.input(`p${i}`, db.sql.BigInt, ids[i]);
        return `@p${i}`;
    });
    const r2 = await req2.query(`
        SELECT pregunta_id, alternativa_id, texto, es_correcta, orden
        FROM   auris.alternativa
        WHERE  pregunta_id IN (${placeholders.join(",")})
        ORDER BY pregunta_id, orden;
    `);
    const alts = {};
    for (const a of r2.recordset) {
        const k = String(a.pregunta_id);
        if (!alts[k]) alts[k] = [];
        alts[k].push({
            alternativa_id: a.alternativa_id,
            texto: a.texto,
            es_correcta: a.es_correcta === true || a.es_correcta === 1,
            orden: a.orden,
        });
    }
    return preguntas.map((p) => ({ ...p, alternativas: alts[String(p.pregunta_id)] || [] }));
}

module.exports = {
    crearPreguntaConAlternativas,
    listarPorProfesor,
    obtenerConAlternativas,
    editarPreguntaConAlternativas,
    eliminarPregunta,
    vincularATest,
    desvincularDeTest,
    exportarBanco,
};
