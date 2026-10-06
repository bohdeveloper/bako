/**
 * Verificación de la Fase 10 con datos sintéticos (sin Mongo, GitHub ni Notion).
 * Ejecutar: npx ts-node src/scripts/_verify_f10.ts
 */
import {
  addDays, detectarRacha, detectarEnergia, textoEnergia, textoRacha, debePreguntarRacha, RegistroDia,
} from '../tools/patrones';

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
}

// Lunes 2026-10-05 como "hoy" del briefing (laborable)
const HOY = '2026-10-05';

// ─── Racha ───────────────────────────────────────────────────────────────────

// Diamadmin con último commit hace 5 días; unyona commiteó ayer
const registrosRacha: RegistroDia[] = [];
for (let i = 1; i <= 28; i++) {
  registrosRacha.push({
    fecha: addDays(HOY, -i),
    commits: [
      { repo: 'diamadmin', n: 0 },
      { repo: 'unyona',    n: i === 1 ? 2 : 0 },
    ],
  });
}
registrosRacha.find(r => r.fecha === addDays(HOY, -5))!.commits[0].n = 3;
registrosRacha.find(r => r.fecha === addDays(HOY, -1))!.tareas = [
  { proyecto: 'Diamadmin', abiertas: 4 },
  { proyecto: 'Unyona',    abiertas: 2 },
  { proyecto: 'General',   abiertas: 9 },
];

const racha = detectarRacha(registrosRacha, HOY);
check('racha: detecta Diamadmin (5 días sin commits, 4 tareas)',
  racha?.proyecto === 'Diamadmin' && racha?.diasSin === 5 && racha?.abiertas === 4 && racha?.ultimo === addDays(HOY, -5),
  JSON.stringify(racha));
check('racha: Unyona no sale (commit ayer)', racha?.proyecto !== 'Unyona');
check('racha: "General" ignorado (no es repo)', racha?.proyecto !== 'General');

const sinRacha = detectarRacha(registrosRacha.map(r => ({ ...r, commits: r.commits.map(c => ({ ...c, n: 1 })) })), HOY);
check('racha: sin días de silencio no avisa', sinRacha === null, JSON.stringify(sinRacha));

const sinHistorial = detectarRacha([{ fecha: addDays(HOY, -1), commits: [], tareas: [{ proyecto: 'Diamadmin', abiertas: 3 }] }], HOY);
check('racha: sin datos del repo no afirma nada', sinHistorial === null);

const textoR = racha ? textoRacha(racha) : '';
check('pregunta de racha termina en pregunta de bloqueo',
  textoR.includes('¿Está bloqueado, señor?') && textoR.includes('5 días'), textoR);

// Una sola pregunta por racha: se pregunta, se guarda el último commit, y no se repite
check('racha: se pregunta si nunca se preguntó', !!racha && debePreguntarRacha(racha, null));
check('racha: no se repite si sigue igual', !!racha && !debePreguntarRacha(racha, racha.ultimo));
check('racha: vuelve a preguntar si hubo un commit nuevo y se paró otra vez',
  !!racha && debePreguntarRacha(racha, '2026-09-20'));

// ─── Energía ─────────────────────────────────────────────────────────────────

// 8 semanas de laborables: lunes casi sin actividad, resto ~6
const registrosEnergia: RegistroDia[] = [];
for (let i = 1; i <= 56; i++) {
  const fecha = addDays(HOY, -i);
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  if (d === 0 || d === 6) continue;
  const n = d === 1 ? (i % 2) : 6;
  registrosEnergia.push({ fecha, commits: [{ repo: 'diamadmin', n }] });
}

const energia = detectarEnergia(registrosEnergia, HOY);
check('energía: lunes detectado como baja', energia?.nivel === 'baja' && energia?.diaSemana === 1,
  JSON.stringify(energia));

const energiaMartes = detectarEnergia(registrosEnergia, '2026-10-06');
check('energía: martes sin patrón claro no afirma nada', energiaMartes === null, JSON.stringify(energiaMartes));

check('energía: fin de semana nunca se analiza', detectarEnergia(registrosEnergia, '2026-10-10') === null);
check('energía: con pocos datos no afirma nada', detectarEnergia(registrosEnergia.slice(0, 10), HOY) === null);

// Las tareas cerradas cuentan como actividad: un lunes sin commits pero con tareas cerradas no es "bajo".
// Se construyen con la forma que devuelve Mongo (tareasHechas), no con un nombre inventado.
const diaDe = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
const conHechas: RegistroDia[] = registrosEnergia.map(r => ({
  ...r,
  commits: r.commits.map(c => ({ ...c, n: 0 })),
  tareasHechas: 6, // todos los días cierran tareas: sin commits, pero con actividad parejo
}));
check('energía: tareas cerradas cuentan como actividad (sin commits, pero parejo: no sale patrón)',
  detectarEnergia(conHechas, HOY) === null, JSON.stringify(detectarEnergia(conHechas, HOY)));
const soloLunesSinHechas: RegistroDia[] = registrosEnergia.map(r => ({
  ...r,
  commits: r.commits.map(c => ({ ...c, n: 0 })),
  tareasHechas: diaDe(r.fecha) === 1 ? 0 : 6, // el lunes no cierra nada ni hace commits
}));
check('energía: sin tareas cerradas ni commits el lunes sí sale baja',
  detectarEnergia(soloLunesSinHechas, HOY)?.nivel === 'baja', JSON.stringify(detectarEnergia(soloLunesSinHechas, HOY)));

const textoE = energia ? textoEnergia(energia) : '';
check('texto de energía baja habla de actividad, no de ánimo',
  textoE.includes('poca actividad') && !/ánimo|cansad/i.test(textoE), textoE);

console.log(fallos === 0 ? '\n🎉 Todas las comprobaciones pasan' : `\n⚠️  ${fallos} comprobación(es) fallan`);
process.exit(fallos === 0 ? 0 : 1);
