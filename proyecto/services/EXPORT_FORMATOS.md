# Export del banco de preguntas

Bloque P3.R10 (auditoría ISO 25010, Reemplazabilidad).

## Disponible ahora: CSV

Endpoint: `POST /base_logica/exportarBanco`
Body opcional: `{ profesorId }` para filtrar por creador.

Devuelve `text/csv` UTF-8 con BOM (para que Excel lo abra correctamente
con tildes). Una fila por alternativa; las columnas de la pregunta se
repiten en cada fila.

### Columnas

| Columna | Tipo | Notas |
|---|---|---|
| pregunta_id | int | clave estable |
| enunciado | string | HTML sanitizado |
| explicacion_clinica | string | HTML sanitizado |
| curso_codigo | string | ej. "KINE-401" |
| audio_grid_id | hex24 \| null | referencia GridFS |
| imagen_grid_id | hex24 \| null | referencia GridFS |
| video_grid_id | hex24 \| null | referencia GridFS |
| creado_por_correo | string | email del docente |
| created_at, updated_at | ISO 8601 | UTC |
| alt_orden | 1..5 | orden de la alternativa |
| alt_texto | string | texto de la alternativa |
| es_correcta | "0" \| "1" | RF-66 |

### Uso desde el panel

Por ahora se invoca directo:
```
curl -X POST http://localhost:3000/controlador_base/exportarBanco \
     -H "Authorization: Bearer <JWT>" \
     -H "Content-Type: application/json" \
     -d '{"arg":"{}"}' -o banco_auris.csv
```

(Cuando el frontend lo exponga, será un botón en `mis-preguntas`.)

## Futuro: QTI 2.1

[IMS Question and Test Interoperability 2.1](https://www.imsglobal.org/question/index.html)
es el formato estándar académico para preguntas y tests. Si la
universidad decide migrar a otro LMS (Moodle, Canvas, Blackboard), QTI
es lo que esos sistemas saben importar nativamente.

### Por qué no está implementado todavía

- Requiere generar XML siguiendo el manifest IMS Content Package.
- Cada pregunta es un `<assessmentItem>` con `<choiceInteraction>` y
  `<responseDeclaration>`.
- El audio/video se empaqueta dentro del ZIP final.
- El esfuerzo es significativo (~ 1 sprint) y la necesidad es eventual.

### Plan de implementación

Si se requiere:

1. Agregar `pregunta.service → exportarBancoQTI(profesorId)` que devuelve
   un stream ZIP.
2. Usar `archiver` para empaquetar.
3. Por cada pregunta, generar `items/q<id>.xml`:
   ```xml
   <assessmentItem identifier="q42" title="Auscultación normal" adaptive="false" timeDependent="false">
     <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
       <correctResponse><value>A</value></correctResponse>
     </responseDeclaration>
     <itemBody>
       <p>¿Qué sonido pulmonar normal...?</p>
       <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
         <simpleChoice identifier="A">Murmullo vesicular</simpleChoice>
         ...
       </choiceInteraction>
     </itemBody>
   </assessmentItem>
   ```
4. Generar `imsmanifest.xml` en la raíz del ZIP listando todos los items.
5. Incluir los binarios de GridFS en `resources/`.

### Librerías sugeridas

- `archiver` para ZIP streaming
- `xmlbuilder2` para generar XML
- `csv-stringify` ya cubre el caso CSV pero requeriría refactor

Cuando se vaya a implementar, abrir un ticket con esta sección como
spec base.
