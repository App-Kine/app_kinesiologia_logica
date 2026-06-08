'use strict';

const dateFormat = require('dateformat');

let getDateToJSON = (fecha) => {
    let r = {
        date:
            '' +
            (fecha.getUTCDate() < 10
                ? '0' + fecha.getUTCDate()
                : fecha.getUTCDate()),
        month:
            '' +
            (fecha.getUTCMonth() + 1 < 10
                ? '0' + (fecha.getUTCMonth() + 1)
                : fecha.getUTCMonth() + 1),
        year: '' + fecha.getUTCFullYear(),
    };

    return r;
};

let getNumberToJSON = (fecha) => {
    let sFecha = '' + fecha;

    let r = {
        date: sFecha.substring(6, 8),
        month: sFecha.substring(4, 6),
        year: sFecha.substring(0, 4),
    };

    return r;
};

let getNumberToJSON_DMY = (fecha) => {
    let sFecha = '' + fecha;

    let r = {
        date: sFecha.substring(0, 2),
        month: sFecha.substring(2, 4),
        year: sFecha.substring(4, 8),
    };

    return r;
};

let parseJSONtoDate = (fechaJSON) => {
    return new Date(
        fechaJSON.year,
        fechaJSON.month - 1,
        fechaJSON.date,
        0,
        0,
        0,
        0
    );
};

let parseJSONtoNumber = (fechaJSON, formato) => {
    let fecha = '';

    if (formato == 'DMY') {
        fecha =
            '' + fechaJSON.date + '' + fechaJSON.month + '' + fechaJSON.year;
    } else if (formato == 'YMD') {
        fecha =
            '' + fechaJSON.year + '' + fechaJSON.month + '' + fechaJSON.date;
    }

    return fecha;
};

let parseDateToNumber = (fecha, formato) => {
    let fechaNumber = '';

    if (formato == 'DMY') {
        fechaNumber +=
            fecha.getUTCDate() < 10
                ? '0' + fecha.getUTCDate()
                : fecha.getUTCDate();
        fechaNumber +=
            fecha.getUTCMonth() + 1 < 10
                ? '0' + (fecha.getUTCMonth() + 1)
                : fecha.getUTCMonth() + 1;
        fechaNumber += fecha.getUTCFullYear();
    } else if (formato == 'YMD') {
        fechaNumber += fecha.getUTCFullYear();
        fechaNumber +=
            fecha.getUTCMonth() + 1 < 10
                ? '0' + (fecha.getUTCMonth() + 1)
                : fecha.getUTCMonth() + 1;
        fechaNumber +=
            fecha.getUTCDate() < 10
                ? '0' + fecha.getUTCDate()
                : fecha.getUTCDate();
    }

    return parseInt(fechaNumber);
};

let parseJSONtoString = (fechaJSON, formato) => {
    let fecha = '';

    if (formato == 'Y-M-D') {
        fecha = '' + fechaJSON.year + '-' + fechaJSON.month + '-' + fechaJSON.date;
    } else if (formato == 'Y/M/D') {
        fecha = '' + fechaJSON.year + '/' + fechaJSON.month + '/' + fechaJSON.date;
    } else if (formato == 'D-M-Y') {
        fecha = '' + fechaJSON.date + '-' + fechaJSON.month + '-' + fechaJSON.year;
    } else if (formato == 'D/M/Y') {
        fecha = '' + fechaJSON.date + '/' + fechaJSON.month + '/' + fechaJSON.year;
    }

    return fecha;
};

let getFechaHoraFromDate = (fecha) => {
    let r = getDateToJSON(fecha);

    return (
        r.date +
        '/' +
        r.month +
        '/' +
        r.year +
        ' ' +
        (fecha.getUTCHours() < 10
            ? '0' + fecha.getUTCHours()
            : fecha.getUTCHours()) +
        ':' +
        (fecha.getUTCMinutes() < 10
            ? '0' + fecha.getUTCMinutes()
            : fecha.getUTCMinutes()) +
        ':' +
        (fecha.getUTCSeconds() < 10
            ? '0' + fecha.getUTCSeconds()
            : fecha.getUTCSeconds())
    );
};

let getDateHourToJSON = (fechaHora, fromBD = true) => {
    let r = {
        date: '' + (fechaHora.getUTCDate() < 10 ? ('0' + fechaHora.getUTCDate()) : fechaHora.getUTCDate()),
        month: '' + (fechaHora.getUTCMonth() + 1 < 10 ? ('0' + (fechaHora.getUTCMonth() + 1)) : fechaHora.getUTCMonth() + 1),
        year: '' + fechaHora.getUTCFullYear(),
        hour: '' + (fechaHora.getUTCHours() < 10 ? ('0' + fechaHora.getUTCHours()) : fechaHora.getUTCHours()),
        minute: '' + (fechaHora.getUTCMinutes() < 10 ? ('0' + fechaHora.getUTCMinutes()) : fechaHora.getUTCMinutes()),
        second: '' + (fechaHora.getUTCSeconds() < 10 ? ('0' + fechaHora.getUTCSeconds()) : fechaHora.getUTCSeconds())
    };

    if (!fromBD) {
        r.hour = '' + (fechaHora.getHours() < 10 ? ('0' + fechaHora.getHours()) : fechaHora.getHours());
    }

    return r;
};

let parseJSONDateHourToText = (fecha) => {
    return (
        fecha.date +
        '/' +
        fecha.month +
        '/' +
        fecha.year +
        ' ' +
        fecha.hour +
        ':' +
        fecha.minute +
        ':' +
        fecha.second
    );
};

let getStringFechaFormato = (fecha, formato) => {
    return dateFormat(fecha, formato);
};

let getFechaHora = () => {
    return dateFormat(new Date(), 'dd/mm/yyyy HH:MM:ss');
};

let getJsonFromFechaString = (fecha, sep = '/', formato = 'DMY') => {
    let fechaArray = fecha.split(sep);

    let r = {};

    r.date = formato == 'DMY' ? fechaArray[0] : fechaArray[2].substring(0, 2);
    r.month = fechaArray[1];
    r.year = formato == 'DMY' ? fechaArray[2].substring(0, 4) : fechaArray[0];

    return r;
};

let getFechaHoraFromString = (sFecha) => {
    let d = parseInt(sFecha.substring(0, 2));
    let m = parseInt(sFecha.substring(3, 5));
    let a = parseInt(sFecha.substring(6, 10));
    let ho = parseInt(sFecha.substring(11, 13));
    let mi = parseInt(sFecha.substring(14, 16));
    let se = parseInt(sFecha.substring(17, 19));

    let fecha = new Date(a, m-1, d);
    fecha.setUTCHours(ho, mi, se, 0);
    
    return fecha;
};


module.exports = {
    getDateToJSON,
    getNumberToJSON,
    getNumberToJSON_DMY,
    parseJSONtoDate,
    parseJSONtoNumber,
    parseDateToNumber,
    parseJSONtoString,
    getFechaHoraFromDate,
    getDateHourToJSON,
    parseJSONDateHourToText,
    getStringFechaFormato,
    getFechaHora,
    getJsonFromFechaString,
    getFechaHoraFromString,
};