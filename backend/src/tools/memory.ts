import { Memory, IMemory } from '../memory/Memory';
import { askClaude } from '../llm/claude';

export async function saveMemory(
  content: string,
  options: {
    type?:       IMemory['type'];
    importance?: IMemory['importance'];
    source?:     IMemory['source'];
    tags?:       string[];
  } = {}
): Promise<IMemory> {
  return Memory.create({
    content,
    type:       options.type       ?? 'fact',
    importance: options.importance ?? 'medium',
    source:     options.source     ?? 'extracted',
    tags:       options.tags       ?? [],
  });
}

export async function getMemories(): Promise<IMemory[]> {
  // Las 30 más recientes. profile.ts compacto (~5KB) + 30 memorias (~6KB) + prompt = seguro en Groq.
  // Todas las memorias siguen en Atlas — nunca se borran. Solo se limita lo que se inyecta.
  return Memory.find().sort({ updatedAt: -1 }).limit(30);
}

export async function searchMemories(query: string): Promise<IMemory[]> {
  const words = query.trim().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return Memory.find().sort({ createdAt: -1 }).limit(20);
  const regex = new RegExp(words.join('|'), 'i');
  return Memory.find({ content: regex }).sort({ importance: -1, createdAt: -1 }).limit(20);
}

export function formatMemoriesForPrompt(memories: IMemory[]): string {
  if (!memories.length) return '';
  return memories
    .map(m => {
      const fecha = new Date(m.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      return `• [${m.type}] ${m.content} (${fecha})`;
    })
    .join('\n');
}

export async function forgetMemory(hint: string): Promise<boolean> {
  const words = hint.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (!words.length) return false;
  const regex = new RegExp(words.join('|'), 'i');
  const memory = await Memory.findOne({ content: regex }).sort({ createdAt: -1 });
  if (!memory) return false;
  await memory.deleteOne();
  return true;
}

function inferLocationFromRoutine(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const hora = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  if (!isWeekend && hora >= 7 && hora < 15) return 'Inetum, Donostia';
  return process.env.WEATHER_CITY ?? 'Errentería';
}

const ROUTINE_CITIES = /errenteria|errentería|donostia|donosti/i;

export async function getCurrentLocation(): Promise<string> {
  try {
    const mem = await Memory.findOne({ tags: 'ubicacion-actual' }).sort({ createdAt: -1 });
    if (mem) {
      const loc = mem.content.replace(/^ubicaci[oó]n\s+actual[^:]*:\s*/i, '').trim();
      const ageHours = (Date.now() - new Date(mem.createdAt).getTime()) / 3_600_000;
      // Ciudad de viaje (no rutinaria) → se respeta indefinidamente
      // Ciudad rutinaria (Errentería/Donostia) → solo si fue guardada en las últimas 4h
      if (!ROUTINE_CITIES.test(loc) || ageHours < 4) return loc;
    }
  } catch {}
  // Sin override reciente → inferir por horario y rutina
  return inferLocationFromRoutine();
}

const EXTRACTION_SYSTEM = `Eres el sistema de memoria de BAKO, asistente personal de Borja.
Analiza la conversación y extrae SOLO hechos importantes y duraderos.

NO extraer: consultas de tiempo, noticias, saludos, datos ya en el perfil base (nombre, ciudad, trabajo en Inetum, rutina conocida).
SÍ extraer: bloqueos en proyectos, decisiones importantes, cambios de planes, preferencias nuevas, estados emocionales relevantes, actualizaciones de proyectos, metas nuevas.

Responde ÚNICAMENTE con JSON válido (sin texto adicional):
[{"content":"...","type":"fact|preference|project_update|decision|feeling","importance":"high|medium|low","tags":["tag1"]}]

Si no hay nada que merezca guardarse, responde exactamente: []`;

export async function extractAndSaveMemories(userMessage: string, assistantResponse: string): Promise<void> {
  try {
    const conversation = `Usuario: ${userMessage}\nBAKO: ${assistantResponse}`;
    const raw = await askClaude(conversation, {
      systemPrompt: EXTRACTION_SYSTEM,
      maxTokens:    400,
      useCloud:     false,
    });

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const entries = JSON.parse(jsonMatch[0]) as Array<{
      content:    string;
      type:       IMemory['type'];
      importance: IMemory['importance'];
      tags:       string[];
    }>;

    for (const entry of entries) {
      if (entry.content?.length > 10) {
        await saveMemory(entry.content, {
          type:       entry.type,
          importance: entry.importance,
          source:     'extracted',
          tags:       entry.tags ?? [],
        });
        console.log(`🧠 Memoria guardada: "${entry.content}"`);
      }
    }
  } catch {
    // Silent fail — la memoria es no crítica
  }
}
