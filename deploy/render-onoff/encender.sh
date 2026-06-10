#!/usr/bin/env bash
# Enciende (reanuda) la lógica y el controlador en Render.
source "$(dirname "$0")/_lib.sh"
echo "Encendiendo los servicios de Auris en Render..."
accion resume
echo ""
warmup
echo ""
echo "✅ Listo. Ya puedes abrir la app sin error de cold-start."
