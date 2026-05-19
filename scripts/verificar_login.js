"use strict";

/**
 * Verificador de credenciales contra AurisDB.
 *
 * Hace exactamente lo que hará el endpoint POST /login del backend:
 *   1) busca el usuario por correo
 *   2) si está activo, compara la password con bcrypt
 *   3) si coincide, lista sus roles
 *
 * Requiere:
 *   npm install bcryptjs --save
 *
 * Uso:
 *   node scripts/verificar_login.js admin@auris.local ChangeMe!2026
 */

const sql = require("mssql");
const bcrypt = require("bcryptjs");

const correo = process.argv[2];
const password = process.argv[3];

if (!correo || !password) {
    console.error("Uso: node scripts/verificar_login.js <correo> <password>");
    process.exit(1);
}

// Conexión a la BD (mismas credenciales que tu env/local.js)
const dbConfig = {
    user: "sa",
    password: "Martin131*",
    server: "localhost",
    port: 1433,
    database: "AurisDB",
    options: {
        encrypt: true,
        trustServerCertificate: true,
    },
};

(async () => {
    let pool;
    try {
        pool = await new sql.ConnectionPool(dbConfig).connect();

        // 1) Buscar usuario
        const r = await pool
            .request()
            .input("correo", sql.NVarChar(254), correo)
            .query(`
                SELECT  usuario_id,
                        nombre,
                        correo,
                        password_hash,
                        activo
                FROM    auris.usuario
                WHERE   correo = @correo
            `);

        if (r.recordset.length === 0) {
            console.log(`[FAIL] No existe ningún usuario con correo "${correo}"`);
            process.exit(1);
        }

        const u = r.recordset[0];

        if (!u.activo) {
            console.log(`[FAIL] El usuario "${correo}" existe pero está INACTIVO`);
            process.exit(1);
        }

        // 2) Comparar con bcrypt
        const ok = bcrypt.compareSync(password, u.password_hash);

        if (!ok) {
            console.log(`[FAIL] Credenciales inválidas para "${correo}"`);
            console.log(`       (mismo mensaje genérico que el RF-57 exige al backend)`);
            process.exit(1);
        }

        // 3) Listar roles
        const roles = await pool
            .request()
            .input("usuario_id", sql.BigInt, u.usuario_id)
            .query(`
                SELECT  r.codigo
                FROM    auris.usuario_rol ur
                JOIN    auris.rol r ON r.rol_id = ur.rol_id
                WHERE   ur.usuario_id = @usuario_id
                ORDER BY r.codigo
            `);

        console.log("");
        console.log("[OK] Login válido");
        console.log("    usuario_id : " + u.usuario_id);
        console.log("    nombre     : " + u.nombre);
        console.log("    correo     : " + u.correo);
        console.log("    roles      : " + roles.recordset.map((x) => x.codigo).join(", "));
        console.log("");
    } catch (e) {
        console.error("[ERROR]", e.message);
        process.exit(2);
    } finally {
        if (pool) await pool.close();
    }
})();
