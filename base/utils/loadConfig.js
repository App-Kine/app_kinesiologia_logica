"use strict";

const path = require("path");
const fileUtils = require("./fileUtils");
const commonUtils = require("./commonUtils");


var setEnvironment = async (env) => {
    let envParam = (env || "").trim();

    // Si no se especifica NODE_ENV, por defecto es "development".
    if (envParam === "") {
        envParam = "development";
    }

    // Cargar env/local.js (gitignored) SIEMPRE que exista, EXCEPTO en producción.
    // Sus valores sobreescriben los del archivo de entorno (merge profundo): es
    // donde cada dev pone su password de SQL/SMTP y su JWT secret local.
    //
    // IMPORTANTE: antes esto solo ocurría cuando NODE_ENV estaba vacío, así que
    // arrancar con NODE_ENV=development (`npm run dev-unix`) NO tomaba local.js y
    // fallaba la conexión a SQL ("Login failed for user 'sa'"). Ahora se carga
    // en cualquier entorno no productivo, de modo que `npm start` y
    // `npm run dev-unix` funcionan igual. En producción NO se carga local.js
    // (la config viene de env/production.js + variables de entorno).
    let localConfig;
    if (envParam !== "production") {
        let localPath = path.resolve(__dirname, `../../env/local.js`);
        if (fileUtils.fileCheck(localPath)) localConfig = require(localPath);
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
        mongo: preConfig.mongo || null,
    };

    return { newConfig: newConfig, preConfig: preConfig };
};

module.exports = async () => {
    var { preConfig, newConfig } = await setEnvironment(process.env.NODE_ENV);
    return newConfig;
};
