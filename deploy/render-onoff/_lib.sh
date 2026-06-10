#!/usr/bin/env bash
# Funciones compartidas por apagar.sh / encender.sh / estado.sh.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=config.sh
source ./config.sh

API="https://api.render.com/v1"

# Validaciones
if [ -z "${RENDER_API_KEY:-}" ]; then
  echo "✗ Falta la API key. Ejecuta primero:  export RENDER_API_KEY=\"rnd_...\"" >&2
  exit 1
fi
for v in SRV_LOGICA SRV_CONTROLADOR; do
  if [[ "${!v}" == *"PEGA_AQUI"* ]]; then
    echo "✗ Edita config.sh y pon el ID real de $v (empieza con srv-)." >&2
    exit 1
  fi
done

SERVICIOS=("$SRV_LOGICA:logica" "$SRV_CONTROLADOR:controlador")

# accion <suspend|resume>
accion() {
  local verbo="$1"
  for item in "${SERVICIOS[@]}"; do
    local id="${item%%:*}" nombre="${item##*:}"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      "$API/services/$id/$verbo" \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Accept: application/json")
    if [ "$code" = "200" ] || [ "$code" = "202" ]; then
      echo "  ✓ $nombre ($id): $verbo OK"
    else
      echo "  ✗ $nombre ($id): HTTP $code"
    fi
  done
}

# warmup: tras encender, espera a que lógica y controlador respondan 200
# (evita el error de cold-start si entras a la app de inmediato).
_warm_one() {
  local url="$1" nombre="$2" code
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$url" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then echo "  ✓ $nombre lista ($url)"; return; fi
    sleep 4
  done
  echo "  ⚠ $nombre aún no responde 200 — dale unos segundos más y recarga la web."
}
warmup() {
  echo "  Calentando servicios (cold-start ~20-60s)..."
  _warm_one "${URL_LOGICA:-https://example.invalid}/readyz" "lógica"
  _warm_one "${URL_CONTROLADOR:-https://example.invalid}/healthz" "controlador"
}

# estado: imprime si cada servicio está suspendido o activo
estado() {
  for item in "${SERVICIOS[@]}"; do
    local id="${item%%:*}" nombre="${item##*:}"
    local body susp
    body=$(curl -s "$API/services/$id" \
      -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json")
    susp=$(printf '%s' "$body" | grep -o '"suspended":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
    case "$susp" in
      suspended)     echo "  ⏸  $nombre ($id): APAGADO (suspended)";;
      not_suspended) echo "  ▶  $nombre ($id): ENCENDIDO";;
      *)             echo "  ?  $nombre ($id): estado desconocido (¿ID o API key correctos?)";;
    esac
  done
}
