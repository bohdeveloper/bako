/**
 * Middlewares de seguridad centralizados:
 * - Rate limiters por categoría de ruta
 * - Validación y sanitización de inputs de usuario
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

// ── Rate limiters ─────────────────────────────────────────────────────────────

/** Login: max 10 intentos / 15 min por IP — anti brute force */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Espera 15 minutos.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/** Endpoints LLM (voz, texto): max 30 req / 15 min por IP — evita abuso de cuota */
export const llmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones al LLM. Espera unos minutos.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/** General API: max 200 req / 15 min por IP — throttle global */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera unos minutos.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/** TTS: max 20 req / 15 min por IP — TTS es costoso en CPU */
export const ttsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de TTS. Espera unos minutos.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ── Validación de inputs ──────────────────────────────────────────────────────

const MAX_MESSAGE_LEN  = 4000;  // mensaje usuario al LLM
const MAX_PROMPT_LEN   = 4000;  // prompt directo al agente
const MAX_TEXT_FIELD   = 2000;  // campos de texto (nombre, descripcion, notas)
const MAX_TAGS_COUNT   = 20;
const MAX_TAG_LEN      = 100;
const MAX_USERNAME_LEN = 50;
const MAX_PASSWORD_LEN = 200;

/** Limpia una cadena: recorta espacios y elimina caracteres de control */
export function sanitizeString(s: unknown, maxLen = MAX_TEXT_FIELD): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLen);
}

/** Escapa caracteres especiales de regex para evitar ReDoS */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Valida el campo `message` en peticiones al LLM */
export function validateMessage(req: Request, res: Response, next: NextFunction): void {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'El campo message es obligatorio' });
    return;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ error: `El mensaje no puede superar ${MAX_MESSAGE_LEN} caracteres` });
    return;
  }
  req.body.message = sanitizeString(message, MAX_MESSAGE_LEN);
  next();
}

/** Valida el campo `prompt` en peticiones al agente */
export function validatePrompt(req: Request, res: Response, next: NextFunction): void {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'El campo prompt es obligatorio y no puede estar vacío' });
    return;
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    res.status(400).json({ error: `El prompt no puede superar ${MAX_PROMPT_LEN} caracteres` });
    return;
  }
  req.body.prompt = sanitizeString(prompt, MAX_PROMPT_LEN);
  next();
}

/** Valida credenciales de login */
export function validateCredentials(req: Request, res: Response, next: NextFunction): void {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    return;
  }
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    return;
  }
  if (username.length > MAX_USERNAME_LEN) {
    res.status(400).json({ error: `El nombre de usuario no puede superar ${MAX_USERNAME_LEN} caracteres` });
    return;
  }
  if (password.length > MAX_PASSWORD_LEN) {
    res.status(400).json({ error: `La contraseña no puede superar ${MAX_PASSWORD_LEN} caracteres` });
    return;
  }
  next();
}

/** Valida y sanitiza los tags de memoria (array de strings) */
export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter(t => typeof t === 'string' && t.trim().length > 0)
    .slice(0, MAX_TAGS_COUNT)
    .map(t => sanitizeString(t as string, MAX_TAG_LEN));
}

/** Construye una RegExp segura a partir de una query de búsqueda del usuario */
export function buildSafeSearchRegex(q: string): RegExp {
  const words = q.trim().split(/\s+/).filter(w => w.length > 2).map(escapeRegex);
  if (words.length === 0) throw new Error('Query vacía');
  return new RegExp(words.join('|'), 'i');
}
