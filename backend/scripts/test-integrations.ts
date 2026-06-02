import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getNotionTasks } from '../src/tools/notion';
import { getCalendarEvents } from '../src/tools/calendar';

async function run() {
  console.log('--- Notion ---');
  const tasks = await getNotionTasks();
  console.log('Tareas pendientes:', tasks.length);
  tasks.forEach(t => console.log(` • [${t.prioridad}] ${t.nombre}`));

  console.log('\n--- Google Calendar ---');
  const events = await getCalendarEvents(7);
  console.log('Eventos próximos (7 días):', events.length);
  events.forEach(e => console.log(` • ${e.start.slice(0, 16)} ${e.title}`));
}

run().catch(e => console.error('Error:', e.message));
