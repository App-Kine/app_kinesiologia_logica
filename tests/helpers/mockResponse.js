"use strict";

/**
 * Mock minimalista de Express response para tests unitarios.
 * Captura el JSON enviado y permite assertion sobre status/body.
 */
function mockResponse() {
    const res = {
        statusCode: 200,
        jsonBody: null,
        json: function (body) {
            this.jsonBody = body;
            return this;
        },
        status: function (code) {
            this.statusCode = code;
            return this;
        },
    };
    return res;
}

/** Mock de request con body típico Auris (arg = JSON urlencoded). */
function mockRequest(args) {
    return {
        body: {
            arg: typeof args === "string" ? args : JSON.stringify(args),
        },
    };
}

/** Mock de request con body JSON puro. */
function mockRequestJson(body) {
    return { body };
}

module.exports = { mockResponse, mockRequest, mockRequestJson };
