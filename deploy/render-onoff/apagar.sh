#!/usr/bin/env bash
# Apaga (suspende) la lógica y el controlador en Render. No se cobra cómputo.
source "$(dirname "$0")/_lib.sh"
echo "Apagando los servicios de Auris en Render..."
accion suspend
echo "Hecho. (Para encender: ./encender.sh)"
