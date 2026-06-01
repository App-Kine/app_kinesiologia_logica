"use strict";

/**
 * Service de cursos – consulta directa a AurisDB.
 * Sirve como referencia de cómo se accede a SQL Server desde un service.
 */

var reply = require("../../base/utils/reply");
var db = require("../../base/utils/db");
// Bloque P3.R9: utilidades compartidas
var { leerArg, validarLongitudes } = require("../../base/utils/argReader");

const TAG = "\x1b[36m[curso]\x1b[0m";
const TAG_ERR = "\x1b[31m[curso]\x1b[0m";

// Wrapper local que inyecta el TAG_ERR para mantener el contexto en logs
function _leerArg(request) { return leerArg(request, { tag: TAG_ERR }); }

/**
 * Valida longitudes de los campos de curso contra los límites del esquema SQL.
 * Límites: codigo VARCHAR(40), nombre NVARCHAR(160), descripcion NVARCHAR(1000).
 */
function _validarLongitudCurso(codigo, nombre, descripcion) {
    return validarLongitudes([
        { valor: codigo,      max: 40,   etiqueta: "El código del curso" },
        { valor: nombre,      max: 160,  etiqueta: "El nombre del curso" },
        { valor: descripcion, max: 1000, etiqueta: "La descripción del curso" },
    ]);
}

/**
 * GET equivalente: POST /<rootPath>/cursos/listar
 * Lista los cursos activos visibles al estudiante (RF-02).
 */
