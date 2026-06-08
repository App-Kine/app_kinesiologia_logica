"use strict";

/**
 * RUTAS PROYECTO
 */

module.exports = (app, rootPath) => {

    app.use(`/${rootPath}/`, require("./proyecto/routes/curso.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/auth.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/invitacion.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/pregunta.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/test.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/aplicacion.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/analitica.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/multimedia.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/evaluacion.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/password.router"));
    app.use(`/${rootPath}/`, require("./proyecto/routes/usuario.router"));

};
