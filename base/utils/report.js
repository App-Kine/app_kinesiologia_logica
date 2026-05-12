"use strict";

var fetch = require("node-fetch");

var reply = require("./reply");

module.exports = (url) => {
    return new Promise((onOk, onError) => {
        try {
            fetch(url.replace(/%252F/g, "%2F"))
                .then((res) => res.buffer())
                .then((buffer) => {
                    onOk(buffer);
                })
                .catch((error) => {
                    onError(error);
                });
        } catch (e) {
            onError(reply.fatal(e).error);
        }
    });
};
