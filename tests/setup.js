"use strict";

/**
 * Setup global para Jest.
 * - Define un logger silencioso (los services usan `logger` global).
 * - Define una config dummy si algún service la lee.
 */

global.logger = {
    log: () => {}, // silencioso en tests; usa console.log si necesitas debug
};

global.log = global.logger; // alias usado en algunos archivos

global.config = global.config || {
    serv_udalba_logica: { host: "localhost", port: 2000, path: "" },
    databases: [],
    mongo: { uri: "mongodb://localhost:27017", database: "auris_test" },
};
