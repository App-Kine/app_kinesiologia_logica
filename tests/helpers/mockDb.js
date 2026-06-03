"use strict";

/**
 * Mock reutilizable de base/utils/db (mssql) para tests de repositorios.
 *
 * No abre NINGUNA conexión real. Simula la API encadenable que usan los repos:
 *
 *   db.request(code).input(name, type, value).query(sql) -> { recordset, rowsAffected }
 *   db.getPool(code).request()  (mismo request encadenable)
 *   db.sql.<Tipo>  (Int, BigInt, NVarChar(n), ...)   -> stubs no-op
 *   db.sql.Transaction(pool) -> { begin, commit, rollback }
 *   db.sql.Request(tx)       -> request encadenable
 *
 * USO TÍPICO en un test:
 *
 *   const harness = createDbHarness();
 *   jest.mock("../../base/utils/db", () => harness.db);   // (ver nota abajo)
 *   harness.queueResult({ recordset: [...] });
 *   ...ejecutar repo...
 *   expect(harness.queries[0].inputs).toMatchObject({ correo: "x@y.cl" });
 *
 * NOTA jest.mock: como jest.mock se hoistea, en cada suite creamos el harness
 * dentro de la factory y lo recuperamos vía require. Ver cómo lo hacen las
 * suites de tests/repositories/*.test.js (patrón con variable global de módulo).
 */

/**
 * Crea un "request" encadenable. Cada query consume el siguiente resultado de
 * la cola `results` y registra { sql, inputs } en `log`.
 */
function makeRequest(state) {
    const inputs = {};
    const req = {
        input(name, _typeOrValue, maybeValue) {
            // Soporta input(name, type, value) y input(name, value)
            const value = arguments.length >= 3 ? maybeValue : _typeOrValue;
            inputs[name] = value;
            return req;
        },
        async query(sql) {
            const result = nextResult(state, sql, inputs);
            return result;
        },
        async execute(proc) {
            const result = nextResult(state, proc, inputs);
            return result;
        },
        // expone inputs por si se quiere inspeccionar directamente
        _inputs: inputs,
    };
    return req;
}

function nextResult(state, sql, inputs) {
    state.queries.push({ sql, inputs: { ...inputs } });
    if (state.results.length === 0) {
        // Default seguro: recordset vacío. Evita undefined.recordset.
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
    }
    const next = state.results.shift();
    if (typeof next === "function") return next(sql, inputs);
    if (next instanceof Error) throw next;
    return normalizeResult(next);
}

function normalizeResult(r) {
    const recordset = r.recordset || [];
    return {
        recordset,
        recordsets: r.recordsets || [recordset],
        rowsAffected: r.rowsAffected || [recordset.length || 0],
        output: r.output || {},
    };
}

/**
 * Proxy de tipos sql: cualquier acceso (db.sql.Int) devuelve un stub, y
 * cualquier llamada (db.sql.NVarChar(254)) también. Así no importa la forma.
 */
function makeSqlTypes(state) {
    const callableNoop = new Proxy(function () {}, {
        get: () => callableNoop,
        apply: () => callableNoop,
    });

    function Transaction(pool) {
        this.pool = pool;
        this.begin = jest.fn(async () => {
            state.tx.begin++;
        });
        this.commit = jest.fn(async () => {
            state.tx.commit++;
        });
        this.rollback = jest.fn(async () => {
            state.tx.rollback++;
        });
        state.tx.instances.push(this);
    }

    function Request(_tx) {
        return makeRequest(state);
    }

    return new Proxy(
        { Transaction, Request },
        {
            get(target, prop) {
                if (prop in target) return target[prop];
                // Cualquier tipo (Int, BigInt, NVarChar, Decimal, ...) -> stub
                return callableNoop;
            },
        }
    );
}

/**
 * Construye el harness: { db, queueResult, queueResults, queries, tx, reset }
 */
function createDbHarness() {
    const state = {
        results: [],
        queries: [],
        tx: { begin: 0, commit: 0, rollback: 0, instances: [] },
    };

    const sharedRequest = () => makeRequest(state);

    const db = {
        sql: makeSqlTypes(state),
        request: jest.fn(() => sharedRequest()),
        getPool: jest.fn(() => ({
            request: () => sharedRequest(),
        })),
        initialize: jest.fn(),
        close: jest.fn(),
    };

    return {
        db,
        /** Encola un resultado (objeto {recordset,...}, Error o función). */
        queueResult(r) {
            state.results.push(r);
            return this;
        },
        /** Encola varios resultados en orden. */
        queueResults(arr) {
            for (const r of arr) state.results.push(r);
            return this;
        },
        /** Lista de { sql, inputs } en orden de ejecución. */
        get queries() {
            return state.queries;
        },
        /** Contadores de begin/commit/rollback + instancias de Transaction. */
        get tx() {
            return state.tx;
        },
        /** Limpia cola + log entre tests. */
        reset() {
            state.results.length = 0;
            state.queries.length = 0;
            state.tx.begin = 0;
            state.tx.commit = 0;
            state.tx.rollback = 0;
            state.tx.instances.length = 0;
        },
    };
}

module.exports = { createDbHarness };
