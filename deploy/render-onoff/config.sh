#!/usr/bin/env bash
# =============================================================================
# Configuración de los scripts de encender/apagar (Render).
# -----------------------------------------------------------------------------
# 1) Pega aquí los IDs de tus 2 servicios en Render. Los ves en la URL del
#    servicio en el dashboard: https://dashboard.render.com/web/srv-XXXXXXXX
#    (también en Settings → "Service ID"). Empiezan con "srv-".
#
# 2) La API key NO va en este archivo (es un secreto). Expórtala en tu terminal
#    ANTES de correr los scripts:
#        export RENDER_API_KEY="rnd_xxxxxxxxxxxxxxxxxxxxx"
#    La generas en Render → Account Settings → API Keys → Create API Key.
# =============================================================================

SRV_LOGICA="srv-d8kcsef7f7vs73dl8qkg"
SRV_CONTROLADOR="srv-d8kdjpv7f7vs73dm5b2g"
