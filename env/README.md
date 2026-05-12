# Archivos para configurar variables por ambiente

### development.js

- En ese archivo iran las variables de configuracion necesarias para ambientes de desarrollo
- Comando para levantar en modo desarollo `npm run start` o `npm run dev`

### production.js

- En ese archivo iran las variables de configuracion necesarias para ambientes de producción
- Comando para levantar en modo producción o `npm run prod`

### local.js

- Este archivo permite ingresar configuraciones para cuando queremos desarrollar en nuestro ambiente local, si el archivo existe y la app se levanta con los comandos `npm run start` se tomaran las configuraciones que esten en este archivo, las configuraciones que no se encuentren en este serán obtenidas del archivo de configuración de desarrollo o el config general.

- Para cuando nos encontramos desarrollando en nuestro entorno local y queremos concectarnos a una base de datos que se encuentra en nuestra maquina local u otra ip que no es la que se encuentra en desarrollo podemos agregar la siguiente conf

```
"use strict";

module.exports = {
    localDatabases: [
        {
            code: "<codigo_database>",
            server: "<host>",
            user: <user>,
            password: "<password>",
            database: "<nombre_database>"
        },
    ],
};
```

```
// ejemplo databases usadas en desarrollo
module.exports = {
    localDatabases: [
        {
            code: "base",
            server: "[IP_ADDRESS]",
            user: "usuario",
            password: "password",
            database: "base_pruebas",
        },
    ],
};
```