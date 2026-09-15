/**
 * Detección de contenido sensible — invariante §3.3 de `spec.md`: lo que toque
 * estas palabras se procesa **solo en Ollama local** y nunca sale a la nube.
 *
 * Vive en su propio módulo porque lo necesitan dos sitios (el manejador de
 * mensajes de Telegram y el clasificador del cerebro) y duplicar el patrón sería
 * pedir que un día se añada una palabra en uno y no en el otro, dejando un
 * agujero silencioso justo en la regla que protege los datos.
 */
const SENSITIVE_PATTERN = /inetum|contrato|nómina|sueldo|salario|password|contraseña|token|secret|credencial|dni|seguridad social|banco|cuenta corriente|tarjeta/i;

export function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERN.test(text);
}
