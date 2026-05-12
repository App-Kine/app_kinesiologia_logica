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

    let newConfig = {
        app: preConfig.app,
    };

    return { newConfig: newConfig, preConfig: preConfig };
};

module.exports = async () => {
    var { preConfig, newConfig } = await setEnvironment(process.env.NODE_ENV);
    return newConfig;
};
