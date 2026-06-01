# Test de carga (Bloque P1.R2 — recomendación ISO 25010)

Simula estudiantes concurrentes resolviendo una evaluación para validar
la capacidad del backend bajo carga real.

## Requisitos

1. **k6** instalado: https://k6.io/docs/getting-started/installation/
   - Mac:     `brew install k6`
   - Windows: `winget install k6 --source winget`
   - Linux:   `sudo apt install k6`

2. Backends `lógica` y `controlador` corriendo (`npm run dev-unix` en cada uno).

3. Base de datos sembrada con `AurisDB_INSTALL.sql` (al menos 1 curso con
   1 aplicación activa).

## Correr el test

### Configuración por defecto (100 VUs, 2 minutos total)

```bash
cd app_kinesiologia_logica
k6 run tests/loadtest/evaluacion-flow.k6.js
```

### Configuración custom

```bash
# 200 estudiantes durante 5 minutos
k6 run \
    --vus 200 \
    --duration 5m \
    -e BASE_URL=http://localhost:3000 \
    -e CURSO_ID=1 \
    tests/loadtest/evaluacion-flow.k6.js

# Sin tiempo de espera entre clicks (estrés máximo)
k6 run -e THINK_TIME_MS=0 tests/loadtest/evaluacion-flow.k6.js
```

## Variables de entorno disponibles

| Variable | Default | Descripción |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | URL del controlador |
| `CURSO_ID` | `1` | ID del curso que contiene la aplicación a probar |
| `THINK_TIME_MS` | `1500` | Pausa simulada entre clicks del estudiante |

## Qué se está midiendo

El flujo que ejecuta cada VU (usuario virtual):

1. **aplicacionesActivas** — descubrir tests disponibles del curso
2. **iniciar** — cargar preguntas del test (NO persiste)
3. **corregir** N veces — una por cada pregunta (NO persiste)
4. **enviar** — única operación que persiste todo de una

El throughput de `corregir` es lo más demandante: cada estudiante hace N
requests (N = preguntas del test). Para un test con 4 preguntas y 100
estudiantes simultáneos esto son 400 lookups concurrentes a BD.

## Umbrales (thresholds)

El test **falla con exit code != 0** si no se cumplen:

- `http_req_duration p95 < 500ms` — 95% de los requests responde rápido
- `http_req_failed rate < 0.01` — menos de 1% de errores HTTP
- `iterations count > 50` — al menos 50 flujos completos por corrida

Estos umbrales están pensados para una corrida en máquina local de
desarrollo. Para validar SLA de producción ajusta a las metas reales.

## Cómo leer los resultados

Tras `k6 run` verás dos secciones:

### Métricas estándar k6

```
http_req_duration..........: avg=120ms  p(95)=320ms  max=850ms
http_req_failed............: 0.12%   12 out of 9817
iterations.................: 245     1.62/s
vus........................: 0       min=0  max=100
```

### Resumen personalizado

```
==================================================================
  Resumen — flujo de evaluación bajo carga
==================================================================
  Flujos completados:            245
  Requests totales:              9817
  Errores HTTP (%):              0.12
  Latencia p95:                  320 ms
  Latencia p99:                  650 ms
  Latencia máxima:               850 ms
  Throughput:                    65.4 req/s
==================================================================
```

También se guarda el resumen JSON completo en `last-summary.json` para
análisis posterior.

## Interpretación rápida

| Métrica observada | Interpretación |
|---|---|
| p95 < 500ms, errores < 1% | Backend OK para la carga simulada |
| p95 > 1s pero errores < 1% | Necesitas más conexiones en el pool mssql |
| Errores > 5% | Pool agotado / timeouts / o BD saturada |
| iterations bajo (< 30) | Los flujos están tardando demasiado |

## Próximos pasos sugeridos

Si los umbrales se cumplen con 100 VUs, prueba con:

1. **200 VUs durante 10 minutos** — para detectar leaks de memoria
2. **Spike test** — `--vus 1000 --duration 30s` para ver comportamiento ante
   un pico súbito (ej. inicio de clase con todos conectándose a la vez)
3. **Soak test** — `--vus 50 --duration 1h` para ver degradación gradual
