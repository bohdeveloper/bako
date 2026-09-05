/**
 * Cabecera de autenticación para el Ollama de casa expuesto por el túnel.
 *
 * El túnel publica `ollama.bohdeveloper.com` en internet, y Ollama no tiene
 * ninguna autenticación propia: cualquiera que sepa el hostname podría mandarle
 * prompts a la GPU del PC. Cloudflare estaba tapando eso a medias — bloqueaba a
 * los datacenters con un 403 (por eso Render nunca veía el túnel y el badge de
 * la PWA salía siempre gris) pero dejaba pasar al resto.
 *
 * La solución no es abrir el hostname, sino identificarse: el backend manda esta
 * cabecera y en Cloudflare hay una regla WAF que **bloquea todo lo que no la
 * lleve**. Así Render entra y nadie más.
 *
 * Si `OLLAMA_AUTH_KEY` no está definida no se manda nada, que es lo correcto en
 * local: ahí se habla con `localhost:11434` sin pasar por Cloudflare.
 */
export function ollamaHeaders(): Record<string, string> {
  const key = process.env.OLLAMA_AUTH_KEY;
  return key ? { 'x-bako-key': key } : {};
}
