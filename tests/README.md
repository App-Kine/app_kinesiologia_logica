# Tests automatizados (Bloque P1.R1 — recomendación ISO 25010)

Configuración Jest + tests unitarios sobre los servicios críticos.

## Instalar

```bash
npm install
```

Esto instala Jest junto al resto de devDependencies.

## Correr los tests

```bash
# Una pasada
npm test

# Watch mode (re-ejecuta al guardar cambios)
npm run test:watch

# Con cobertura
npm run test:coverage
```

## Qué cubren los tests actuales

### `tests/services/pregunta.service.test.js`
- Validación de longitud (Día 3.2):
  - enunciado ≤ 2000
  - explicación ≤ 4000
  - alternativa.texto ≤ 1000
- Validación de alternativas (RF-65/66):
  - rango 2..5
  - exactamente 1 correcta
  - órdenes sin duplicados
- Eliminación con cascade (Día 3.1) propaga `tests_desvinculados`
- Autorización: solo el creador puede eliminar

### `tests/services/curso.service.test.js`
- Validación de longitud (Día 3.2): codigo ≤ 40, nombre ≤ 160, descripción ≤ 1000
- Validación de `creadoPor` y campos requeridos
- Robustez del parser `_leerArg` contra arg malformado

### `tests/services/evaluacion.service.test.js` — flujo "no persistir incompletas"
- `iniciar` NO crea fila en BD (no devuelve evaluacion_id)
- `corregir` devuelve corrección SIN llamar a `registrarRespuesta`
- `enviar` valida payload completo y solo persiste cuando llega bien
- Endpoints `responder` y `finalizar` están deprecados y devuelven error

## Cómo agregar más tests

Los servicios están diseñados como funciones puras `(req, res) → void` que
escriben respuesta en `res.json(...)`. El patrón es:

```js
jest.mock("../../proyecto/repositories/MI_REPO", () => ({
    miMetodo: jest.fn(),
}));
const repo = require("../../proyecto/repositories/MI_REPO");
const service = require("../../proyecto/services/MI_SERVICIO");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

test("ejemplo", async () => {
    repo.miMetodo.mockResolvedValue("dato");
    const req = mockRequest({ campo: "valor" });
    const res = mockResponse();
    await service.miFuncion(req, res);
    expect(res.jsonBody.data).toBe("dato");
});
```

## Umbral de cobertura

Configurado en `package.json → jest.coverageThreshold`:
- branches: 50%
- functions: 50%
- lines: 60%
- statements: 60%

Tras `npm run test:coverage` los reportes quedan en `coverage/lcov-report/index.html`.

## Roadmap

- [x] Validación de longitud en services
- [x] Flujo "no persistir incompletas"
- [ ] Tests del repositorio (requieren BD efímera con Testcontainers)
- [ ] Tests e2e con Playwright sobre los flujos del estudiante y docente
- [ ] Integración en CI (GitHub Actions)
