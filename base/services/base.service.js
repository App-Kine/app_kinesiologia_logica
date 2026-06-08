"use strict";

var reply = require("../utils/reply");
var loadConfig = require("../utils/loadConfig");
var path = require("path");
var fs = require("fs");

let reload = async (req, res) => {
    global.config = await loadConfig();

    let env = (process.env.ENV || global.config.app.NODE_ENV).trim();

    let confEnv = null;
    let urlEnv = path.resolve(__dirname, `../../env/${env}.js`);
    try {
        if (env === "local") fs.accessSync(urlEnv, fs.constants.R_OK);
    } catch (e) {}

    if (env === "local") {
        confEnv = {
            local: require(urlEnv),
            development: require(path.resolve(
                __dirname,
                `../../env/development.js`
            )),
        };
    } else {
        confEnv = require(urlEnv);
    }

    let out = {
        environment: env.toUpperCase(),
        before: {
            config: require(path.resolve(__dirname, `../../config.js`)),
            env: confEnv,
        },
        after: global.config,
    };

    res.json(reply.ok(env != "production" ? out : "done!"));
    // res.json(reply.ok(out));
};

module.exports = {
    reload,
};
