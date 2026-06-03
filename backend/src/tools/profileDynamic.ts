import { ProfileOverride } from '../memory/ProfileOverride';
import { BAKO_PROFILE } from '../knowledge/profile';
import { askClaude } from '../llm/claude';

// Campos del perfil que pueden actualizarse dinámicamente
export const PROFILE_FIELDS: Record<string, { label: string; path: string[]; example: string }> = {
  'identidad.edad':             { label: 'Edad',              path: ['identidad','edad'],             example: '35' },
  'identidad.ubicacion':        { label: 'Ubicación',         path: ['identidad','ubicacion'],         example: 'Pontevedra, Galicia' },
  'identidad.empleador':        { label: 'Empleador',         path: ['identidad','empleador'],         example: 'Empresa X' },
  'identidad.situacion_laboral':{ label: 'Situación laboral', path: ['identidad','situacion_laboral'], example: 'Desarrollador en empresa X, trabajo remoto' },
  'identidad.oficina':          { label: 'Oficina',           path: ['identidad','oficina'],           example: 'Pontevedra' },
};

function getNestedValue(obj: any, path: string[]): any {
  return path.reduce((acc, key) => acc?.[key], obj);
}

// Devuelve el perfil base con los overrides aplicados encima
export async function getProfileOverrides(): Promise<Record<string, string>> {
  const overrides = await ProfileOverride.find();
  const result: Record<string, string> = {};
  for (const o of overrides) result[o.key] = o.value;
  return result;
}

// Genera el bloque de texto del perfil dinámico para el system prompt
export async function buildDynamicProfileContext(): Promise<string> {
  const overrides = await getProfileOverrides();
  const lines: string[] = [];

  for (const [key, meta] of Object.entries(PROFILE_FIELDS)) {
    const dynamic = overrides[key];
    const base = String(getNestedValue(BAKO_PROFILE, meta.path) ?? '');
    const value = dynamic ?? base;
    const tag = dynamic ? ' [actualizado]' : '';
    lines.push(`${meta.label}: ${value}${tag}`);
  }

  return lines.length ? `DATOS DE PERFIL ACTUALIZADOS:\n${lines.join('\n')}` : '';
}

// Actualiza un campo del perfil en MongoDB
export async function updateProfileField(
  key: string,
  newValue: string,
  source: 'manual' | 'conversation' | 'bako_suggestion' = 'manual'
): Promise<{ ok: boolean; label: string; prev: string; current: string }> {
  const meta = PROFILE_FIELDS[key];
  if (!meta) return { ok: false, label: key, prev: '', current: '' };

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
  const patterns: Array<[RegExp, string]> = [
    [/(?:ya\s+no\s+trabajo|me\s+han\s+contratado|empiezo\s+a\s+trabajar|trabajo\s+ahora\s+en|nuevo\s+trabajo\s+en)\s+(.+)/i, 'identidad.empleador'],
    [/(?:me\s+he\s+mudado|me\s+mudo|vivo\s+ahora\s+en|estoy\s+viviendo\s+en)\s+(.+)/i, 'identidad.ubicacion'],
    [/(?:ya\s+tengo|hoy\s+cumplo|acabo\s+de\s+cumplir)\s+(\d+)\s+años/i, 'identidad.edad'],
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
    const override = await ProfileOverride.findOne({ key });
    // Solo alertar si el campo ya fue actualizado alguna vez (existe en DB)
    // y lleva más de staleDays sin tocarse
    if (override && new Date(override.updatedAt) < cutoff) {
      alerts.push(`El campo "${meta.label}" lleva más de ${staleDays} días sin actualizarse (último valor: "${override.value}"). ¿Sigue siendo correcto?`);
    }
  }

  return alerts;
}
