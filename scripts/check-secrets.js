#!/usr/bin/env node
/**
 * Escanea lo que está en el índice (staged) en busca de credenciales.
 * Se ejecuta desde el hook pre-commit: si encuentra algo, aborta el commit.
 *
 * Existe porque este repositorio es público y ya se filtraron una vez una URI de
 * MongoDB Atlas y un client secret de Google. Los placeholders de .env.example
 * ("usuario:password@cluster") están excluidos a propósito.
 *
 * Instalar el hook:  node scripts/check-secrets.js --install
 * Comprobar a mano:  node scripts/check-secrets.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PATTERNS = [
  ['URI de MongoDB con credenciales', /mongodb(\+srv)?:\/\/[^:/\s"'`]+:[^@\s"'`]+@/],
  ['Client secret de Google',         /GOCSPX-[A-Za-z0-9_-]{10,}/],
  ['Token de GitHub',                 /gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}/],
  ['API key de Groq',                 /gsk_[A-Za-z0-9]{40,}/],
  ['Token de Notion',                 /secret_[A-Za-z0-9]{40,}|ntn_[A-Za-z0-9]{40,}/],
  ['API key de Google',               /AIza[A-Za-z0-9_-]{33}/],
  ['Token de bot de Telegram',        /[0-9]{9,10}:AA[A-Za-z0-9_-]{33}/],
  ['API key de Anthropic/OpenAI',     /sk-ant-[A-Za-z0-9-]{20,}|sk-proj-[A-Za-z0-9-]{20,}/],
  ['Clave privada PEM',               /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// Valores de ejemplo que no son secretos
const PLACEHOLDERS = [
  /mongodb(\+srv)?:\/\/usuario:password@/,
  /mongodb:\/\/localhost:/,
  /<[A-Z_]+>/,
];

function esPlaceholder(linea) {
  return PLACEHOLDERS.some(p => p.test(linea));
}

if (process.argv.includes('--install')) {
  const raiz = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const hookDir = path.join(raiz, '.git', 'hooks');
  const hook = path.join(hookDir, 'pre-commit');
  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\nexec node scripts/check-secrets.js\n', { mode: 0o755 });
  console.log(`✅ Hook pre-commit instalado en ${hook}`);
  process.exit(0);
}

// Ficheros en el índice, sin los borrados
const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);

const hallazgos = [];

for (const fichero of staged) {
  let contenido;
  try {
    contenido = execSync(`git show :"${fichero}"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch {
    continue; // binario o ilegible
  }

  contenido.split('\n').forEach((linea, i) => {
    if (esPlaceholder(linea)) return;
    for (const [nombre, re] of PATTERNS) {
      if (re.test(linea)) hallazgos.push({ fichero, linea: i + 1, nombre });
    }
  });
}

if (hallazgos.length === 0) process.exit(0);

console.error('\n❌ COMMIT ABORTADO — hay credenciales en los ficheros preparados:\n');
for (const h of hallazgos) {
  console.error(`   ${h.fichero}:${h.linea}  →  ${h.nombre}`);
}
console.error('\nEste repositorio es público. Saca el valor a backend/.env (que está');
console.error('fuera de git) y deja solo un placeholder en el código.');
console.error('Si es un falso positivo: git commit --no-verify\n');
process.exit(1);
