/**
 * Fase 11 — Bucle ReAct propio y verificador. Sin CrewAI ni dependencias externas.
 *
 * Un agente es un prompt de rol más un puñado de herramientas de SOLO LECTURA. El bucle:
 * el modelo elige una herramienta → se ejecuta → su resultado vuelve como observación en
 * texto → repite, hasta MAX_HERRAMIENTAS, y termina con un informe. Las observaciones van
 * como mensajes de usuario y no como mensajes de herramienta nativos: así funciona igual en
 * Groq y en Ollama, que no tratan igual ese formato.
 *
 * Por qué todo es pequeño: cada paso reenvía el historial, y Groq tiene un límite de 6.000
 * tokens por minuto (spec §3.9). Prompt de rol mínimo y observaciones recortadas.
 *
 * Los agentes nunca escriben. Si concluyen que hay que hacer algo, lo proponen en el informe
 * y el turno principal lo ejecuta con su gate de confirmación de siempre (B0).
 */

import { askClaude, askClaudeWithTools, AskClaudeOptions, ToolCallResponse } from '../llm/claude';
import { isSensitive } from '../tools/privacy';

const MAX_HERRAMIENTAS = 3;
const MAX_FALLIDAS     = 2;   // consultas repetidas o a herramientas inexistentes
const MAX_OBSERVACION  = 1200;
const SIN_CONSULTA     = 'Ahora mismo no he podido consultar los datos, señor. Inténtelo de nuevo en un minuto.';
const AVISO_SIN_VERIFICAR = '\n\n(Aviso: no he podido comprobar del todo este informe contra los datos, señor.)';

export interface AgentTool {
  name:        string;
  description: string;
  parameters:  Record<string, any>; // JSON Schema
  run:         (args: any) => Promise<string>;
}

export interface AgentDef {
  id:          string;
  nombre:      string;
  descripcion: string; // para el orquestador: cuándo delegar en este agente
  rol:         string; // prompt de rol del propio agente
  tools:       AgentTool[];
}

/** Lo que el bucle necesita del LLM. Inyectable para poder probarlo sin red. */
export interface LlmPort {
  conHerramientas: (prompt: string, tools: object[], opts: AskClaudeOptions) => Promise<ToolCallResponse>;
  texto:           (prompt: string, opts: AskClaudeOptions) => Promise<string>;
}

export const llmReal: LlmPort = { conHerramientas: askClaudeWithTools, texto: askClaude };

export interface ResultadoAgente {
  informe:       string;
  privado:       boolean; // alguna observación fue sensible: el bucle terminó en local
  verificado:    boolean;
  pasos:         string[]; // herramientas usadas, para el log
  observaciones: string[];
}

function recortar(s: string, n = MAX_OBSERVACION): string {
  return s.length <= n ? s : `${s.slice(0, n)}… [recortado]`;
}