async function listarActivos(request, response) {
    try {
        const r = await db
            .request("auris")
            .query(`
                SELECT  curso_id,
                        codigo,
                        nombre,
                        descripcion
                FROM    auris.curso
                WHERE   activo = 1
                ORDER BY codigo;
            `);

        response.json(reply.ok(r.recordset));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/detalle  body: { curso_id }
 * Devuelve un curso por id usando parámetros SQL (anti-inyección).
 */
async function detalle(request, response) {
    try {
        const cursoId = request.body && request.body.curso_id;
        if (!cursoId) {
            return response.json(
                reply.error("Falta parámetro curso_id en el body")
            );
        }

        const r = await db
            .request("auris")
            .input("curso_id", db.sql.BigInt, cursoId)
            .query(`
                SELECT  curso_id,
                        codigo,
                        nombre,
                        descripcion,
                        activo,
                        created_at,
                        updated_at
                FROM    auris.curso
                WHERE   curso_id = @curso_id;
            `);

        if (r.recordset.length === 0) {
            return response.json(reply.error("Curso no encontrado"));
        }

        response.json(reply.ok(r.recordset[0]));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/ping
 * Health-check de la conexión a la BD: hace SELECT 1.
 */
async function ping(request, response) {
    try {
        const r = await db
            .request("auris")
            .query("SELECT 1 AS ok, GETUTCDATE() AS servertime;");
        response.json(reply.ok(r.recordset[0]));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/misCursos  body: { profesorId }
 * Devuelve los cursos donde el profesor está asignado activamente (RF-61).
 */
async function listarDelProfesor(request, response) {
    const b = _leerArg(request);
    const profesorId = Number(b.profesorId);
    logger.log(`${TAG} listarDelProfesor: profesorId=${b.profesorId} coerced=${profesorId}`);
    try {
        if (!Number.isInteger(profesorId) || profesorId <= 0) {
            logger.log(`${TAG} listarDelProfesor: validación falló — profesorId inválido`);
            return response.json(reply.error("profesorId requerido"));
        }
        const r = await db
            .request("auris")
            .input("profesor_id", db.sql.BigInt, profesorId)
            .query(`
                SELECT  c.curso_id,
                        c.codigo,
                        c.nombre,
                        c.descripcion
                FROM    auris.curso c
                JOIN    auris.profesor_curso pc
                          ON pc.curso_id = c.curso_id
                WHERE   pc.usuario_id = @profesor_id
                  AND   pc.activo = 1
                  AND   c.activo = 1
                ORDER BY c.codigo;
            `);
        logger.log(`${TAG} listarDelProfesor: OK (${r.recordset.length} filas)`);
        response.json(reply.ok(r.recordset));
    } catch (e) {
        logger.log(`${TAG_ERR} listarDelProfesor: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/crear  body.arg = { codigo, nombre, descripcion?, creadoPor }
 * Crea un curso y asigna al profesor automáticamente como su creador y profesor activo.
 *
 * Nota sobre el SRS: RF-74 originalmente asignaba esta acción al superadmin.
 * La extensión es intencional: en este flujo el profesor puede armar sus propios cursos.
 */
async function crear(request, response) {
    const b = _leerArg(request);
    const codigo = (b.codigo || "").trim();
    const nombre = (b.nombre || "").trim();
    const descripcion = b.descripcion ? String(b.descripcion).trim() : null;
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} crear: codigo="${codigo}" nombre="${nombre}" creadoPor=${creadoPor}`);
    try {
        if (!codigo) return response.json(reply.error("código requerido"));
        if (!nombre) return response.json(reply.error("nombre requerido"));
        if (!Number.isInteger(creadoPor) || creadoPor <= 0)
            return response.json(reply.error("creadoPor (usuario_id) requerido"));

        const errLong = _validarLongitudCurso(codigo, nombre, descripcion);
        if (errLong) return response.json(reply.error(errLong));

        const pool = db.getPool("auris");

        // Validar que el código no esté duplicado
        const rCheck = await pool
            .request()
            .input("codigo", db.sql.VarChar(40), codigo)
            .query(`SELECT curso_id FROM auris.curso WHERE codigo = @codigo;`);
        if (rCheck.recordset.length > 0) {
            return response.json(reply.error(`Ya existe un curso con código "${codigo}"`));
        }

        const tx = new db.sql.Transaction(pool);
        await tx.begin();
        try {
            // INSERT curso
            const reqC = new db.sql.Request(tx);
            const rC = await reqC
                .input("codigo", db.sql.VarChar(40), codigo)
                .input("nombre", db.sql.NVarChar(160), nombre)
                .input("descripcion", db.sql.NVarChar(1000), descripcion)
                .input("creado_por", db.sql.BigInt, creadoPor)
                .query(`
                    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por)
                    OUTPUT INSERTED.curso_id
                    VALUES (@codigo, @nombre, @descripcion, 1, @creado_por);
                `);
            const cursoId = rC.recordset[0].curso_id;

            // Asignar al profesor en profesor_curso (self-assigned)
            const reqA = new db.sql.Request(tx);
            await reqA
                .input("usuario_id", db.sql.BigInt, creadoPor)
                .input("curso_id", db.sql.BigInt, cursoId)
                .input("asignado_por", db.sql.BigInt, creadoPor)
                .query(`
                    INSERT INTO auris.profesor_curso
                        (usuario_id, curso_id, asignado_por, activo)
                    VALUES (@usuario_id, @curso_id, @asignado_por, 1);
                `);

            await tx.commit();
            logger.log(`${TAG} crear: OK curso_id=${cursoId}`);
            response.json(reply.ok({ curso_id: cursoId }));
        } catch (e) {
            try { await tx.rollback(); } catch (_) {}
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} crear: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/obtener  body.arg = { cursoId }
 * Devuelve un curso + lista de aplicaciones de test que tiene.
 * Cada aplicación trae el nombre del test, profesor y conteo de preguntas.
 */
async function obtenerConAplicaciones(request, response) {
    const b = _leerArg(request);
    const cursoId = Number(b.cursoId);
    logger.log(`${TAG} obtenerConAplicaciones: cursoId=${cursoId}`);
    try {
        if (!Number.isInteger(cursoId) || cursoId <= 0)
            return response.json(reply.error("cursoId requerido"));

        const pool = db.getPool("auris");

        const rCurso = await pool
            .request()
            .input("curso_id", db.sql.BigInt, cursoId)
            .query(`
                SELECT  curso_id, codigo, nombre, descripcion,
                        activo, creado_por, created_at, updated_at
                FROM    auris.curso
                WHERE   curso_id = @curso_id;
            `);
        if (rCurso.recordset.length === 0) {
            return response.json(reply.error("Curso no encontrado"));
        }

        // Autorización (RNF-19): un profesor solo accede a SUS cursos. El
        // profesorId lo inyecta el controlador desde el JWT. Si no es el dueño,
        // "no encontrado" (no revelamos que el curso existe).
        const profesorId = Number(b.profesorId);
        if (
            Number.isInteger(profesorId) && profesorId > 0 &&
            Number(rCurso.recordset[0].creado_por) !== profesorId
        ) {
            logger.log(`${TAG} obtenerConAplicaciones: DENEGADO cursoId=${cursoId} dueño=${rCurso.recordset[0].creado_por} solicita=${profesorId}`);
            return response.json(reply.error("Curso no encontrado"));
        }

        // Filtro defensivo (2026-05-26):
        //   - t.activo = 1: nunca mostramos aplicaciones cuyo test ya fue
        //     eliminado. Esto limpia el caso histórico donde el test se
        //     eliminó sin cascade y dejó la aplicación "zombie".
        //   El listado SÍ incluye aplicaciones activas e inactivas, para que
        //   el profesor pueda re-activar una que pausó manualmente.
        const rApls = await pool
            .request()
            .input("curso_id", db.sql.BigInt, cursoId)
            .query(`
                SELECT  apl.aplicacion_id,
                        apl.aplicacion_uuid,
                        apl.test_id,
                        t.nombre  AS test_nombre,
                        (SELECT COUNT(*) FROM auris.test_pregunta tp
                           WHERE tp.test_id = t.test_id) AS cantidad_preguntas,
                        apl.profesor_id,
                        u.nombre  AS profesor_nombre,
                        apl.activo,
                        apl.visible_desde,
                        apl.visible_hasta,
                        apl.created_at
                FROM    auris.aplicacion_test apl
                JOIN    auris.test t ON t.test_id = apl.test_id
                LEFT JOIN auris.usuario u ON u.usuario_id = apl.profesor_id
                WHERE   apl.curso_id = @curso_id
                  AND   t.activo = 1
                ORDER BY apl.created_at DESC;
            `);

        const curso = rCurso.recordset[0];
        curso.aplicaciones = rApls.recordset;
        logger.log(`${TAG} obtenerConAplicaciones: OK (${rApls.recordset.length} aplicaciones)`);
        response.json(reply.ok(curso));
    } catch (e) {
        logger.log(`${TAG_ERR} obtenerConAplicaciones: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/editar  body.arg = { cursoId, codigo, nombre, descripcion?, creadoPor }
 * Solo el creador del curso puede editarlo.
 */
async function editar(request, response) {
    const b = _leerArg(request);
    const cursoId = Number(b.cursoId);
    const codigo = (b.codigo || "").trim();
    const nombre = (b.nombre || "").trim();
    const descripcion = b.descripcion ? String(b.descripcion).trim() : null;
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} editar: cursoId=${cursoId} creadoPor=${creadoPor}`);
    try {
        if (!Number.isInteger(cursoId) || cursoId <= 0)
            return response.json(reply.error("cursoId requerido"));
        if (!codigo) return response.json(reply.error("código requerido"));
        if (!nombre) return response.json(reply.error("nombre requerido"));

        const errLong = _validarLongitudCurso(codigo, nombre, descripcion);
        if (errLong) return response.json(reply.error(errLong));

        const pool = db.getPool("auris");

        // Verificar propiedad
        const rCheck = await pool
            .request()
            .input("curso_id", db.sql.BigInt, cursoId)
            .query(`
                SELECT creado_por, activo, codigo FROM auris.curso
                WHERE curso_id = @curso_id;
            `);
        if (rCheck.recordset.length === 0)
            return response.json(reply.error("Curso no encontrado"));
        if (!rCheck.recordset[0].activo)
            return response.json(reply.error("El curso está inactivo"));
        if (Number(rCheck.recordset[0].creado_por) !== creadoPor)
            return response.json(reply.error("Solo el creador puede editar este curso"));

        // Si cambia el código, verificar que no esté ocupado por otro curso
        if (codigo !== rCheck.recordset[0].codigo) {
            const rDup = await pool
                .request()
                .input("codigo", db.sql.VarChar(40), codigo)
                .input("curso_id", db.sql.BigInt, cursoId)
                .query(`
                    SELECT curso_id FROM auris.curso
                    WHERE codigo = @codigo AND curso_id <> @curso_id;
                `);
            if (rDup.recordset.length > 0)
                return response.json(reply.error(`Ya existe otro curso con código "${codigo}"`));
        }

        await pool
            .request()
            .input("curso_id", db.sql.BigInt, cursoId)
            .input("codigo", db.sql.VarChar(40), codigo)
            .input("nombre", db.sql.NVarChar(160), nombre)
            .input("descripcion", db.sql.NVarChar(1000), descripcion)
            .query(`
                UPDATE auris.curso
                SET    codigo = @codigo,
                       nombre = @nombre,
                       descripcion = @descripcion
                WHERE  curso_id = @curso_id;
            `);

        logger.log(`${TAG} editar: OK cursoId=${cursoId}`);
        response.json(reply.ok({ curso_id: cursoId }));
    } catch (e) {
        logger.log(`${TAG_ERR} editar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/eliminar  body.arg = { cursoId, creadoPor }
 *
 * Soft-delete del curso (activo=0) + CASCADE-deactivate de sus aplicaciones
 * activas (aplicacion_test.activo=0). Conserva históricos de evaluaciones.
 *
 * Fix Día 2 (auditoría 2026-05-27): antes solo desactivaba el curso, pero
 * las aplicaciones seguían activas y aparecían en analítica como fantasmas
 * de un curso eliminado. Ahora cascade en transacción (igual que test).
 */
async function eliminar(request, response) {
    const b = _leerArg(request);
    const cursoId = Number(b.cursoId);
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} eliminar: cursoId=${cursoId} creadoPor=${creadoPor}`);
    try {
        if (!Number.isInteger(cursoId) || cursoId <= 0)
            return response.json(reply.error("cursoId requerido"));

        const pool = db.getPool("auris");
        const rCheck = await pool
            .request()
            .input("curso_id", db.sql.BigInt, cursoId)
            .query(`
                SELECT creado_por, activo FROM auris.curso
                WHERE curso_id = @curso_id;
            `);
        if (rCheck.recordset.length === 0)
            return response.json(reply.error("Curso no encontrado"));
        if (!rCheck.recordset[0].activo)
            return response.json(reply.error("El curso ya estaba eliminado"));
        if (Number(rCheck.recordset[0].creado_por) !== creadoPor)
            return response.json(reply.error("Solo el creador puede eliminar este curso"));

        const tx = new db.sql.Transaction(pool);
        await tx.begin();
        try {
            // 1) Soft-delete del curso
            await new db.sql.Request(tx)
                .input("curso_id", db.sql.BigInt, cursoId)
                .query(`
                    UPDATE auris.curso SET activo = 0
                    WHERE curso_id = @curso_id;
                `);

            // 2) Cascade: desactivar todas las aplicaciones del curso.
            //    Sin esto las aplicaciones quedan huérfanas visibles en
            //    analítica con curso "inexistente".
            const rAplic = await new db.sql.Request(tx)
                .input("curso_id", db.sql.BigInt, cursoId)
                .query(`
                    UPDATE auris.aplicacion_test
                    SET    activo = 0
                    WHERE  curso_id = @curso_id
                      AND  activo = 1;
                    SELECT @@ROWCOUNT AS afectadas;
                `);
            const afectadas = rAplic.recordset && rAplic.recordset[0]
                ? rAplic.recordset[0].afectadas
                : 0;

            await tx.commit();
            logger.log(`${TAG} eliminar: OK cursoId=${cursoId} aplicaciones desactivadas=${afectadas}`);
            response.json(reply.ok({
                curso_id: cursoId,
                aplicaciones_desactivadas: afectadas,
            }));
        } catch (e) {
            try { await tx.rollback(); } catch (_) {}
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} eliminar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    listarActivos,
    detalle,
    ping,
    listarDelProfesor,
    crear,
    obtenerConAplicaciones,
    editar,
    eliminar,
};
