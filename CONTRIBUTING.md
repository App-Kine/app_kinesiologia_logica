# Convenciones de código — Auris

Esta guía recoge las decisiones de estructura y estilo seguidas en los
tres repositorios de Auris. Sigue estas convenciones cuando agregues
código para que el proyecto siga creciendo de forma uniforme y previsible.

## Estructura por capa

### Backend (lógica + controlador)

```
base/
  utils/            ← utilidades compartidas (db, mongo, mailer, argReader, …)
  invokers/         ← invoker.invoker.js (HTTP cross-service)
  routes/           ← routers genéricos (health, base)
proyecto/
  services/         ← lógica de negocio. Una función pública por endpoint.
  repositories/     ← acceso a datos. Aquí van todas las queries SQL/Mongo.
  routes/           ← express.Router que mapea URL → service.method
index.js            ← arranque
config.js, routes.js
env/                ← development.js, production.js, local.js (NO commit)
```

**Reglas obligatorias:**

- Un service **NO accede directo a la BD**. Llama a un repository.
- Un repository **NO toca request/response**. Recibe args, devuelve datos
  o tira excepción.
- Un router solo **mapea ruta → método**. No tiene lógica.
- Todos los endpoints usan **POST** (la convención original del proyecto)
  con `body = { arg: JSON.stringify(...) }`.

### Frontend (panel + frontend)

```
src/app/project/
  pages/<nombre>/                    ← una página Ionic por dominio
    <nombre>.page.ts
    <nombre>.page.html
    <nombre>.page.scss
  services/<nombre>.service.ts       ← cliente HTTP del dominio
  components/<nombre>/               ← componentes reutilizables
  pipes/<nombre>.pipe.ts
src/theme/variables.scss             ← tokens Ionic + dark mode
src/index.html                       ← <html lang="es">
```

## Naming

| Tipo | Convención | Ejemplo |
|---|---|---|
| Archivo de service backend | `<dominio>.service.js` | `pregunta.service.js` |
| Archivo de repository | `<dominio>.repository.js` | `pregunta.repository.js` |
| Función pública de service | `verbo + sustantivo` (camelCase) | `crear`, `editar`, `exportarBanco` |
| Endpoint (URL) | `verbo<Sustantivo>` | `/crearPregunta`, `/exportarBanco` |
| Página Ionic | kebab-case | `mis-tests`, `analitica-detalle` |
| Componente Angular | PascalCase | `RichTextEditorComponent` |
| Constante | UPPER_SNAKE | `MAX_PREGUNTAS`, `GRID_ID_RE` |
| Variable privada de service | con `_` prefix | `_leerArg`, `_validarLongitud` |

## Patrón de un service (canónico)

```js
"use strict";

var reply = require("../../base/utils/reply");
var miRepo = require("../repositories/mi.repository");
var { leerArg, validarLongitudes } = require("../../base/utils/argReader");

const TAG = "\x1b[36m[midomino]\x1b[0m";
const TAG_ERR = "\x1b[31m[midomino]\x1b[0m";

function _leerArg(request) { return leerArg(request, { tag: TAG_ERR }); }

async function crear(request, response) {
    const b = _leerArg(request);
    logger.log(`${TAG} crear: nombre="${b.nombre}"`);
    try {
        // 1) Validaciones
        if (!b.nombre) return response.json(reply.error("nombre requerido"));

        const errLong = validarLongitudes([
            { valor: b.nombre, max: 200, etiqueta: "El nombre" },
        ]);
        if (errLong) return response.json(reply.error(errLong));

        // 2) Llamada al repository
        const id = await miRepo.crear({ nombre: b.nombre.trim() });

        // 3) Respuesta
        logger.log(`${TAG} crear: OK id=${id}`);
        response.json(reply.ok({ id }));
    } catch (e) {
        logger.log(`${TAG_ERR} crear: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = { crear };
```

**Reglas:**

1. **TAG** y **TAG_ERR** por dominio, con códigos de color ANSI estándar
   (cyan para info, red para error).
2. **Logger antes y después** de cada operación importante.
3. **Try/catch en TODO endpoint público** con `reply.fatal(e)` en el catch.
4. **Errores de negocio** → `reply.error("mensaje legible")` (HTTP 200 con
   `{error:...}` — convención Auris).
5. **Errores inesperados** → `reply.fatal(e)` (loggea + esconde stack).

## Patrón de un repository

```js
"use strict";

var db = require("../../base/utils/db");
const TAG_ERR = "\x1b[31m[mi.repo]\x1b[0m";

/**
 * JSDoc de cada función pública con tipos y descripción.
 */
async function crear(params) {
    const r = await db.request("auris")
        .input("nombre", db.sql.NVarChar(200), params.nombre)
        .query(`
            INSERT INTO auris.mi_tabla (nombre)
            OUTPUT INSERTED.id
            VALUES (@nombre);
        `);
    return r.recordset[0].id;
}

