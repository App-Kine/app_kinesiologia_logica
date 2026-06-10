#!/usr/bin/env bash
# Enciende (reanuda) la lógica y el controlador en Render.
source "$(dirname "$0")/_lib.sh"
echo "Encendiendo los servicios de Auris en Render..."
accion resume
echo "Hecho. Tardan ~1 min en estar arriba. (Estado: ./estado.sh)"
