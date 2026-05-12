"use strict";
var reply = require("../../base/utils/reply");

/**
 * Obtiene los datos de ejemplo.
 * Nota: Este método no se conecta a ninguna base de datos, 
 * retorna datos simulados (mock) para propósitos de prueba.
 */
function getData(request, response) {
    try {
        let dummyData = [
            { id: 1, nombre: "Facultad de Arquitectura" },
            { id: 2, nombre: "Facultad de Ciencias" },
            { id: 3, nombre: "Facultad de Derecho" },
            { id: 4, nombre: "Facultad de Ingeniería" },
            { id: 5, nombre: "Facultad de Medicina" }
        ];
        
        response.json(reply.ok(dummyData));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

module.exports = {
    getData
};