function esquemas(tools: AgentTool[]): object[] {
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function promptAgente(agente: AgentDef): string {
  return `${agente.rol}

Trabajas para BAKO, el mayordomo de Borja ("el señor"). Tienes herramientas de solo lectura.
Úsalas para reunir los datos que necesites, de una en una. Cuando tengas suficiente, responde en
texto con tu informe: breve (máximo 6 frases), en español, en tono de mayordomo y con trato de
"señor". Usa SOLO lo que digan las observaciones; si un dato no está, dilo. Si crees que hay que
hacer algo (crear una tarea, cerrar un issue...), propónlo en el informe: tú no puedes hacerlo.`;
}

/**
 * Bucle ReAct. Si una observación es sensible (§3.3), el resto del bucle sigue en local:
 * esa observación viaja en el historial de los pasos siguientes.
 */
export async function bucleReAct(
  agente: AgentDef, tarea: string, opts: AskClaudeOptions, llm: LlmPort = llmReal,
): Promise<{ informe: string; pasos: string[]; observaciones: string[]; privado: boolean }> {
  const systemPrompt = promptAgente(agente);
  const historial: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const pasos: string[] = [];
  const observaciones: string[] = [];
  const llamadasHechas = new Set<string>();
  let privado = opts.private === true || isSensitive(tarea);
  let siguiente = `Tarea: ${tarea}`;

  const opcionesPaso = () => ({
    ...opts, systemPrompt, maxTokens: 700, temperature: 0.2,
    conversationHistory: historial,
    ...(privado ? { private: true, useCloud: false } : {}),
  });

  // Solo las consultas útiles cuentan para el tope. Las repetidas o a herramientas inexistentes
  // no lo gastan, pero tienen su propio límite para que un modelo atascado no gire sin fin
  let fallidas = 0;
  while (pasos.length < MAX_HERRAMIENTAS && fallidas < MAX_FALLIDAS) {
    const r = await llm.conHerramientas(siguiente, esquemas(agente.tools), opcionesPaso());
    if (!r.toolCall) {
      // OpenRouter es el escalón de Groq con 429 y va sin herramientas: sin observaciones, su
      // texto sería un informe inventado. Mejor decir que no se ha podido consultar
      if (r.provider === 'openrouter' && !observaciones.length) {
        return { informe: SIN_CONSULTA, pasos, observaciones, privado };
      }
      if (r.text.trim()) return { informe: r.text.trim(), pasos, observaciones, privado };
      break; // respuesta vacía (p. ej. qwen solo con <think>): se pide el informe en texto abajo
    }

    const tool = agente.tools.find(t => t.name === r.toolCall!.name);
    const clave = `${r.toolCall.name}:${JSON.stringify(r.toolCall.arguments ?? {})}`;
    historial.push({ role: 'user', content: siguiente });
    historial.push({ role: 'assistant', content: `[uso ${r.toolCall.name} con ${JSON.stringify(r.toolCall.arguments ?? {})}]` });

    let obs: string;
    if (!tool) { fallidas++; obs = `La herramienta ${r.toolCall.name} no existe. Usa solo las que tienes.`; }
    else if (llamadasHechas.has(clave)) { fallidas++; obs = 'Ya hiciste esta misma consulta. No la repitas: usa lo que tienes o redacta el informe.'; }
    else {
      llamadasHechas.add(clave);
      pasos.push(tool.name);
      try { obs = recortar(await tool.run(r.toolCall.arguments ?? {})); }
      // Un error de la herramienta puede venir de argumentos inventados: sale tal cual al modelo
      catch (err) { obs = `Error al consultar: ${(err as Error).message}`; }
      observaciones.push(`${tool.name}: ${obs}`);
      if (isSensitive(obs)) privado = true;
    }
    siguiente = `OBSERVACIÓN (${r.toolCall.name}):\n${obs}`;
  }

  // Tope de herramientas o respuesta vacía: se pide el informe sin dejarle llamar a ninguna más
  historial.push({ role: 'user', content: siguiente });
  const informe = (await llm.texto(
    'Ya no puedes consultar nada más. Redacta ahora el informe final con lo que tienes.',
    opcionesPaso(),
  )).trim();
  return { informe: informe || SIN_CONSULTA, pasos, observaciones, privado };
}

/**
 * Verificador: ¿el informe afirma algo que no esté en las observaciones? Devuelve null si no
 * se pudo verificar (fallo del modelo o respuesta ilegible), para no tratar eso como un "sí".
 */
export async function verificarInforme(
  informe: string, observaciones: string[], opts: AskClaudeOptions, llm: LlmPort = llmReal,
): Promise<{ ok: boolean; problemas: string[] } | null> {
  const prompt = `OBSERVACIONES (lo único que el agente sabe de verdad):
${observaciones.length ? observaciones.join('\n---\n') : '(ninguna: no consultó nada)'}

INFORME DEL AGENTE:
${informe}

¿El informe afirma algún dato concreto (nombres, cifras, fechas, estados) que NO aparezca en las
observaciones? Las propuestas ("conviene...", "podría...") y las frases de cortesía no cuentan.
Responde SOLO con JSON: {"ok": true|false, "problemas": ["dato inventado 1", ...]}`;
  try {
    const raw = await llm.texto(prompt, { ...opts, maxTokens: 500, temperature: 0, conversationHistory: undefined,
      systemPrompt: 'Eres un verificador estricto. Solo respondes JSON.' });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    if (typeof j.ok !== 'boolean') return null;
    return { ok: j.ok, problemas: Array.isArray(j.problemas) ? j.problemas.map(String).slice(0, 5) : [] };
  } catch {
    return null;
  }
}

/**
 * Agente completo: bucle → verificación → como mucho una reescritura. Si tras la reescritura
 * sigue sin pasar, o no se pudo verificar, el informe sale marcado para que el señor lo sepa.
 */
export async function ejecutarAgente(
  agente: AgentDef, tarea: string, opts: AskClaudeOptions, llm: LlmPort = llmReal,
): Promise<ResultadoAgente> {
  let r: Awaited<ReturnType<typeof bucleReAct>>;
  try {
    r = await bucleReAct(agente, tarea, opts, llm);
  } catch (err) {
    // Un agente hace varias llamadas seguidas: con Groq es fácil tocar el límite de 6.000 TPM
    // (§3.9). Mejor un mensaje claro que un "Request failed with status code 429"
    const e = err as { name?: string; message?: string; response?: { status?: number } };
    console.warn(`🤖 ${agente.nombre} falló:`, e.message);
    if (e.name === 'PrivacyError') return { informe: e.message ?? SIN_CONSULTA, verificado: false, privado: true, pasos: [], observaciones: [] };
    const informe = e.response?.status === 429 || e.response?.status === 413
      ? 'He llegado al límite de consultas del modelo en la nube, señor. Pruebe en un minuto o con el modelo local.'
      : SIN_CONSULTA;
    return { informe, verificado: false, privado: false, pasos: [], observaciones: [] };
  }
  const optsVer: AskClaudeOptions = r.privado ? { ...opts, private: true, useCloud: false } : opts;
  console.log(`🤖 ${agente.nombre}: ${r.pasos.length ? r.pasos.join(' → ') : 'sin herramientas'}`);

  const base = { privado: r.privado, pasos: r.pasos, observaciones: r.observaciones };
  let informe = r.informe;
  // "No he podido consultar" no necesita verificación ni aviso. Un informe SIN observaciones sí
  // se verifica: si el modelo contestó sin consultar nada, todo dato concreto es inventado
  if (informe === SIN_CONSULTA) return { informe, verificado: false, ...base };

  let v = await verificarInforme(informe, r.observaciones, optsVer, llm);
  if (v && !v.ok) {
    console.warn(`🤖 Verificador: ${v.problemas.join(' · ') || 'informe no respaldado'} → reescritura`);
    try {
      const reescrito = (await llm.texto(
        `Tu informe contenía datos que no están en las observaciones: ${v.problemas.join('; ') || 'sin detallar'}.\n\n`
        + `OBSERVACIONES:\n${r.observaciones.join('\n---\n')}\n\n`
        + `Reescríbelo usando SOLO esas observaciones, mismo tono y extensión.`,
        { ...optsVer, systemPrompt: promptAgente(agente), maxTokens: 700, temperature: 0.2, conversationHistory: undefined },
      )).trim();
      if (reescrito) {
        informe = reescrito;
        v = await verificarInforme(informe, r.observaciones, optsVer, llm);
      }
    } catch (err) {
      // Si falla la reescritura, el informe original sigue valiendo: sale con el aviso
      console.warn('🤖 Reescritura fallida, se conserva el informe original:', (err as Error).message);
    }
  }

  const verificado = v?.ok === true;
  if (!verificado) informe += AVISO_SIN_VERIFICAR;
  return { informe, verificado, ...base };
}
