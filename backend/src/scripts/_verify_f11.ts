/**
 * Verificación de la Fase 11 con un LLM simulado y agentes de prueba (sin red, sin Mongo).
 * Ejecutar: npx ts-node src/scripts/_verify_f11.ts
 */
import { AgentDef, LlmPort, bucleReAct, ejecutarAgente } from '../agents/react';
import { AskClaudeOptions, ToolCallResponse } from '../llm/claude';

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
}

const agente: AgentDef = {
  id: 'test', nombre: 'Test Agent', descripcion: '', rol: 'Agente de prueba.',
  tools: [
    { name: 'tareas', description: '', parameters: {}, run: async () => 'Diamadmin: 4 tareas abiertas' },
    { name: 'secreto', description: '', parameters: {}, run: async () => 'La nómina de Inetum es X' },
  ],
};

/** LLM guionizado: devuelve las respuestas en orden y registra las opciones de cada llamada. */
function guion(conTools: Array<Partial<ToolCallResponse>>, textos: string[]) {
  const llamadas: AskClaudeOptions[] = [];
  const llm: LlmPort = {
    conHerramientas: async (_p, _t, o) => { llamadas.push(o); return { text: '', provider: 'groq', ...(conTools.shift() ?? {}) } as ToolCallResponse; },
    texto: async (_p, o) => { llamadas.push(o); return textos.shift() ?? ''; },
  };
  return { llm, llamadas };
}
const tool = (name: string, args: Record<string, unknown> = {}) => ({ toolCall: { name, arguments: args } });

async function main() {
  // 1) Camino feliz: una herramienta, informe, verificador conforme
  {
    const { llm } = guion([tool('tareas'), { text: 'Diamadmin tiene 4 tareas abiertas, señor.' }], ['{"ok":true,"problemas":[]}']);
    const r = await ejecutarAgente(agente, 'estado', {}, llm);
    check('feliz: usa la herramienta y verifica', r.verificado && r.pasos.join() === 'tareas' && !r.informe.includes('Aviso'), r.informe);
  }
  // 2) Llamada repetida: no se ejecuta dos veces
  {
    const { llm } = guion([tool('tareas'), tool('tareas'), { text: 'Informe.' }], []);
    const r = await bucleReAct(agente, 'x', {}, llm);
    check('repetida: la herramienta se ejecuta una sola vez', r.pasos.length === 1, r.pasos.join());
  }
  // 3) Tope de herramientas: se pide el informe final sin herramientas
  {
    const { llm } = guion([tool('tareas', { a: 1 }), tool('tareas', { a: 2 }), tool('tareas', { a: 3 })], ['Informe final forzado']);
    const r = await bucleReAct(agente, 'x', {}, llm);
    check('tope: 3 herramientas y luego informe forzado', r.pasos.length === 3 && r.informe === 'Informe final forzado');
  }
  // 4) Herramienta inexistente: no rompe el bucle
  {
    const { llm } = guion([tool('inventada'), { text: 'Sin datos, señor.' }], []);
    const r = await bucleReAct(agente, 'x', {}, llm);
    check('inexistente: no se ejecuta y el bucle sigue', r.pasos.length === 0 && r.informe === 'Sin datos, señor.');
  }
  // 5) Verificador rechaza → reescritura → aprueba
  {
    const { llm } = guion([tool('tareas'), { text: 'Diamadmin tiene 9 tareas y Unyona 3.' }],
      ['{"ok":false,"problemas":["Unyona 3"]}', 'Diamadmin tiene 4 tareas abiertas.', '{"ok":true,"problemas":[]}']);
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('verificador: reescribe y queda verificado', r.verificado && r.informe === 'Diamadmin tiene 4 tareas abiertas.', r.informe);
  }
  // 6) Verificador ilegible → el informe sale con aviso, nunca como verificado
  {
    const { llm } = guion([{ text: 'Informe.' }], ['no soy json']);
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('verificador ilegible: aviso y no verificado', !r.verificado && r.informe.includes('Aviso'));
  }
  // 7) Privacidad: tras una observación sensible, las siguientes llamadas van en local
  {
    const { llm, llamadas } = guion([tool('secreto'), { text: 'Informe.' }], ['{"ok":true,"problemas":[]}']);
    await ejecutarAgente(agente, 'x', { useCloud: true }, llm);
    check('privacidad: el primer paso podía ir a la nube', llamadas[0].private !== true);
    check('privacidad: después de la observación sensible todo va en local',
      llamadas.slice(1).every(o => o.private === true && o.useCloud === false));
  }
  // 8) OpenRouter (Groq con 429) sin observaciones: no se inventa un informe
  {
    const { llm, llamadas } = guion([{ text: 'Texto inventado', provider: 'openrouter' }], []);
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('openrouter sin datos: dice que no pudo consultar y no verifica',
      r.informe.startsWith('Ahora mismo no he podido consultar') && llamadas.length === 1, r.informe);
  }
  // 9) Respuesta vacía: se pide el informe en texto
  {
    const { llm } = guion([tool('tareas'), { text: '' }], ['Informe tras vacío', '{"ok":true,"problemas":[]}']);
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('vacía: se recupera con un informe en texto', r.informe === 'Informe tras vacío', r.informe);
  }
  // 10) La reescritura falla: se conserva el informe original con aviso
  {
    let n = 0;
    const llm: LlmPort = {
      conHerramientas: async () => (n++ === 0 ? { text: '', provider: 'groq', ...tool('tareas') } : { text: 'Original.', provider: 'groq' }) as ToolCallResponse,
      texto: async (p) => { if (p.startsWith('Tu informe')) throw new Error('429'); return '{"ok":false,"problemas":["x"]}'; },
    };
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('reescritura fallida: conserva el original con aviso', r.informe.startsWith('Original.') && r.informe.includes('Aviso'), r.informe);
  }

  // 11) El resultado lleva la marca de privado para que el turno no acabe en la sesión
  {
    const { llm } = guion([tool('secreto'), { text: 'Informe.' }], ['{"ok":true,"problemas":[]}']);
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('privacidad: el resultado sale marcado como privado', r.privado === true);
  }
  // 12) Sin consultar nada, un informe con datos también pasa por el verificador
  {
    const { llm, llamadas } = guion([{ text: 'Diamadmin lleva 9 días parado.' }], ['{"ok":false,"problemas":["9 días"]}', 'No tengo datos, señor.', '{"ok":true,"problemas":[]}']);
    const r = await ejecutarAgente(agente, 'x', {}, llm);
    check('sin observaciones: el dato inventado se verifica y se reescribe',
      r.informe === 'No tengo datos, señor.' && llamadas.length === 4, r.informe);
  }

  console.log(fallos === 0 ? '\n🎉 Todas las comprobaciones pasan' : `\n⚠️  ${fallos} comprobación(es) fallan`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
