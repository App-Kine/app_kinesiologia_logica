"use strict";

/**
 * Service de aplicaciones de test (módulo docente).
 * Cubre RF-71, RF-72, RF-88 a RF-93.
 *
 * RF-71: el profesor solo puede aplicar tests a cursos donde está asignado.
 * Verificación contra auris.profesor_curso. Si es superadmin esta
 * restricción podría relajarse — TODO cuando exista el middleware de rol.
 *
 * TODO(auth): obtener `profesorId` desde `request.usuario.usuario_id`
 * en vez del body cuando el middleware JWT (RNF-19) esté en su lugar.
 */

var reply = require("../../base/utils/reply");
var db = require("../../base/utils/db");
var aplicacionRepo = require("../repositories/aplicacion.repository");
// Bloque P3.R9: utilidades compartidas
var { leerArg } = require("../../base/utils/argReader");

const TAG = "\x1b[36m[aplicacion]\x1b[0m";
const TAG_ERR = "\x1b[31m[aplicacion]\x1b[0m";

function _leerArg(request) { return leerArg(request, { tag: TAG_ERR }); }

async function crear(request, response) {
    const b = _leerArg(request);
    const testId = Number(b.testId);
    const cursoId = Number(b.cursoId);
    const profesorId = Number(b.profesorId);
    logger.log(`${TAG} crear: test=${b.testId}→${testId} curso=${b.cursoId}→${cursoId} prof=${b.profesorId}→${profesorId}`);
    try {
        if (!Number.isInteger(testId) || testId <= 0) {
            logger.log(`${TAG} crear: validación falló — testId inválido`);
            return response.json(reply.error("testId requerido"));
        }
        if (!Number.isInteger(cursoId) || cursoId <= 0) {
            logger.log(`${TAG} crear: validación falló — cursoId inválido`);
            return response.json(reply.error("cursoId requerido"));
        }
        if (!Number.isInteger(profesorId) || profesorId <= 0) {
            logger.log(`${TAG} crear: validación falló — profesorId inválido`);
            return response.json(reply.error("profesorId requerido"));
        }

        const autorizado = await aplicacionRepo.profesorPerteneceACurso(
            profesorId,
            cursoId
        );
        if (!autorizado) {
            logger.log(`${TAG} crear: NO AUTORIZADO prof=${profesorId} curso=${cursoId} (RF-71)`);
            return response.json(
                reply.error(
                    "El profesor no está asignado a este curso (RF-71)"
                )
            );
        }

        try {
            const data = await aplicacionRepo.crearAplicacion(
                testId,
                cursoId,
                profesorId
            );
            logger.log(`${TAG} crear: OK aplicacion_id=${data.aplicacion_id} uuid=${data.aplicacion_uuid}`);
            response.json(reply.ok(data));
        } catch (e) {
            if (e.code === "DUPLICATE") {
                logger.log(`${TAG} crear: DUPLICADO test=${testId} curso=${cursoId}`);
                return response.json(reply.error(e.message));
            }
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} crear: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function listar(request, response) {
    const b = _leerArg(request);
    const cp = Number(b.profesorId);
    const cc = Number(b.cursoId);
    const profesorId = Number.isInteger(cp) && cp > 0 ? cp : null;
    const cursoId = Number.isInteger(cc) && cc > 0 ? cc : null;

    // Paginación opcional (escalabilidad). Con pageSize > 0 devuelve un envelope
    // { items, page, pageSize, hasMore }; sin él, un array (compatible hacia atrás).
    const ps = Number(b.pageSize);
    const pg = Number(b.page);
    const paginar = Number.isInteger(ps) && ps > 0;
    const pageSize = paginar ? Math.min(ps, 100) : null;
    const page = paginar && Number.isInteger(pg) && pg > 0 ? pg : 1;

    logger.log(`${TAG} listar: profesorId=${profesorId || 'todos'} cursoId=${cursoId || 'todos'}${paginar ? ` page=${page} size=${pageSize}` : ''}`);
    try {
        if (paginar) {
            const offset = (page - 1) * pageSize;
            const rows = await aplicacionRepo.listarPorProfesor(profesorId, cursoId, { limit: pageSize + 1, offset });
            const hasMore = rows.length > pageSize;
            const items = hasMore ? rows.slice(0, pageSize) : rows;
            logger.log(`${TAG} listar: OK (page ${page}, ${items.length} filas, hasMore=${hasMore})`);
            return response.json(reply.ok({ items, page, pageSize, hasMore }));
        }
        const data = await aplicacionRepo.listarPorProfesor(profesorId, cursoId);
        logger.log(`${TAG} listar: OK (${data.length} filas)`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} listar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function setActivo(request, response) {
    const b = _leerArg(request);
    const aplicacionId = Number(b.aplicacionId);
    // Dueño inyectado por el controlador desde el JWT (RNF-19). Si viene, el
    // repo solo actualiza la aplicación cuando pertenece a este profesor.
    const cp = Number(b.profesorId);
    const profesorId = Number.isInteger(cp) && cp > 0 ? cp : null;
    logger.log(`${TAG} setActivo: id=${b.aplicacionId} coerced=${aplicacionId} activo=${b.activo} prof=${profesorId || 'sin-filtro'}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0) {
            logger.log(`${TAG} setActivo: validación falló — aplicacionId inválido`);
            return response.json(reply.error("aplicacionId requerido"));
        }
        if (typeof b.activo !== "boolean") {
            logger.log(`${TAG} setActivo: validación falló — activo no booleano`);
            return response.json(reply.error("activo (boolean) requerido"));
        }
        const ok = await aplicacionRepo.setActivo(aplicacionId, b.activo, profesorId);
        if (!ok) {
            logger.log(`${TAG} setActivo: no encontrada o ajena (id=${aplicacionId} prof=${profesorId || 'sin-filtro'})`);
            return response.json(reply.error("Aplicación no encontrada"));
        }
        logger.log(`${TAG} setActivo: OK id=${aplicacionId}`);
        response.json(reply.ok({ aplicacion_id: aplicacionId, activo: b.activo }));
    } catch (e) {
        logger.log(`${TAG_ERR} setActivo: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/eliminarAplicacion  body.arg = { aplicacionId }
 *
 * Borra la aplicación. Si tiene evaluaciones registradas, falla por FK y
 * sugerimos usar setActivo(false) en su lugar.
 *
 * Fix Día 3 (auditoría 2026-05-27): el check de evaluaciones + DELETE
 * van en una transacción SERIALIZABLE para evitar TOCTOU (que entre el
 * SELECT COUNT y el DELETE se inserte una nueva evaluación). Sin esto
 * la FK terminaría tirando un error críptico al cliente en lugar del
 * mensaje claro que devolvemos arriba.
 */
async function eliminar(request, response) {
    const b = _leerArg(request);
    const aplicacionId = Number(b.aplicacionId);
    // Dueño inyectado por el controlador desde el JWT (RNF-19). Si viene, solo
    // el profesor propietario puede borrar la aplicación (evita write-IDOR).
    const cp = Number(b.profesorId);
    const profesorId = Number.isInteger(cp) && cp > 0 ? cp : null;
    logger.log(`${TAG} eliminar: id=${aplicacionId} prof=${profesorId || 'sin-filtro'}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0)
            return response.json(reply.error("aplicacionId requerido"));

        const pool = db.getPool("auris");
        const tx = new db.sql.Transaction(pool);
        // SERIALIZABLE: el rango leído por el COUNT queda lockeado hasta el commit,
        // así nadie puede insertar evaluaciones en medio.
        await tx.begin(db.sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
            // Verificación de dueño dentro de la transacción: si la aplicación no
            // existe o es de otro profesor, devolvemos el mismo mensaje genérico
            // (no filtra existencia de IDs ajenos).
            const rOwner = await new db.sql.Request(tx)
                .input("aplicacion_id", db.sql.BigInt, aplicacionId)
                .input("profesor_id", db.sql.BigInt, profesorId)
                .query(`
                    SELECT  profesor_id
                    FROM    auris.aplicacion_test
                    WHERE   aplicacion_id = @aplicacion_id;
                `);
            if (rOwner.recordset.length === 0) {
                await tx.rollback();
                return response.json(reply.error("Aplicación no encontrada"));
            }
            if (
                profesorId !== null &&
                Number(rOwner.recordset[0].profesor_id) !== profesorId
            ) {
                await tx.rollback();
                logger.log(`${TAG} eliminar: DENEGADO id=${aplicacionId} dueño=${rOwner.recordset[0].profesor_id} solicita=${profesorId}`);
                return response.json(reply.error("Aplicación no encontrada"));
            }

            const rEval = await new db.sql.Request(tx)
                .input("aplicacion_id", db.sql.BigInt, aplicacionId)
                .query(`
                    SELECT COUNT(*) AS total
                    FROM   auris.evaluacion
                    WHERE  aplicacion_id = @aplicacion_id;
                `);
            if (rEval.recordset[0].total > 0) {
                await tx.rollback();
                return response.json(reply.error(
                    `No se puede eliminar: hay ${rEval.recordset[0].total} evaluación(es) asociada(s). Usa "desactivar" para ocultarla a los estudiantes.`
                ));
            }

            const rDel = await new db.sql.Request(tx)
                .input("aplicacion_id", db.sql.BigInt, aplicacionId)
                .query(`
                    DELETE FROM auris.aplicacion_test
                    WHERE aplicacion_id = @aplicacion_id;
                `);
            if (rDel.rowsAffected[0] === 0) {
                await tx.rollback();
                return response.json(reply.error("Aplicación no encontrada"));
            }

            await tx.commit();
            logger.log(`${TAG} eliminar: OK id=${aplicacionId}`);
            response.json(reply.ok({ aplicacion_id: aplicacionId }));
        } catch (e) {
            try { await tx.rollback(); } catch (_) {}
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} eliminar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * Reordena las aplicaciones de un curso (pedido cliente 2026-06: dejar los tests
 * de cada curso en un orden definido por el profesor). Recibe el `cursoId` y el
 * arreglo `aplicacionIds` en el orden deseado; asigna orden = 1..N.
 *
 * Anti-IDOR (RNF-19 / RF-71): el profesor debe estar asignado al curso. El
 * `profesorId` lo inyecta el controlador desde el JWT (no se confía en el body).
 */
async function reordenar(request, response) {
    const b = _leerArg(request);
    const cursoId = Number(b.cursoId);
    const cp = Number(b.profesorId);
    const profesorId = Number.isInteger(cp) && cp > 0 ? cp : null;
    const ids = Array.isArray(b.aplicacionIds)
        ? b.aplicacionIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
    logger.log(`${TAG} reordenar: curso=${cursoId} n=${ids.length} prof=${profesorId || 'sin-filtro'}`);
    try {
        if (!Number.isInteger(cursoId) || cursoId <= 0) {
            return response.json(reply.error("cursoId requerido"));
        }
        if (ids.length === 0) {
            return response.json(reply.error("aplicacionIds requerido"));
        }
        if (profesorId !== null) {
            const pertenece = await aplicacionRepo.profesorPerteneceACurso(profesorId, cursoId);
            if (!pertenece) {
                logger.log(`${TAG} reordenar: DENEGADO prof=${profesorId} no pertenece a curso=${cursoId}`);
                return response.json(reply.error("Curso no encontrado"));
            }
        }
        const actualizadas = await aplicacionRepo.reordenar(cursoId, ids);
        logger.log(`${TAG} reordenar: OK ${actualizadas} filas`);
        response.json(reply.ok({ curso_id: cursoId, actualizadas }));
    } catch (e) {
        logger.log(`${TAG_ERR} reordenar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    crear,
    listar,
    setActivo,
    eliminar,
    reordenar,
};
