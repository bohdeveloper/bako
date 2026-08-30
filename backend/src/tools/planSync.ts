/**
 * Sincronización plan.md → Notion (proyecto BAKO).
 *
 * plan.md es la fuente de verdad de lo que se ha hecho (invariante de
 * Spec-Driven Development, ver CLAUDE.md). Esta rutina lee el plan.md real de
 * GitHub, detecta qué líneas se han marcado `[x]` y compara contra las tareas
 * de BAKO todavía abiertas en Notion, para que el tablero no se quede
 * desincronizado cuando una tarea se cierra en el plan pero no en Notion.
 */

import axios from 'axios';
import { getNotionTasks, updateNotionTaskStatus, TAREA_HECHA } from './notion';
import { askClaude } from '../llm/claude';

const PLAN_MD_URL = 'https://raw.githubusercontent.com/bohdeveloper/bako/master/plan.md';

interface PlanItem {
  done: boolean;
  text: string;
}

async function fetchPlanMd(): Promise<string> {
  const { data } = await axios.get<string>(PLAN_MD_URL, { timeout: 10_000 });
  return data;
}

function parseCheckboxes(markdown: string): PlanItem[] {
  const items: PlanItem[] = [];
  const re = /^\s*-\s*\[([ xX])\]\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    items.push({
      done: m[1].toLowerCase() === 'x',
      text: m[2].replace(/\*\*/g, '').trim(),
    });
  }
  return items;
}

export interface PlanSyncResult {
  checked: number;
  updated: Array<{ taskId: string; nombre: string; matchedPlanLine: string }>;
}

// Sin tareas abiertas o sin líneas [x] no hay nada que comparar — evita
// gastar una llamada a Groq en vano.
export async function syncPlanWithNotion(): Promise<PlanSyncResult> {
  const [markdown, openTasks] = await Promise.all([fetchPlanMd(), getNotionTasks()]);

  const bakoTasks = openTasks.filter(t => t.proyecto.toLowerCase().includes('bako'));
  if (bakoTasks.length === 0) return { checked: 0, updated: [] };

  const doneItems = parseCheckboxes(markdown).filter(i => i.done);
  if (doneItems.length === 0) return { checked: bakoTasks.length, updated: [] };

  const prompt = `Tareas abiertas en Notion (proyecto BAKO):
${bakoTasks.map((t, i) => `${i}. ${t.nombre}`).join('\n')}

Líneas marcadas como completadas [x] en plan.md:
${doneItems.map((it, i) => `${i}. ${it.text}`).join('\n')}`;

  let raw: string;
  try {
    raw = await askClaude(prompt, {
      systemPrompt: `Comparas dos listas para detectar qué tareas de Notion ya están completadas según plan.md.
Empareja solo cuando describan el mismo trabajo con claridad — no emparejes por tema relacionado ni por coincidencia parcial.
Responde SOLO con JSON válido, un array con un objeto por cada coincidencia clara:
[{"notionIndex":0,"planIndex":2}]
Si ninguna tarea tiene coincidencia clara, responde [].`,
      maxTokens: 300,
      useCloud: true,
      temperature: 0,
    });
  } catch (err) {
    console.warn('⚠️  planSync: LLM matching falló:', (err as Error).message);
    return { checked: bakoTasks.length, updated: [] };
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return { checked: bakoTasks.length, updated: [] };

  let pairs: Array<{ notionIndex: number; planIndex: number }>;
  try {
    pairs = JSON.parse(match[0]);
  } catch {
    return { checked: bakoTasks.length, updated: [] };
  }

  const updated: PlanSyncResult['updated'] = [];
  for (const { notionIndex, planIndex } of pairs) {
    const task = bakoTasks[notionIndex];
    const planLine = doneItems[planIndex];
    if (!task || !planLine) continue;
    await updateNotionTaskStatus(task.id, TAREA_HECHA).catch(() => {});
    updated.push({ taskId: task.id, nombre: task.nombre, matchedPlanLine: planLine.text });
  }

  return { checked: bakoTasks.length, updated };
}