async function eliminarConCascade(id) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        await new db.sql.Request(tx)
            .input("id", db.sql.BigInt, id)
            .query(`UPDATE auris.mi_tabla SET activo = 0 WHERE id = @id;`);

        await new db.sql.Request(tx)
            .input("id", db.sql.BigInt, id)
            .query(`UPDATE auris.tabla_hija SET activo = 0 WHERE padre_id = @id;`);

        await tx.commit();
        return { ok: true };
    } catch (e) {
        logger.log(`${TAG_ERR} eliminarConCascade rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

module.exports = { crear, eliminarConCascade };
```

**Reglas:**

1. **Siempre parametrizar** los inputs SQL (`.input(...)`). Nunca concatenar strings.
2. **Operaciones multi-paso → transacción** con rollback explícito.
3. **Soft-delete preferido** sobre DELETE físico (`activo=0`).
4. **No tirar errores con códigos crípticos**: usar `new Error("mensaje")` con
   `e.code = "SIN_INTENTO1"` para que el service pueda mapearlo a mensaje legible.

## Patrón de una página Ionic standalone

```ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonBackButton, IonIcon, IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { refreshOutline } from 'ionicons/icons';

import { MiService, MiTipo } from '../../services/mi.service';

@Component({
  selector: 'app-mi-pagina',
  templateUrl: './mi-pagina.page.html',
  styleUrls: ['./mi-pagina.page.scss'],
  standalone: true,
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonBackButton, IonIcon, IonSpinner,
  ],
})
export class MiPaginaPage {
  items: MiTipo[] = [];
  cargando = true;
  error: string | null = null;

  constructor(private svc: MiService) {
    addIcons({ refreshOutline });
  }

  /** ionViewWillEnter > ngOnInit: refresca cada vez que se entra */
  ionViewWillEnter(): void { void this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando = true;
    this.error = null;
    try {
      this.items = await this.svc.listar();
    } catch (e: any) {
      this.error = e?.message || 'Error desconocido';
    } finally {
      this.cargando = false;
    }
  }
}
```

**Reglas críticas:**

1. **`ionViewWillEnter()`** en lugar de `ngOnInit()` para data que cambia.
2. **`cargando`, `error`, datos** son el patrón estándar de estado.
3. **Standalone con imports explícitos** — sin NgModules.
4. **aria-label** en botones de icono solo (Bloque P2.R5).
5. **Sin localStorage / sessionStorage** — usa servicios singleton con estado en memoria.

## Logs

Convención de colores ANSI:

| Color | Significado |
|---|---|
| `\x1b[36m` cyan | INFO normal |
| `\x1b[31m` red | ERROR |
| `\x1b[33m` yellow | WARN / SKIP |

Formato: `[dominio] mensaje: dato=valor`

Bueno:
```
[curso] crear: codigo="KINE-401" creadoPor=1
[curso] crear: OK curso_id=5
[curso] crear: validación falló — código requerido
```

Malo:
```
log("create ok")
console.log(JSON.stringify(allTheThings))
```

## Migraciones SQL

Una migración por cambio de esquema, ubicada en
`app_kinesiologia_logica/database/<fecha>_<descripcion>.sql`:

```sql
/* =============================================================================
   Migración YYYY-MM-DD
   Descripción: por qué este cambio + impacto.
   ============================================================================= */
USE AurisDB;
GO

IF COL_LENGTH('auris.tabla', 'nueva_col') IS NULL
BEGIN
    ALTER TABLE auris.tabla
        ADD nueva_col INT NULL
            CONSTRAINT CK_check_nueva CHECK (nueva_col IS NULL OR nueva_col >= 0);
END
GO

PRINT 'OK: nueva_col agregada a auris.tabla';
GO
```

**Reglas:**

1. **Idempotente**: usar `IF COL_LENGTH IS NULL`, `IF NOT EXISTS`, etc.
2. **PRINT** descriptivo al final.
3. **Una migración por archivo** — no mezclar cambios no relacionados.
4. **Actualizar también `AurisDB_INSTALL.sql`** con el nuevo schema inline
   para que instalaciones nuevas no requieran correr migraciones aparte.

## Tests

Patrón en `tests/services/<dominio>.service.test.js`:

```js
jest.mock("../../proyecto/repositories/mi.repository", () => ({
    crear: jest.fn(),
}));
const repo = require("../../proyecto/repositories/mi.repository");
const svc = require("../../proyecto/services/mi.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

describe("mi.service", () => {
    beforeEach(() => jest.clearAllMocks());

    test("crear OK", async () => {
        repo.crear.mockResolvedValue(42);
        const req = mockRequest({ nombre: "x" });
        const res = mockResponse();
        await svc.crear(req, res);
        expect(res.jsonBody.data.id).toBe(42);
    });
});
```

**Reglas:**

1. **Una suite por service**, no por endpoint.
2. **Mock del repository**, nunca conectar a BD real en unitarios.
3. **Tests de transacción** → tests de integración con BD efímera (separado).

## Commits

Convención mínima (no estrictamente Conventional Commits):

| Prefijo | Cuándo usarlo |
|---|---|
| `feat:` | Nueva funcionalidad |
| `fix:` | Bug fix |
| `refactor:` | Cambio de estructura sin cambio de comportamiento |
| `docs:` | Solo documentación |
| `test:` | Solo tests |
| `chore:` | Build, deps, config |

Ejemplos:

```
feat: export del banco de preguntas a CSV (P3.R10)
fix: refresh de mis-aplicaciones al volver del detalle (Día 1.1)
refactor: extraer leerArg + validadores a base/utils/argReader (P3.R9)
docs: SETUP_COMPLETO.md sin Docker para Windows
```

## Antes de mergear a main

- [ ] `node --check` pasa en todos los .js modificados.
- [ ] `ngc --noEmit` pasa en panel y frontend.
- [ ] Tests existentes pasan (`npm test`).
- [ ] Si tocaste el esquema → migración SQL + actualización de `AurisDB_INSTALL.sql`.
- [ ] Si agregaste endpoint público → entra al rate limiting global (no requiere acción).
- [ ] Si agregaste acción destructiva → confirmación de UI + audit log.

## Glosario rápido

- **RF-XX**: requisito funcional del SRS original (mantener trazabilidad si aplica).
- **GridFS**: storage de binarios en MongoDB (audios, imágenes, videos).
- **soft-delete**: marcar `activo=0` en vez de borrar físicamente.
- **cascade**: cuando eliminar A debe limpiar B,C que dependen de A.
- **TOCTOU**: Time-of-check / time-of-use, requiere transacción SERIALIZABLE.
