# Encender / Apagar Auris en Render (a voluntad)

Scripts para **prender y apagar** la lógica y el controlador en Render con un
comando, usando la API de Render. Apagados (suspended) **no se cobra cómputo**.

> MongoDB Atlas (M0) y Netlify quedan siempre encendidos (gratis). Azure SQL
> serverless se pausa solo. Lo único que conviene apagar son los 2 backends de
> Render → eso hacen estos scripts.

## Preparación (una sola vez)

1. **API key de Render:** Render → *Account Settings → API Keys → Create API Key*.
   Cópiala y expórtala en tu terminal (NO la pegues en ningún archivo):
   ```bash
   export RENDER_API_KEY="rnd_xxxxxxxxxxxxxxxxxxxxx"
   ```
   (Para no escribirla cada vez, agrégala a tu `~/.zshrc`.)

2. **IDs de los servicios:** en Render, abre cada servicio; el ID está en la URL
   (`.../web/srv-XXXXXXXX`) o en *Settings → Service ID*. Pégalos en
   [`config.sh`](config.sh):
   ```bash
   SRV_LOGICA="srv-........"
   SRV_CONTROLADOR="srv-........"
   ```

3. Dar permisos de ejecución (una vez):
   ```bash
   chmod +x apagar.sh encender.sh estado.sh
   ```

## Uso (desde tu terminal, en esta carpeta)

```bash
cd app_kinesiologia_logica/deploy/render-onoff

./encender.sh     # prende lógica + controlador
./estado.sh       # muestra si están encendidos o apagados
./apagar.sh       # los apaga (suspend) → deja de cobrar cómputo
```

- Tras `./encender.sh`, los servicios tardan **~1 min** en estar arriba.
- Puedes correrlos **desde cualquier carpeta** mientras pases la ruta, p. ej.
  `~/Auris/app_kinesiologia_logica/deploy/render-onoff/encender.sh`.

## ¿Dónde veo la página?

La **web** es el sitio del **frontend en Netlify**, no Render. Su URL aparece:
- en el **dashboard de Netlify** (cada sitio muestra su dirección), y
- al terminar el deploy (algo como `https://auris-xxxx.netlify.app`).

En Netlify puedes ponerle un nombre fijo en *Site settings → Change site name*
(p. ej. `https://auris-uv.netlify.app`). Esa es la dirección que compartes para
las pruebas. (Las URLs de Render son la **API**, no la página.)

> Si abres la web y la API no responde, probablemente los backends estén
> **apagados o "dormidos"**: corre `./encender.sh` y espera ~1 min (o la primera
> petición los despierta sola).
