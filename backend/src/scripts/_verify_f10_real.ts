/**
 * Verificación de la Fase 10 contra GitHub y Notion reales, SOLO LECTURA: no toca Mongo.
 * Reproduce lo que haría `registrarActividad` en memoria y pasa los detectores por encima.
 * Ejecutar: npx ts-node src/scripts/_verify_f10_real.ts
 */
import 'dotenv/config';
import { getCommitDatesSince, WATCHED_REPOS } from '../tools/github';
import { getNotionTasks, getFechasTareasHechas } from '../tools/notion';
import {
  madridDateKey, addDays, detectarRacha, detectarEnergia, textoRacha, textoEnergia, RegistroDia,
} from '../tools/patrones';

async function main() {
  const hoy = madridDateKey(new Date());
  const desde = addDays(hoy, -27);
  const inicio = new Date(Date.parse(`${desde}T00:00:00Z`) - 864e5);
  console.log(`Ventana: ${desde} → ${hoy} · repos vigilados: ${WATCHED_REPOS.join(', ')}`);

  const porDia = new Map<string, Map<string, number>>();
  const leidos: string[] = []; // como registrarActividad: un repo que falla no se registra como cero
  for (const repo of WATCHED_REPOS) {
    const fechas = await getCommitDatesSince(repo, inicio);
    if (!fechas) { console.log(`  ${repo}: sin datos (fallo o >500 commits) — no se registraría`); continue; }
    leidos.push(repo);
    console.log(`  ${repo}: ${fechas.length} commits del usuario`);
    for (const f of fechas) {
      const k = madridDateKey(new Date(f));
      if (!porDia.has(k)) porDia.set(k, new Map());
      porDia.get(k)!.set(repo, (porDia.get(k)!.get(repo) ?? 0) + 1);
    }
  }

  const hechas = await getFechasTareasHechas(inicio);
  console.log(`  Notion: ${hechas.length} tareas en Hecho editadas en la ventana`);
  const hechasPorDia = new Map<string, number>();
  for (const f of hechas) {
    const k = madridDateKey(new Date(f));
    hechasPorDia.set(k, (hechasPorDia.get(k) ?? 0) + 1);
  }

  const abiertas = await getNotionTasks();
  const conteo = new Map<string, number>();
  for (const t of abiertas) conteo.set(t.proyecto || 'General', (conteo.get(t.proyecto || 'General') ?? 0) + 1);
  console.log(`  Notion: ${abiertas.length} tareas abiertas en ${conteo.size} proyectos`);

  const registros: RegistroDia[] = [];
  for (let i = 0; i < 28; i++) {
    const fecha = addDays(desde, i);
    registros.push({
      fecha,
      commits: leidos.map(repo => ({ repo, n: porDia.get(fecha)?.get(repo) ?? 0 })),
      tareasHechas: hechasPorDia.get(fecha) ?? 0,
      ...(fecha === hoy ? { tareas: [...conteo].map(([proyecto, n]) => ({ proyecto, abiertas: n })) } : {}),
    });
  }

  const racha = detectarRacha(registros, hoy);
  const energia = detectarEnergia(registros, hoy);
  console.log('\nRacha:', racha ? textoRacha(racha) : '(ninguna)');
  console.log('Energía:', energia ? textoEnergia(energia) : '(sin patrón o sin muestras suficientes — esperado con <3 semanas)');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
