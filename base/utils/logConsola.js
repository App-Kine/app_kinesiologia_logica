"use strict";

var dateFormat = require("dateformat");

let _getDateFormat = () => {
    return dateFormat(new Date(), "dd/mm/yyyy HH:MM:ss");
};

let log = (msg, ...moreMsg) => {
    if (moreMsg != undefined && moreMsg.length > 0) {
        console.log(_getDateFormat(), msg, ...moreMsg);
    } else {
        console.log(_getDateFormat(), msg);
    }
};

let error = (msg, ...moreMsg) => {
    if (moreMsg != undefined && moreMsg.length > 0) {
        console.error(_getDateFormat(), msg, ...moreMsg);
    } else {
        console.error(_getDateFormat(), msg);
    }
};

module.exports = {
    log,
    error,
};
