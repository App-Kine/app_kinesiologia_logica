"use strict";

/**
 * RUTAS PROYECTO
 */

module.exports = (app, rootPath) => {

    app.use(`/${rootPath}/`, require("./proyecto/routes/ejemplo.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/curso.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/auth.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/invitacion.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/pregunta.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/test.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/aplicacion.router"));

};
