"use strict";

var express = require("express");
var methodOverride = require("method-override");

global.logger = require("./base/utils/logConsola");

var loadConfig = require("./base/utils/loadConfig");
var infoApp = require("./package.json");
var { rootPath, largeEntity } = require("./config").app;

var app = express();

let setRequestLargeEntity = () => {
    app.use(
        express.urlencoded(
            largeEntity
                ? { extended: false, limit: "500mb" }
                : { extended: false }
        )
    );
    app.use(express.json(largeEntity ? { limit: "500mb" } : {}));
    app.use(methodOverride());
    logger.log(
        `\x1b[36m[${infoApp.name}]\x1b[0m Request entity: ${
            largeEntity ? "large" : "normal"
        }`
    );
};

let configCORS = () => {
    try {
        app.use(function (req, res, next) {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader(
                "Access-Control-Allow-Methods",
                "POST, GET, OPTIONS, DELETE"
            );
            res.setHeader("Access-Control-Max-Age", "60");
            res.setHeader(
                "Access-Control-Allow-Headers",
                "Origin, X-Requested-With, Content-Type, Accept, Authorization"
            );

            let oldSend = res.send;

            res.send = function (data) {
                try {
                    let datos = JSON.parse(data);

                    if (
                        datos.status == "ERROR" &&
                        datos.error.type == "FATAL"
                    ) {
                        logger.log(datos.error);
                    }

                    oldSend.apply(res, arguments);
                } catch (e) {
                    oldSend.apply(res, arguments);
                }
            };
            return next();
        });
        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m CORS: listo`);
    } catch (e) {
        throw { msgs: "Error configurar permisos CORS", error: e };
    }
};

let setConfig = async () => {
    try {
        global.config = await loadConfig();
        logger.log(`\x1b[36m[${infoApp.name}]\x1b[0m Config: listo`);
    } catch (e) {
        throw { msgs: "Error carga config/envConfig", error: e };
    }
};

let setRouters = (module) => {
    try {
        switch (module) {
            case "base":
                app.use(
                    `/${rootPath}/base`,
                    require("./base/routes/base.router")
                );
                break;
            case "proyecto":
                require("./routes")(app, rootPath);
                break;
        }
        logger.log(
            `\x1b[36m[${infoApp.name}]\x1b[0m Routers (${module}): listo`
        );
    } catch (e) {
        throw { msgs: `Error carga routers (${module})`, error: e };
    }
};

let launchApp = () => {
    try {
        app.listen(global.config.app.port, function () {
            logger.log(
                `\x1b[36m[${
                    infoApp.name
                }]\x1b[0m Env: ${global.config.app.NODE_ENV.toUpperCase()}, Port: ${
                    global.config.app.port
                }, Path: /${rootPath}, Tipo: LOGICA, v: ${infoApp.version}`
            );
        });
    } catch (e) {
        throw { msgs: "Error lanzar app", error: e };
    }
};

let initApp = async () => {
    try {
        setRequestLargeEntity();
        configCORS();
        await setConfig();
        setRouters("base");
        setRouters("proyecto");
        launchApp();
    } catch (e) {
        logger.log(
            `\x1b[36m[${infoApp.name}] \x1b[33m[${e.msgs}] ${e.error}\x1b[0m`
        );
    }
};

initApp();

module.exports = app;
