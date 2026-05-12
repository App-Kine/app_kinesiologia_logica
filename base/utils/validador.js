'use strict';

/**
 * Validación de parámetros, el valor del parámetro tipo puede contener los valores: numero - cadena - boolean - lista - fecha.
 *
 * @param {Object} args
 * @param {String} tipo
 * @param {String} nombre
 * @param {Boolean} esObligatorio
 */
let validarParametro = (args, tipo, nombre, esObligatorio) => {
    let msg = '';
    let tieneAtributo = args.hasOwnProperty(nombre);

    if (esObligatorio) {
        if (!tieneAtributo) {
            msg += `No se ha encontrado el parámetro ${nombre}.`;
        }
    }

    if (tipo == 'numero') {
        if (tieneAtributo) {
            if (
                esObligatorio &&
                ('' + (args[nombre] == null ? "" : args[nombre])).trim()
                    .length == 0
            ) {
                msg += `El valor del parámetro ${nombre} no puede ser vacío.`;
            } else if (isNaN('' + (args[nombre] == null ? '' : args[nombre]))) {
                msg += `El valor del parámetro ${nombre} debe ser numérico.`;
            }
        }
    }

    if (tipo == 'cadena') {
        if (tieneAtributo) {
            if (
                esObligatorio &&
                ('' + (args[nombre] == null ? '' : args[nombre])).trim()
                    .length == 0
            ) {
                msg += `El valor del parámetro ${nombre} no puede ser vacío.`;
            }
        }
    }

    if (tipo == 'boolean') {
        if (tieneAtributo) {
            if (typeof args[nombre] !== 'boolean') {
                msg += `El valor del parámetro ${nombre} debe ser true o false.`;
            }
        }
    }

    if (tipo == 'lista') {
        if (tieneAtributo) {
            if (
                !JSON.stringify(args[nombre]).startsWith("[") &&
                !JSON.stringify(args[nombre]).endsWith("]")
            ) {
                msg += `El valor del parámetro ${nombre} debe ser array.`;
            } else if (args[nombre].length == 0) {
                msg += `El parámetro ${nombre} debe contener al menos un elemento.`;
            }
        }
    }

    if (tipo == 'fecha') {
        if (tieneAtributo) {
            if (
                !args[nombre].hasOwnProperty('date') ||
                !args[nombre].hasOwnProperty('month') ||
                !args[nombre].hasOwnProperty('year')
            ) {
                msg += `El parámetro ${nombre} debe tener el formato {date: '00', month: '00', year: '0000'}.`;
            } else {
                if (args[nombre].hasOwnProperty('date')) {
                    if (!args[nombre].hasOwnProperty('date')) {
                        msg += `No se ha encontrado el atributo 'date' para el parámetro ${nombre}.`;
                    } else if (('' + args[nombre].date).trim().length == 0) {
                        msg += `El valor del atributo 'date' del parámetro ${nombre} no puede ser vacío.`;
                    } else if (isNaN(args[nombre].date)) {
                        msg += `El valor del atributo 'date' del parámetro ${nombre} debe ser numérico.`;
                    } else if (
                        args[nombre].date - Math.floor(args[nombre].date) !=
                        0
                    ) {
                        msg += `El valor del atributo 'date' del parámetro ${nombre} debe ser entero.`;
                    }
                }
                if (args[nombre].hasOwnProperty('month')) {
                    if (!args[nombre].hasOwnProperty('month')) {
                        msg += `No se ha encontrado el atributo 'month' para el parámetro ${nombre}.`;
                    } else if (('' + args[nombre].month).trim().length == 0) {
                        msg += `El valor del atributo 'month' del parámetro ${nombre} no puede ser vacío.`;
                    } else if (isNaN(args[nombre].month)) {
                        msg += `El valor del atributo 'month' del parámetro ${nombre} debe ser numérico.`;
                    } else if (
                        args[nombre].month - Math.floor(args[nombre].month) !=
                        0
                    ) {
                        msg += `El valor del atributo 'month' del parámetro ${nombre} debe ser entero.`;
                    }
                }
                if (args[nombre].hasOwnProperty('year')) {
                    if (!args[nombre].hasOwnProperty('year')) {
                        msg += `No se ha encontrado el atributo 'year' para el parámetro ${nombre}.`;
                    } else if (('' + args[nombre].year).trim().length == 0) {
                        msg += `El valor del atributo 'year' del parámetro ${nombre} no puede ser vacío.`;
                    } else if (isNaN(args[nombre].year)) {
                        msg += `El valor del atributo 'year' del parámetro ${nombre} debe ser numérico.`;
                    } else if (
                        args[nombre].year - Math.floor(args[nombre].year) !=
                        0
                    ) {
                        msg += `El valor del atributo 'year' del parámetro ${nombre} debe ser entero.`;
                    }
                }
            }
        }
    }

    return msg;
};


module.exports = {
    validarParametro,
};