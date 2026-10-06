/**
 * Fase 10 — Aprendizaje de patrones.
 *
 * Dos capas separadas a propósito:
 *  - Detectores puros (`detectarRacha`, `detectarEnergia`, `textoEnergia`, `textoRacha`,
 *    `debePreguntarRacha`): sin I/O, sin LLM, sin coste. Son lo que verifica `_verify_f10.ts`.
 *  - I/O (`registrarActividad`, `observacionEnergia`, `rachaParaPreguntar`): alimenta el historial
 *    desde GitHub y Notion y lo lee para el briefing y la pregunta de racha.
 *
 * La "energía" es actividad medida, no estado de ánimo: commits del propio usuario más tareas de
 * Notion cerradas ese día. El briefing lo dice así ("actividad"), nunca como estado personal.
 */

import { ActividadDiaria, IActividadDiaria } from '../memory/ActividadDiaria';
import { AutoConfig } from '../memory/AutoConfig';
import { getCommitDatesSince, WATCHED_REPOS } from './github';
import { getNotionTasks, getFechasTareasHechas } from './notion';

const VENTANA_REGISTRO = 28;  // días que recalcula cada noche el job
const VENTANA_ANALISIS = 56;  // 8 semanas para medir la energía por día de la semana
export const DIAS_RACHA = 3;   // días sin commits con tareas abiertas antes de avisar
const MIN_DIAS_TOTAL   = 20;  // muestras laborables mínimas antes de afirmar nada
const MIN_MUESTRAS_DIA = 4;   // muestras mínimas de un mismo día de la semana
const RATIO_ALTA       = 1.5;
const RATIO_BAJA       = 0.5;

export interface RegistroDia {
  fecha:    string;
  commits:  { repo: string; n: number }[];
  tareas?:  { proyecto: string; abiertas: number }[];
  tareasHechas?: number; // mismo nombre que en ActividadDiaria: así los documentos de Mongo encajan tal cual
}

export interface Racha {
  proyecto: string;
  repo:     string;        // repo vigilado al que corresponde: clave estable aunque se renombre el proyecto
  diasSin:  number | null; // null = sin commits en toda la ventana registrada
  ultimo:   string | null; // fecha del último commit conocido
  abiertas: number;
}

export interface Energia {
  nivel:       'alta' | 'baja';
  diaSemana:   number; // 0 = domingo … 6 = sábado
  media:       number;
  mediaGlobal: number;
}

// ─── Fechas (todo en Europe/Madrid, claves YYYY-MM-DD) ───────────────────────

export function madridDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

