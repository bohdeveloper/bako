import { ProfileOverride } from '../memory/ProfileOverride';
import { BAKO_PROFILE } from '../knowledge/profile';

// Campos del perfil que pueden actualizarse dinámicamente.
// `immutable:true` son datos que no cambian (o casi nunca) — checkStaleFields
// no debe molestar cada 90 días preguntando si un nombre o una fecha de
// nacimiento "siguen siendo correctos".
export const PROFILE_FIELDS: Record<string, { label: string; path: string[]; example: string; immutable?: boolean }> = {
  'identidad.nombre':           { label: 'Nombre',              path: ['identidad','nombre'],              example: 'Borja', immutable: true },
  'identidad.nombre_completo':  { label: 'Nombre completo',     path: ['identidad','nombre_completo'],     example: 'Nombre Apellido1 Apellido2', immutable: true },
  'identidad.fecha_nacimiento': { label: 'Fecha de nacimiento', path: ['identidad','fecha_nacimiento'],    example: 'DD/MM/AAAA', immutable: true },
  'identidad.sexo':             { label: 'Sexo',                path: ['identidad','sexo'],                example: 'Hombre/Mujer/Otro', immutable: true },
  'identidad.ubicacion':        { label: 'Ubicación',         path: ['identidad','ubicacion'],         example: 'Pontevedra, Galicia' },
  'identidad.empleador':        { label: 'Empleador',         path: ['identidad','empleador'],         example: 'Empresa X' },
  'identidad.situacion_laboral':{ label: 'Situación laboral', path: ['identidad','situacion_laboral'], example: 'Desarrollador en empresa X, trabajo remoto' },
  'identidad.oficina':          { label: 'Oficina',           path: ['identidad','oficina'],           example: 'Pontevedra' },
};

function getNestedValue(obj: any, path: string[]): any {
  return path.reduce((acc, key) => acc?.[key], obj);
}

/**
 * La edad se DERIVA de la fecha de nacimiento, no se guarda como campo aparte:
 * un número guardado a mano se queda obsoleto en silencio el día del cumpleaños
 * y obliga a que alguien se acuerde de corregirlo (era justo lo que intentaba
 * parchear el aviso de campos caducados). Con la fecha hay una sola fuente de
 * verdad y el dato nunca miente.
 */
function edadDesde(fechaNacimiento: string): string {
  const m = fechaNacimiento.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return '';
  const [, dia, mes, anio] = m;
  const nacimiento = new Date(Number(anio), Number(mes) - 1, Number(dia));
  // `new Date(1990, 1, 31)` no da NaN: desborda a marzo. Sin esta comprobación
  // un 31/02 mal tecleado saldría como una edad perfectamente creíble.
  if (Number.isNaN(nacimiento.getTime())
      || nacimiento.getDate()     !== Number(dia)
      || nacimiento.getMonth()    !== Number(mes) - 1
      || nacimiento.getFullYear() !== Number(anio)) return '';

  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const cumpleEsteAnio = new Date(hoy.getFullYear(), nacimiento.getMonth(), nacimiento.getDate());
  if (hoy < cumpleEsteAnio) edad--;
  return edad >= 0 && edad < 130 ? String(edad) : '';
}

// Devuelve el perfil base con los overrides aplicados encima
export async function getProfileOverrides(): Promise<Record<string, string>> {
  const overrides = await ProfileOverride.find();
  const result: Record<string, string> = {};
  for (const o of overrides) result[o.key] = o.value;
  return result;
}

// Genera el bloque de texto del perfil dinámico para el system prompt.
// Modo génesis (B2): sin dato ni override no se mete una línea vacía
// ("Empleador: "), y si no hay nada sembrado se avisa explícitamente en vez
// de dejar que el LLM interprete el silencio como pie para inventar.
export async function buildDynamicProfileContext(): Promise<string> {
  const overrides = await getProfileOverrides();
  const lines: string[] = [];

  for (const [key, meta] of Object.entries(PROFILE_FIELDS)) {
    const dynamic = overrides[key];
    const base = String(getNestedValue(BAKO_PROFILE, meta.path) ?? '');
    const value = dynamic ?? base;
    if (!value) continue;
    lines.push(`${meta.label}: ${value}`);

    // La edad va pegada a la fecha de nacimiento y calculada al vuelo — el señor
    // pidió que BAKO supiera su edad, y pedirle al LLM que reste años de una
    // fecha es la clase de cuenta que falla justo el día del cumpleaños.
    if (key === 'identidad.fecha_nacimiento') {
      const edad = edadDesde(value);
      if (edad) lines.push(`Edad: ${edad} años`);
    }
  }

  if (!lines.length) {
    return 'DATOS DE PERFIL: todavía no hay nada guardado sobre el señor. No inventes ningún dato — si te pregunta algo que no sabes, dilo con naturalidad.';
  }
  // Antes cada línea llevaba un "[actualizado]" para distinguir el override del
  // valor de `profile.ts`. Tras el reset de B2 ya no hay valor base para nada, así
  // que el tag marcaba el 100% de las líneas y solo servía para sugerirle al LLM
  // que eran cambios recientes cuando no lo son.
  return `DATOS DE PERFIL DEL SEÑOR:\n${lines.join('\n')}`;
}

