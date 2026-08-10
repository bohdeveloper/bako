/**
 * Helpers de fecha en la zona horaria de España.
 *
 * Vivían en tools/cloudflare.ts, que desapareció al desconectar BAKO de la base
 * D1 de bohdeveloper.com. No dependen de ningún servicio externo.
 */

export function nowInSpain(): Date {
  // Use formatToParts to avoid toLocaleString parsing ambiguity on UTC servers
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  const h = parseInt(p.hour);
  return new Date(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    h === 24 ? 0 : h, parseInt(p.minute), parseInt(p.second));
}

export function todayStringSpain(): string {
  const d = nowInSpain();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