function diaSemana(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function esLaborable(key: string): boolean {
  const d = diaSemana(key);
  return d >= 1 && d <= 5;
}

function actividadDia(r: RegistroDia): number {
  return r.commits.reduce((s, c) => s + c.n, 0) + (r.tareasHechas ?? 0);
}

// ─── Detectores puros ────────────────────────────────────────────────────────

/**
 * Un proyecto de Notion corresponde a un repo si la parte del nombre anterior al guion largo
 * coincide con el repo, sin mayúsculas ni acentos: "Diamadmin — reconstrucción kickstack" →
 * diamadmin, "Unyona — BETA" → unyona, "BAKO: bot" → bako. El guion normal NO separa:
 * "unyona-landing" o "unyona - landing" son otro repo, no unyona.
 */
export function proyectoCorrespondeARepo(proyecto: string, repo: string): boolean {
  const base = proyecto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .split(/\s*[—–:(]/)[0].trim();
  return base === repo.toLowerCase();
}

/**
 * Racha sin avanzar: un proyecto con tareas abiertas (según el último snapshot de Notion) y sin
 * commits desde hace DIAS_RACHA días o más. Solo cuenta proyectos que tienen repo vigilado con el
 * mismo nombre (sin distinguir mayúsculas); el resto no se puede medir y se ignora.
 */
export function detectarRacha(registros: RegistroDia[], hoy: string): Racha | null {
  const snapshot = registros
    .filter(r => r.tareas && r.fecha <= hoy)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (!snapshot?.tareas) return null;

  const candidatos: Racha[] = [];
  for (const { proyecto, abiertas } of snapshot.tareas) {
    if (abiertas <= 0) continue;
    const coincide = (repo: string) => proyectoCorrespondeARepo(proyecto, repo);

    const repo = registros.flatMap(r => r.commits).find(c => coincide(c.repo))?.repo;
    if (!repo) continue;

    let ultimo: string | null = null;
    for (const r of registros) {
      if (r.fecha > hoy) continue;
      if (r.commits.some(c => coincide(c.repo) && c.n > 0)) {
        if (!ultimo || r.fecha > ultimo) ultimo = r.fecha;
      }
    }

    const diasSin = ultimo ? diasEntre(hoy, ultimo) : null;
    if (diasSin === null || diasSin >= DIAS_RACHA) {
      candidatos.push({ proyecto, repo, diasSin, ultimo, abiertas });
    }
  }

  // La racha más larga gana; sin commits en la ventana cuenta como la más larga de todas
  candidatos.sort((a, b) => (b.diasSin ?? Infinity) - (a.diasSin ?? Infinity) || b.abiertas - a.abiertas);
  return candidatos[0] ?? null;
}

/**
 * Energía por día de la semana: compara la actividad media de hoy (si es laborable) con la media
 * laborable de las últimas 8 semanas. Solo afirma algo con muestras suficientes; si no, null.
 * Los fines de semana no entran: el briefing solo corre de lunes a viernes.
 */
export function detectarEnergia(registros: RegistroDia[], hoy: string): Energia | null {
  if (!esLaborable(hoy)) return null;

  const desde = addDays(hoy, -VENTANA_ANALISIS);
  const laborables = registros.filter(r => r.fecha >= desde && r.fecha < hoy && esLaborable(r.fecha));
  if (laborables.length < MIN_DIAS_TOTAL) return null;

  const mediaGlobal = laborables.reduce((s, r) => s + actividadDia(r), 0) / laborables.length;
  if (mediaGlobal === 0) return null;

  const dia = diaSemana(hoy);
  const delDia = laborables.filter(r => diaSemana(r.fecha) === dia);
  if (delDia.length < MIN_MUESTRAS_DIA) return null;

  const media = delDia.reduce((s, r) => s + actividadDia(r), 0) / delDia.length;
  const ratio = media / mediaGlobal;

  if (ratio >= RATIO_ALTA) return { nivel: 'alta', diaSemana: dia, media, mediaGlobal };
  if (ratio <= RATIO_BAJA) return { nivel: 'baja', diaSemana: dia, media, mediaGlobal };
  return null;
}

/**
 * Pregunta una vez por racha: el valor guardado es la fecha del último commit cuando se preguntó.
 * Mientras no haya un commit nuevo, la racha es la misma y no se vuelve a preguntar. Si el proyecto
 * vuelve a avanzar y luego se para, `ultimo` cambia y la pregunta vuelve a tener sentido.
 */
export function debePreguntarRacha(racha: Racha, valorGuardado: string | null): boolean {
  return valorGuardado !== (racha.ultimo ?? 'ninguno');
}

const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function tiempoSinCommits(racha: Racha): string {
  return racha.diasSin === null ? 'más de cuatro semanas' : `${racha.diasSin} días`;
}

/** Línea de energía para el briefing (solo hay una observación: esta). */
export function textoEnergia(energia: Energia): string {
  const dia = NOMBRE_DIA[energia.diaSemana];
  if (energia.nivel === 'alta') {
    return `Los ${dia} suele haber bastante actividad: buen día para lo más difícil.`;
  }
  return `Los ${dia} suele haber poca actividad, la mitad o menos que de media entre semana: conviene elegir una sola cosa para hoy.`;
}

/** Pregunta aparte, enviada tras el briefing. Termina en pregunta para no sonar a informe. */
export function textoRacha(racha: Racha): string {
  const tareas = racha.abiertas === 1 ? '1 tarea abierta' : `${racha.abiertas} tareas abiertas`;
  return `${racha.proyecto} lleva ${tiempoSinCommits(racha)} sin commits y tiene ${tareas}. ¿Está bloqueado, señor? Si me lo cuenta, lo tengo en cuenta.`;
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/**
 * Recalcula los últimos VENTANA_REGISTRO días y guarda el snapshot de tareas abiertas de hoy.
 * Si una fuente falla, se conserva lo que ya estaba guardado y no se registra un cero: GitHub por
 * repo y día, Notion por snapshot y por tareas cerradas. Un fallo nunca fabrica una racha ni una
 * baja de energía que no existen.
 */
export async function registrarActividad(ahora: Date = new Date()): Promise<void> {
  const hoy = madridDateKey(ahora);
  const desde = addDays(hoy, -(VENTANA_REGISTRO - 1));
  const inicio = new Date(Date.parse(`${desde}T00:00:00Z`) - 864e5);

  const recuentoPorRepo = new Map<string, Map<string, number> | null>();
  await Promise.all(WATCHED_REPOS.map(async repo => {
    const fechas = await getCommitDatesSince(repo, inicio);
    if (!fechas) { recuentoPorRepo.set(repo, null); return; }
    const porDia = new Map<string, number>();
    for (const f of fechas) {
      const k = madridDateKey(new Date(f));
      porDia.set(k, (porDia.get(k) ?? 0) + 1);
    }
    recuentoPorRepo.set(repo, porDia);
  }));

  // Tareas cerradas por día (si Notion falla, null y no se toca el campo)
  let hechasPorDia: Map<string, number> | null = null;
  try {
    const fechas = await getFechasTareasHechas(inicio);
    hechasPorDia = new Map<string, number>();
    for (const f of fechas) {
      const k = madridDateKey(new Date(f));
      hechasPorDia.set(k, (hechasPorDia.get(k) ?? 0) + 1);
    }
  } catch (err) {
    console.warn('⚠️  Patrones: no se pudieron leer las tareas cerradas:', (err as Error).message);
  }

  // Snapshot de tareas abiertas de hoy (si Notion falla, null y no se toca el campo)
  let tareas: { proyecto: string; abiertas: number }[] | null = null;
  try {
    const abiertas = await getNotionTasks();
    const conteo = new Map<string, number>();
    for (const t of abiertas) {
      const proyecto = t.proyecto || 'General';
      conteo.set(proyecto, (conteo.get(proyecto) ?? 0) + 1);
    }
    tareas = [...conteo].map(([proyecto, n]) => ({ proyecto, abiertas: n }));
  } catch (err) {
    console.warn('⚠️  Patrones: no se pudo leer Notion, se conserva el snapshot anterior:', (err as Error).message);
  }

  const existentes = await ActividadDiaria.find({ fecha: { $gte: desde } }).lean<IActividadDiaria[]>();
  const porFecha = new Map(existentes.map(e => [e.fecha, e]));

  const ops: any[] = [];
  for (let i = 0; i < VENTANA_REGISTRO; i++) {
    const fecha = addDays(desde, i);
    const previo = porFecha.get(fecha);
    const commits: { repo: string; n: number }[] = [];

    for (const repo of WATCHED_REPOS) {
      const porDia = recuentoPorRepo.get(repo);
      if (porDia) {
        commits.push({ repo, n: porDia.get(fecha) ?? 0 });
      } else {
        const anterior = previo?.commits.find(c => c.repo === repo);
        if (anterior) commits.push(anterior);
      }
    }

    const set: Record<string, unknown> = { commits };
    if (hechasPorDia) set.tareasHechas = hechasPorDia.get(fecha) ?? 0;   // mismo nombre que en el modelo
    if (fecha === hoy && tareas) set.tareas = tareas;
    ops.push({ updateOne: { filter: { fecha }, update: { $set: set }, upsert: true } });
  }

  await ActividadDiaria.bulkWrite(ops);
}

/** Línea de energía para el briefing, o null si no hay nada que afirmar con los datos. */
export async function observacionEnergia(ahora: Date = new Date()): Promise<string | null> {
  const hoy = madridDateKey(ahora);
  const registros = await cargarRegistros(hoy);
  const energia = detectarEnergia(registros, hoy);
  return energia ? textoEnergia(energia) : null;
}

/**
 * Racha pendiente de preguntar, o null si no hay racha o ya se preguntó por esta.
 * La clave de AutoConfig va por proyecto; el valor guardado es el último commit en el momento de
 * preguntar, para que `debePreguntarRacha` decida sin estado adicional.
 */
export async function rachaParaPreguntar(ahora: Date = new Date()): Promise<{ texto: string; clave: string; valor: string } | null> {
  const hoy = madridDateKey(ahora);
  const registros = await cargarRegistros(hoy);
  const racha = detectarRacha(registros, hoy);
  if (!racha) return null;

  const clave = `patron_racha_${racha.repo.toLowerCase()}`;
  const previa = await AutoConfig.findOne({ key: clave }).lean();
  if (!debePreguntarRacha(racha, previa?.value ?? null)) return null;

  return { texto: textoRacha(racha), clave, valor: racha.ultimo ?? 'ninguno' };
}

/** Marca como preguntada una racha, para no repetir la pregunta mientras siga igual. */
export async function marcarRachaPreguntada(clave: string, valor: string): Promise<void> {
  await AutoConfig.updateOne({ key: clave }, { $set: { value: valor, enabled: true } }, { upsert: true });
}

async function cargarRegistros(hoy: string): Promise<RegistroDia[]> {
  return ActividadDiaria
    .find({ fecha: { $gte: addDays(hoy, -VENTANA_ANALISIS) } })
    .lean<IActividadDiaria[]>();
}

/** Racha actual en texto, sin marcarla como preguntada (para el PM Agent de la Fase 11). */
export async function rachaActual(ahora: Date = new Date()): Promise<string | null> {
  const hoy = madridDateKey(ahora);
  const racha = detectarRacha(await cargarRegistros(hoy), hoy);
  return racha ? textoRacha(racha) : null;
}
