"use strict";

const fs = require("fs");

let fileCheck = (path) => {
    try {
        fs.accessSync(path, fs.constants.R_OK);
        return true;
    } catch (e) {
        return false;
    }
};

module.exports = {
    fileCheck,
};
