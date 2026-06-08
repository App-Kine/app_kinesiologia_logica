'use strict';

/*
 * Config ESTÁTICA del proceso (no contiene secretos ni depende del entorno).
 *   - rootPath: prefijo de todas las rutas de negocio (→ /base_logica/...).
 *   - level:    nivel de detalle del envelope de error de base/utils/reply.js.
 *   - largeEntity: si true, sube el límite de body a 500mb (no usar en prod).
 *
 * CONFIGURACIÓN PRODUCCIÓN: aquí NO se cambia nada para producción. Los valores
 * sensibles y por-entorno (PORT, BD, Mongo, JWT_SECRET, SMTP) viven en
 * env/production.js y se inyectan por variables de entorno (.env.example).
 */
module.exports = {
    app: {
        level: 'MEDIO',
        largeEntity: false,
        rootPath: 'base_logica',
    },
};