// Actualiza un campo del perfil en MongoDB
export async function updateProfileField(
  key: string,
  newValue: string,
  source: 'manual' | 'conversation' | 'bako_suggestion' = 'manual'
// `reason` distingue "no existe ese campo" de "campo válido, valor rechazado":
// antes ambos casos devolvían el mismo ok:false y el /perfil manual acababa
// diciendo "campo no reconocido" ante una fecha de nacimiento perfectamente
// reconocida pero imposible (31/02) — encontrado en /code-review 16/09/2026.
): Promise<{ ok: boolean; label: string; prev: string; current: string; reason?: 'unknown_field' | 'invalid_value' }> {
  const meta = PROFILE_FIELDS[key];
  if (!meta) return { ok: false, label: key, prev: '', current: '', reason: 'unknown_field' };
  // La fecha de nacimiento alimenta un cálculo, no solo una línea de texto: si no
  // es una fecha real, rechazarla aquí en vez de dejar que `edadDesde` calle y el
  // perfil se quede con un valor del que nunca saldrá la edad.
  if (key === 'identidad.fecha_nacimiento' && !edadDesde(newValue)) {
    return { ok: false, label: meta.label, prev: '', current: '', reason: 'invalid_value' };
  }

  const existing = await ProfileOverride.findOne({ key });
  const prevValue = existing?.value ?? String(getNestedValue(BAKO_PROFILE, meta.path) ?? '');

  await ProfileOverride.findOneAndUpdate(
    { key },
    { key, label: meta.label, value: newValue, prevValue, source },
    { upsert: true, new: true }
  );

  return { ok: true, label: meta.label, prev: prevValue, current: newValue };
}

// Detecta si un mensaje natural contiene una actualización de perfil
// Devuelve { key, value } o null
export async function detectProfileUpdate(text: string): Promise<{ key: string; value: string } | null> {
  // Sin patrón para la edad: se calcula desde la fecha de nacimiento, así que
  // "hoy cumplo 36 años" no tiene ningún campo que actualizar (y apuntar a uno
  // inexistente haría que `updateProfileField` devolviera ok:false en silencio).
  // La fecha SÍ tiene patrón desde el 16/09/2026: el clasificador del cerebro la
  // excluye por ser campo de perfil, así que sin cauce aquí "nací el 12/03/1990"
  // no se guardaba en ninguna caja y la línea "Edad: N años" era inalcanzable.
  // Solo formato numérico — "nací el 12 de marzo de 1990" sigue sin recogerse.
  const patterns: Array<[RegExp, string]> = [
    [/(?:nac[ií]|mi fecha de nacimiento es|cumplo a[ñn]os)\s+(?:el\s+)?([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})/i, 'identidad.fecha_nacimiento'],
    [/(?:ya\s+no\s+trabajo|me\s+han\s+contratado|empiezo\s+a\s+trabajar|trabajo\s+ahora\s+en|nuevo\s+trabajo\s+en)\s+(.+)/i, 'identidad.empleador'],
    [/(?:me\s+he\s+mudado|me\s+mudo|vivo\s+ahora\s+en|estoy\s+viviendo\s+en)\s+(.+)/i, 'identidad.ubicacion'],
  ];

  for (const [pattern, key] of patterns) {
    const m = text.match(pattern);
    if (m) return { key, value: m[1].trim() };
  }

  return null;
}

// Comprueba campos que llevan más de N días sin actualizarse
// Devuelve alertas de staleness
export async function checkStaleFields(staleDays = 90): Promise<string[]> {
  const alerts: string[] = [];
  const cutoff = new Date(Date.now() - staleDays * 24 * 3_600_000);

  for (const [key, meta] of Object.entries(PROFILE_FIELDS)) {
    if (meta.immutable) continue; // un nombre o una fecha de nacimiento no caducan
    const override = await ProfileOverride.findOne({ key });
    // Solo alertar si el campo ya fue actualizado alguna vez (existe en DB)
    // y lleva más de staleDays sin tocarse
    if (override && new Date(override.updatedAt) < cutoff) {
      alerts.push(`El campo "${meta.label}" lleva más de ${staleDays} días sin actualizarse (último valor: "${override.value}"). ¿Sigue siendo correcto?`);
    }
  }

  return alerts;
}
