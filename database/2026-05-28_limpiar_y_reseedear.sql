USE AurisDB;
SELECT TOP 5 c.curso_id, c.codigo, c.nombre, COUNT(a.aplicacion_id) AS aplicaciones_activas
FROM auris.curso c
LEFT JOIN auris.aplicacion_test a ON a.curso_id = c.curso_id AND a.activo = 1
WHERE c.activo = 1
GROUP BY c.curso_id, c.codigo, c.nombre
ORDER BY c.curso_id;