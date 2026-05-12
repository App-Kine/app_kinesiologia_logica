"use strict";

/**
 * RUTAS PROYECTO
 */

module.exports = (app, rootPath) => {

    app.use(`/${rootPath}/`, require("./proyecto/routes/ejemplo.router"));

};
