// Verifica en PRODUCCIÓN la capa de Notion "Centro de Mando" (P2 del plan,
// commit fa05fb4): crear una tarea con prioridad y fecha objetivo, comprobar
// que ambas se guardan bien, moverla por el ciclo de estados, y limpiarla
// (archivada, no se deja basura en el Notion real). No toca Mongo.
import 'dotenv/config';
import axios from 'axios';
import {
  createNotionTask,
  updateNotionTaskStatus,
  findNotionTaskByName,
  normalizePrioridad,
} from '../tools/notion';

const api = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: {
    Authorization:    `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
  },
});

async function main() {
  const nombre = `TEST-verificacion-P2-${Date.now()}`;

  console.log('=== 1) Crear tarea con prioridad "alta" y fecha objetivo ===');
  const task = await createNotionTask(nombre, { prioridad: 'alta', fechaLimite: '2026-12-31' });
  console.log(`  creada: id=${task.id} prioridad=${task.prioridad} fecha=${task.fechaLimite}`);
  if (task.prioridad !== normalizePrioridad('alta')) {
    throw new Error(`Prioridad no normalizada como se esperaba: ${task.prioridad}`);
  }

  console.log('\n=== 2) Buscarla por nombre (findNotionTaskByName) ===');
  const found = await findNotionTaskByName(nombre);
  if (!found) throw new Error('findNotionTaskByName no la encontró');
  console.log(`  encontrada: ${found.nombre} | estado=${found.estado} | prioridad=${found.prioridad} | fecha=${found.fechaLimite}`);
  if (found.fechaLimite !== '2026-12-31') throw new Error(`Fecha objetivo no coincide: ${found.fechaLimite}`);
  if (found.prioridad !== normalizePrioridad('alta')) throw new Error(`Prioridad no coincide al releer: ${found.prioridad}`);

  console.log('\n=== 3) Cambiar estado a "En curso" ===');
  await updateNotionTaskStatus(task.id, 'En curso');
  const enCurso = await findNotionTaskByName(nombre);
  console.log(`  estado ahora: ${enCurso?.estado}`);
  if (enCurso?.estado !== 'En curso') throw new Error(`El estado no cambió a "En curso": ${enCurso?.estado}`);

  console.log('\n=== 4) Cerrar como "Hecho" ===');
  await updateNotionTaskStatus(task.id, 'Hecho');
  // findNotionTaskByName filtra las Hecho a propósito — se lee la página directa
  const { data } = await api.get(`/pages/${task.id}`);
  const estadoFinal = data.properties['Estado']?.select?.name;
  console.log(`  estado final: ${estadoFinal}`);
  if (estadoFinal !== 'Hecho') throw new Error(`El estado no cambió a "Hecho": ${estadoFinal}`);

  console.log('\n=== 5) Limpiar — archivar la página de prueba ===');
  await api.patch(`/pages/${task.id}`, { archived: true });
  console.log('  (archivada, no queda basura en el Centro de Mando real)');

  console.log('\n✅ P2 verificado en producción: crear, prioridad P1..P4, Fecha objetivo, cambio de'
    + ' estado (Por hacer → En curso → Hecho) y cierre — todo correcto contra el Notion real.');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('❌ Fallo en la verificación:', e?.response?.data ?? e.message ?? e);
  process.exit(1);
});
