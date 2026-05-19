"use strict";

const path = require("path");
const fileUtils = require("./fileUtils");
const commonUtils = require("./commonUtils");


var setEnvironment = async (env) => {
    let envParam = (env || "").trim();

    let localConfig;
    if (envParam === "") {
        let localPath = path.resolve(__dirname, `../../env/local.js`);
        if (fileUtils.fileCheck(localPath)) localConfig = require(localPath);

        envParam = "development"; //Por defecto
    }

    let envConfig = require(path.resolve(
        __dirname,
        `../../env/${envParam}.js`
    ));
    if (localConfig) envConfig = commonUtils.mergeDeep(envConfig, localConfig);

    let config = require("../../config");
    let preConfig = commonUtils.mergeDeep(
        commonUtils.mergeDeep({}, config),
        envConfig
    );
    preConfig.app.NODE_ENV = localConfig != null ? "local" : envParam;

    // Si existe local.js con `localDatabases`, esos reemplazan a `databases`
    // del archivo de entorno. Es el convenio descrito en env/README.md.
    let databases = preConfig.localDatabases || preConfig.databases || [];

    let newConfig = {
        app: preConfig.app,
        databases: databases,
        security: preConfig.security || {},
        mail: preConfig.mail || { mode: "dev" },
        frontend: preConfig.frontend || { baseUrl: "" },
        invitaciones: preConfig.invitaciones || { expiraHoras: 24 },
    };

    return { newConfig: newConfig, preConfig: preConfig };
};

module.exports = async () => {
    var { preConfig, newConfig } = await setEnvironment(process.env.NODE_ENV);
    return newConfig;
};
