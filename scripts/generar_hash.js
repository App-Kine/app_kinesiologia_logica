"use strict";

/**
 * Utilitario para generar bcrypt hashes manualmente.
 *
 * Requiere bcryptjs instalado:
 *   npm install bcryptjs --save
 *
 * Uso:
 *   node scripts/generar_hash.js "MiPassword!2026"
 *   node scripts/generar_hash.js "MiPassword!2026" admin@auris.local
 *
 * Salida: el hash bcrypt cost 12 + el UPDATE SQL correspondiente
 * (si pasas un correo como segundo argumento).
 */

const bcrypt = require("bcryptjs");

const password = process.argv[2];
const correo = process.argv[3];

if (!password) {
    console.error("Uso: node scripts/generar_hash.js \"password\" [correo]");
    process.exit(1);
}

// Validar política de RNF-13: min 10, mayús, minús, num, símbolo
const reglas = [
    { test: (p) => p.length >= 10,           msg: "mínimo 10 caracteres" },
    { test: (p) => /[A-Z]/.test(p),          msg: "al menos una mayúscula" },
    { test: (p) => /[a-z]/.test(p),          msg: "al menos una minúscula" },
    { test: (p) => /[0-9]/.test(p),          msg: "al menos un número" },
    { test: (p) => /[^A-Za-z0-9]/.test(p),   msg: "al menos un símbolo" },
];
const fallos = reglas.filter((r) => !r.test(password)).map((r) => r.msg);
if (fallos.length) {
    console.error("\nLa contraseña NO cumple RNF-13:");
    fallos.forEach((f) => console.error("  - " + f));
    console.error();
    process.exit(2);
}

const hash = bcrypt.hashSync(password, 12);
const verifica = bcrypt.compareSync(password, hash);

console.log();
console.log("Password:    " + password);
console.log("Hash bcrypt: " + hash);
console.log("Verifica OK: " + verifica);
console.log();

if (correo) {
    console.log("UPDATE auris.usuario");
    console.log(`   SET password_hash = '${hash}'`);
    console.log(` WHERE correo        = '${correo}';`);
    console.log();
}
