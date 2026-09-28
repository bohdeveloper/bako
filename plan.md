# plan.md — BAKO

> Plan de trabajo vivo (Spec-Driven Development). Contexto, arquitectura y metodología en [spec.md](spec.md).
> Reglas: nada se implementa sin su punto aquí · al terminar se marca `[x]` con fecha ·
> las tareas grandes se desglosan en fases antes de empezar.
> Fusiona el antiguo `ROADMAP.md` (eliminado el 14/08/2026; su detalle punto por punto vive en el
> historial de git).

---

## Estado actual (05/09/2026)

**El objetivo del proyecto se ha reenfocado.** BAKO funciona como asistente (lee agenda, tareas,
correo, clima; ejecuta acciones en Notion, Calendar, GitHub y Gmail; es proactivo con 7 crons), pero
su conocimiento sobre Borja está **hardcodeado en `profile.ts`** y solo aprende frases sueltas. Lo
que se quiere es lo contrario: un BAKO que **parte de cero**, construye su conocimiento hablando,
**pregunta con criterio** lo que le falta, y sabe **conectar y deducir** en vez de recitar. Eso es
ahora la prioridad 1 y tiene bloque propio abajo (**🧠 El cerebro de BAKO**).

Del 30/08 al 05/09/2026: 7 commits (routing LLM local/nube, voz TTS persistida, silenciar + volumen,
cabecera móvil, GPU nueva en marcha). Seguridad cerrada del todo.

| Horizonte / fase | Estado |
|---|---|
| **Horizonte 0** — los 5 gaps del mayordomo (memoria, ejecución, proactividad, acceso, conocimiento vivo) | ✅ Cerrado |
| Fase 5 — Email inteligente (Gmail) | ✅ |
| Fase 6 — Redes sociales | ⛔ Diferida (APIs de pago) |
| Fase 7 — Panel de administración | ✅ |
| Fase 7b — Memoria cognitiva (A/B/C/D) | ✅ |
| Fase 7c — Rate limits de Groq | ⏳ 3 de 4 pasos |
| Fase 8 — Automatización sin n8n | ✅ |
| Fase 9 — Wake word y modo conversación | ⏳ PWA escritorio sí; móvil y Desktop pendientes |
| **Seguridad** — hardening y retirada de secretos | ✅ Historial purgado y credenciales rotadas (30/08/2026) |
| **Tooling** — Spec-Driven + grafo `codebase-memory-mcp` | ✅ 14/08/2026 |
| **LLM local** — GPU de 8 GB y Ollama por defecto | ✅ 05/09/2026 |
| **🧠 El cerebro de BAKO** — de perfil hardcodeado a memoria viva | ✅ Cerrado (B0-B6, 28/09/2026) |
| Horizonte 2 — Multi-agente y fine-tuning | ❌ No empezado (después del cerebro) |
| Horizonte 3 — Identidad propia (visión, dispositivos, casa) | ❌ No empezado |
| Horizonte 4 — Presencia física (robótica) | ❌ No empezado en este repo — prerequisito de aprendizaje en marcha, ver nota en Horizonte 4 |

---

## Prioridades pendientes (de más a menos importante)

Todo lo de Horizonte 1 hacia abajo estaba disperso en varias fases; se ordena aquí una sola vez por
impacto real en tener un mayordomo potente y seguro. Las fases 7c/9/6 conservan su detalle técnico
íntegro, solo cambian de posición. El antiguo P1 (seguridad) se cerró del todo el 30/08/2026 (visto
hoy, 01/09/2026, al sincronizar con Notion) y su detalle vive ahora en el histórico, bloque
"Seguridad — hardening y retirada de secretos".

---

## 🧠 El cerebro de BAKO — prioridad 1 (reenfoque del 05/09/2026)

**Lo que se quiere:** que BAKO **parta de cero**, vaya formando su conocimiento sobre Borja y su
entorno **poco a poco y con preguntas sólidas**, tenga la inteligencia y el interés de acabar
sabiendo lo que necesita, y sepa **hacer conexiones y deducir** — no recitar fichas.

**Por qué hoy no lo es** (auditoría del 05/09/2026 sobre los 48 ficheros del backend):

- `knowledge/profile.ts` son **306 líneas de la vida de Borja escritas a mano en el código**. Es el
  opuesto exacto de partir de cero, y además va en un repo público
- Las acciones se disparan con **regex** (`actions.ts`), no con tool-calling: "apúntame que tengo que
  llamar al fontanero" no crea nada porque no encaja el patrón. Cada capacidad nueva = otro regex
- El único aprendizaje automático (`extractAndSaveMemories`) solo escribe **frases sueltas** en
  `Memory`. **Nunca** crea ni actualiza una Persona, un Proyecto o un Conocimiento
- BAKO **no pregunta nunca**. No tiene forma de saber qué le falta, ni de pedirlo
- No hay relaciones entre las piezas del cerebro ni deducción: `Person`, `Project` y
  `KnowledgeEntry` son tres listas planas que se vuelcan al prompt
- Solo puede borrar con "olvida X" sobre `Memory`; Personas, Proyectos y Conocimiento son intocables
  desde la conversación

Las fases van en orden: cada una necesita la anterior.

### B0 — Tool-calling en vez de regex (la base) ✅ 05/09/2026

Era el desbloqueo: sin esto todo lo demás eran parches. Ambos modelos en uso lo soportan de forma
nativa (`openai/gpt-oss-120b` en Groq, `qwen3:8b` en Ollama).

- [x] Registro de herramientas con esquema JSON en `tools/agent.ts` (nuevo), y el LLM eligiendo cuál
  llamar y con qué argumentos en la MISMA llamada que ya se hacía para responder — no dobla el número
  de peticiones al LLM por mensaje respecto a antes
- [x] `askClaudeWithTools()` en `llm/claude.ts`: mismo formato de herramienta (compatible OpenAI) para
  Groq y Ollama, con la misma cadena de resiliencia que `askClaude` (Ollama → Groq → OpenRouter en
  429), salvo que en el escalón de OpenRouter va **sin herramientas** — sus modelos gratuitos no
  tienen tool-calling fiable, así que ese peldaño degrada a conversación pura en vez de arriesgar una
  acción alucinada
- [x] Migradas las 6 acciones de `actions.ts` (crear tarea, actualizar estado, crear evento, crear
  issue, cerrar issue, siguiente acción) a herramientas en `agent.ts`, y **`actions.ts` borrado del
  todo** — cero regex de detección de intención en el repo
- [x] **Confirmación explícita antes de acciones irreversibles** — absorbe el viejo Gap 2 de P2. Cada
  herramienta declara `destructive`; hoy solo `crear_evento_calendario` lo es (compromiso real en el
  calendario). La confirmación es texto libre ("sí"/"no") con estado en memoria (`pendingActions`,
  TTL 5 min) para que funcione igual en Telegram, PWA y Desktop sin depender de botones inline
- [x] **Hallazgo de pruebas real, no en el plan original**: probado con los 4 casos de prueba antes de
  dar esto por bueno (crear tarea, crear evento, dos charlas normales) — **Groq acertó las 4, `qwen3:8b`
  en Ollama alucinó una acción al pedirle un chiste** (creó una tarea de Notion inventada sin que
  nadie lo pidiera). Hasta que haya un modelo local más fiable para esto, el gate de confirmación
  cubre **todas** las herramientas cuando responde Ollama, no solo las `destructive` — decidido por
  quién respondió de verdad (`result.provider`), no por lo que se pidió, para no penalizar el modo
  "auto" cuando Ollama está caído y responde Groq por debajo
- [x] Hallazgos de `/code-review` corregidos antes de cerrar: el gate de confirmación miraba
  `options.useCloud` (lo pedido) en vez de qué proveedor respondió de verdad; sin validación de
  campos `required` antes de pedir confirmación (un evento sin `fin` habría fallado con un error
  opaco de Google Calendar tras confirmar); `describeArgs` interpolaba texto libre del LLM sin
  escapar en un mensaje que Telegram parsea como Markdown (un `_` suelto rompía el envío entero)
- [x] Verificado con pruebas aisladas contra Ollama y Groq reales (sin tocar Notion/Calendar de
  verdad — canceladas antes de ejecutar), y `npm run build` limpio. Archivos: `llm/claude.ts`,
  `tools/agent.ts` (nuevo, sustituye a `tools/actions.ts`), `routes/desktop.ts`, `tools/telegram.ts`
- No se implementó: bucle multi-paso (varias herramientas encadenadas en un turno) — las 6
  herramientas actuales no lo necesitan, se añadirá si B1 lo pide de verdad
- [x] **Repaso posterior de B0 (05/09/2026): el gate de confirmación estaba roto y se ha
  reescrito.** El matcher era `/^(s[ií]|...|vale|ok|correcto)\b/` y fallaba en las dos direcciones a
  la vez, saltándose el invariante #14 de `spec.md` (`\b` prohibido en regex en español):
  - **Rechazaba "sí"** con tilde — justo la palabra que el propio bot pedía y la que transcribe
    Whisper en las notas de voz. La acción pendiente se descartaba en silencio y no se ejecutaba
    nada. Con `LLM_PREFER_LOCAL=true` (Ollama por defecto → toda acción pide confirmación), eso
    dejaba **imposible completar cualquier acción** en el flujo normal
  - **Ejecutaba con frases corrientes**: "Si mañana llueve…", "Si puedes, dime…", "ok pero antes…",
    "Correcto, aunque…" disparaban la acción pendiente sin que nadie la hubiera confirmado —
    justo el fallo que el gate existía para evitar
  - Sustituido por comparación de **frase completa normalizada** (sin acentos ni signos) contra una
    lista, más una segunda vía acotada para confirmaciones más habladas ("sí, por favor créalo ya"):
    máximo 5 palabras, primera palabra de sí/no, sin adversativas y sin ser pregunta
  - **Botones inline en Telegram** (✅ Confirmar / ❌ Cancelar), como ya se hacía con el email, para
    no depender de acertar la palabra. La lista de frases se queda para PWA y Desktop
  - Verificado con 21 casos, incluidos los 6 que fallaban antes
- [x] Otros arreglos del mismo repaso: `turn.voice` se construía y luego se ignoraba en Telegram (la
  voz leía el volcado de argumentos en vez del texto preparado); los resultados de las herramientas
  interpolaban nombres sin escapar dentro de Markdown (`*${task.nombre}*` con un `_` rompía el envío
  y el señor veía un error aunque la tarea sí se hubiera creado) — ahora van por `md()` y, por si
  acaso, `sendMarkdownSafe()` reintenta en crudo antes que perder el mensaje; y la confirmación decía
  "Voy a *crea un evento…*" porque troceaba la descripción destinada al LLM (ahora cada herramienta
  tiene su propia etiqueta legible)
- [x] **BAKO sabe dónde se ejecuta** (05/09/2026) — preguntado "¿estás usando la GPU de mi PC?"
  contestó *"estoy operando como un modelo de lenguaje basado en la nube"* mientras corría en la GPU
  de casa: no tenía el dato y se lo inventaba. `runAgentTurn` inyecta ahora una línea de EJECUCIÓN
  ACTUAL con el proveedor y el modelo reales. Se decide por **quién va a responder de verdad**
  (sondeo cacheado), no por lo que se pidió: en modo "auto" se pide Ollama sin comprobar nada y, con
  el túnel caído, responde Groq — decir lo contrario sería crear la misma alucinación que se quería
  quitar. De paso, la caché del sondeo se unifica en `llm/claude.ts` (había dos independientes
  sondeando el túnel por separado). Verificado en vivo con Groq: *"estoy ejecutándome en la nube con
  el modelo openai/gpt-oss-120b"*
- [x] PWA: al terminar el turno vuelve el cursor al input, para encadenar mensajes sin pinchar. Solo
  si el turno se inició **escribiendo** — tras una nota de voz abriría el teclado del móvil sin que
  nadie lo pida — y sin robar el foco si hay otro campo activo o el panel de admin abierto

### B1 — Herramientas sobre su propio cerebro

Que BAKO escriba en su memoria **por las mismas vías que actúa fuera**. "Ibon se ha mudado a Bilbao"
debe actualizar la *Persona* Ibon, no crear una frase suelta.

- [x] **Un clasificador que decida en qué caja va cada dato** (06/09/2026) — `tools/brain.ts`
  sustituye a `extractAndSaveMemories`: decide si algo es `persona` (`Person`), `conocimiento`
  (`KnowledgeEntry`) o `recuerdo` (`Memory`), y si crea o actualiza algo que ya existe. Corre en
  background tras cada turno de Telegram/PWA/Desktop, **no como tool del LLM**: con Ollama de
  defecto cada llamada a herramienta pasa por el gate de confirmación (B0), y pedir permiso por
  cada dato aprendido haría la conversación inusable. Sustituye también al botón manual "Migrar
  memoria" del panel (7b), que ya no hace falta para lo nuevo
  - Clasificar es razonamiento estructurado que el modelo local no aguanta: medido con "he
    conocido a X, amigo de Julen que vive en Hernani y es profesor", `qwen3:8b` devolvió `[]` y
    Groq creó la ficha completa con la conexión. Se clasifica en la nube salvo turno sensible
    (invariante §3.3), que se queda en local aunque eso signifique aprender menos de él
  - Guardarraíl contra alucinación de nombres: el nombre propuesto debe aparecer literalmente
    (normalizando acentos) en la conversación — probado que ante "te presento a ZZOtroTest" el
    modelo creó una ficha "ZoetroTest"; sin el filtro, el cerebro se llena de "Ibon"/"Iban" que no
    se hablan entre sí
- [x] **Trazabilidad** (06/09/2026) — `Person` y `KnowledgeEntry` ganan `fuente` (cómo NACIÓ la
  ficha: `manual`/`conversacion`, no cambia al actualizar) y `origen` (la frase del último cambio,
  sí se actualiza). Máximo 300 caracteres del mensaje del usuario
- [x] **Que BAKO pueda consultarse** (06/09/2026) — tool `consultar_cerebro`, de solo lectura
  (`soloLectura:true` en `ToolDef`, nunca pide confirmación ni con el modelo local: en el peor caso
  devuelve una búsqueda que no venía a cuento). Mira las tres cajas a la vez
- [x] **Actualizar hablando** para `Person` y `KnowledgeEntry`, no solo crear — cubierto por el
  clasificador de arriba. Notas y conexiones de una Persona se acumulan, no se reemplazan
- [ ] **Borrar hablando** — sigue sin existir para `Person`/`KnowledgeEntry` (solo "olvida X" sobre
  `Memory`, invariante §3.3/§7 de todos modos exige confirmación explícita para borrar)
- [ ] `Project` queda fuera del clasificador — sigue sin actualizarse hablando
- [ ] CRUD explícito como *herramientas* del LLM (en vez de clasificador en background) — se
  descartó a propósito por el problema del gate de confirmación de arriba; no se retoma salvo que
  un modelo local más fiable lo haga viable
- Hallazgos de dos rondas de `/code-review` corregidos antes de cerrar: la búsqueda de Persona por
  nombre/alias no toleraba acentos aunque el guardarraíl de arriba sí los normalizaba (creaba
  "Inigo" duplicado en vez de actualizar "Íñigo"); actualizar solo `importancia` sin cambiar
  `valor` se descartaba en silencio; reenviar el mismo dato sin cambios pisaba `origen` igualmente,
  perdiendo la trazabilidad del último cambio real; una `KnowledgeEntry` desactivada no se
  encontraba y el tema reaparecía como duplicado en vez de avisar "desactivada: no se usará"
  (como ya hacía `Person`); el log de fallo del clasificador decía siempre "no local" aunque el
  peldaño que fallara fuera la nube
- Fuga de privacidad corregida antes de cerrar (invariante §3.3): `generateEmbedding` caía a
  Cloudflare Workers AI si Ollama no respondía, sin mirar si el contenido era sensible — igual que
  la decisión ACTUALIZAR/CREAR de `deduplicateAndSave` caía a Groq. Flag `privado` añadido y
  enhebrado por `generateEmbedding` → `saveMemory`/`searchMemories`/`deduplicateAndSave` →
  `askClaude({private:true})`, incluida la tool nueva `consultar_cerebro` cuando el propio tema
  preguntado es sensible. `/security-review` sin hallazgos tras la corrección
- Riesgo conocido sin resolver, anotado para no repetir el hallazgo: `loQueYaSabe` recorta las
  claves de conocimiento sensibles/`legal/` antes de mandarlas a Groq, pero manda la lista completa
  de **nombres de personas** sin ese mismo filtro — igual que el resto del prompt normal (Personas,
  Proyectos, Memorias ya viajan enteros a Groq en cada turno), así que no es una regresión de esta
  fase, pero tampoco se ha resuelto
- Verificado con `backend/src/scripts/_verify_b1.ts` (turno normal crea Persona con conexión
  correcta, ficha desactivada avisa sin reactivarse sola, turno sensible se descarta en vez de
  salir a la nube) y `npm run build` limpio

### B2 — Partir de cero de verdad

**Decisión del señor (15/09/2026), más estricta que el planteamiento original de este bloque**: no
es una migración de `profile.ts` a la BD, es un **reset real**. Sembrado mínimo — nombre, nombre
completo, fecha de nacimiento, sexo, lugar de residencia — y todo lo demás (familia, proyectos
personales, perfil técnico, rutina, salud, finanzas, legal...) se **descarta**, no se migra, y se
reaprende hablando con el clasificador de B1. Incluye lo ya migrado en 7b-A (9 proyectos, familia,
19 entradas de conocimiento): se borra también, con un volcado local de seguridad antes de tocar
nada (fuera del repo, no es una migración reversible desde la app). Pidió además que el CRUD hablado
quede completo — crear, actualizar, **borrar** y consultar — cerrando el cabo suelto que quedó
abierto en B1 (solo `Person`/`KnowledgeEntry` tenían crear/actualizar, no borrar).

Fases, en orden — **todas cerradas el 15/09/2026**:

- [x] **B2.1 — Backup y reset de la BD.** Script `b2_reset.ts` (no commiteado a propósito: llevaba
  el nombre completo, fecha de nacimiento y sexo del señor en literal — mantenerlo en el repo público
  habría reintroducido justo el problema que este bloque resuelve). Volcado a JSON local, fuera del
  repo, de `Person` (20), `Project` (19), `KnowledgeEntry` (33) y `Memory` (1) antes de vaciar las
  cuatro colecciones de verdad contra la base de producción (la misma que usa Render)
- [x] **B2.2 — Identidad mínima sembrada.** `nombre`, `nombre_completo`, `fecha_nacimiento`, `sexo`
  y `ubicacion` añadidos a `PROFILE_FIELDS` (`profileDynamic.ts`, con `immutable:true` en los 4 que
  no van a cambiar, para que `checkStaleFields` no pregunte cada 90 días si un nombre "sigue siendo
  correcto") y sembrados como `ProfileOverride` — mismo mecanismo que ya usaba Gap 5
- [x] **B2.3 — `profile.ts` reducido a lo irreductible.** De 306 líneas a solo
  `instrucciones_para_bako` (trato de "señor", estilo, prioridad de no inventar). Efecto en cadena
  detectado al compilar: el endpoint `POST /api/agent/migrate-memories` (7b-A, ~250 líneas) y el
  script `seedBrain.ts` dependían de los campos personales borrados — ambos eran trabajo de
  migración ya hecho una vez y redundante con el reset, así que se eliminaron enteros (incluido el
  botón "Migrar memoria" del panel, que además ya estaba señalado para quitar en B6). De paso
  apareció un `knowledge/profile.json` **muerto y sin importar en ningún sitio**, con una copia
  vieja de los mismos datos personales — borrado también
- [x] **B2.4 — Modo génesis de verdad.** `buildDynamicProfileContext()` ya no deja líneas vacías y
  devuelve un aviso explícito de "todavía no sabe nada, no invente" cuando no hay nada sembrado.
  Quitada la línea `IDENTIDAD: ...` hardcodeada de `buildSystemPrompt` (redundante e inconsistente
  con `profile.ts` vacío). Generalizado el bloque `situacion`, que daba por hecho una rutina
  concreta (bus Errentería→Donostia, "jornada en Inetum", "Biziki o Shaolin en Arramendi")
  hardcodeada fuera de `profile.ts` — mismo problema del invariante §3.0 aunque estuviera en otro
  fichero. Hallazgo de `/code-review`: quitar esa línea rompía la identidad base en las 3 llamadas a
  `buildSystemPrompt` que no pasaban `dynamicProfileSection` (`/privado`, detección de sensible,
  borrador de email) — corregido pasándosela también ahí
- [x] **B2.5 — Cerrar el CRUD hablado.** `olvidar_persona` y `olvidar_conocimiento`, tools
  explícitas con `destructive:true` en `agent.ts` (heredan el gate de confirmación de B0 gratis, sin
  tocar `runAgentTurn`). Soft-delete (`activo:false`), y una ficha `fuente:'manual'` no se toca por
  voz — mismo criterio que el invariante §7 ya aplica a las memorias manuales
- Hallazgos de dos rondas más de `/code-review` corregidos: el clasificador podía pisar una
  `Person`/`KnowledgeEntry` creada a mano desde el panel (`deduplicateAndSave` ya excluía
  `source:'manual'` para `Memory`, esto no lo hacía para las otras dos cajas); `aplicarConocimiento`
  no normalizaba mayúsculas en `clave` como sí hacía `aplicarPersona` con nombres, así que una
  variación de formato creaba un duplicado; `olvidarPersona` no desambiguaba si dos fichas activas
  compartían nombre (sí lo hacía `olvidarConocimiento`); `isSensitive()` no quitaba acentos del
  texto de entrada, así que "nómina" con tilde (la forma normal de escribirlo) colaba por la
  rendija de una regex pensada solo en ASCII; regex-escape duplicado en tres sitios en vez de
  reutilizar `escapeRegex` de `middleware/security.ts`
- `/security-review` sin hallazgos tras las correcciones
- Riesgo aceptado y no resuelto: `loQueYaSabe` (B1) sigue mandando la lista de nombres de Persona
  entera a Groq en turnos no sensibles, sin el mismo recorte que ya aplica a las claves de
  conocimiento — documentado ahí, no es nuevo de B2
- Tercera ronda de `/code-review` (16/09/2026), 7 hallazgos, todos corregidos salvo dos que pasan
  a pendientes (abajo). El grueso era **el gate de sensibilidad de §3.3, que solo cubría una de
  las tres puertas del Desktop**: `/text` lo evaluaba únicamente sobre el mensaje, así que un turno
  sensible resuelto en local se iba a Groq en el historial del siguiente turno inocuo — ahora el
  gate mira también `conversationHistory`; y `/stream` seguía con `useCloud:true` fijo y sin gate,
  una vía de escape abierta en el mismo router (corregido, aunque hoy no lo use ningún cliente).
  Además: el clasificador del cerebro excluía los campos de perfil sin decir "de Borja", y las
  etiquetas desnudas ("nombre", "ubicación") coincidían con los campos de la caja `persona`, así
  que "Ibon se ha mudado a Bilbao" corría el riesgo de no guardarse en ninguna parte; `edadDesde`
  aceptaba fechas imposibles porque `new Date(1990,1,31)` desborda a marzo en vez de dar NaN, y un
  31/02 mal tecleado salía como una edad creíble (ahora se valida el ida y vuelta, y
  `updateProfileField` rechaza la fecha inválida en origen)
- [x] **Cauce de escritura de `fecha_nacimiento`** (16/09/2026) — B2.4 añadió la línea `Edad: N
  años` derivada de la fecha, pero **ningún camino sabía escribir esa fecha**: el clasificador la
  excluía por ser campo de perfil y `detectProfileUpdate` solo cubría empleador y ubicación, así
  que "nací el 12/03/1990" no se guardaba en ninguna caja y la línea era inalcanzable. Patrón
  añadido (solo formato numérico: "nací el 12 de marzo de 1990" sigue sin recogerse)
- [x] **Los turnos de solo lectura vuelven a enseñar** (16/09/2026) — `learnFromConversation` se
  saltaba con cualquier `toolUsed`, criterio correcto para `crear_tarea` (su texto es un acuse de
  recibo) pero no para `consultar_cerebro`: preguntar "¿qué sabes de Ibon?" es conversación, y el
  señor corrige o amplía en la misma frase. `AgentTurnResult` expone ahora `toolReadOnly` y los
  cuatro llamadores (PWA/Desktop ×2, Telegram ×2) aprenden de esos turnos
- Riesgo aceptado y no resuelto: **en `/voice` el audio crudo sale a la nube siempre**, antes de
  que el gate pueda opinar — para saber si lo dictado es sensible hay que transcribirlo, y
  transcribir es Groq Whisper. El gate protege el turno del LLM y lo que se aprende de él, no la
  transcripción. El mensaje de error decía "no he mandado nada a la nube", que era falso ahí:
  corregido el texto. Cerrarlo de verdad exige Whisper local → pendiente abajo
- [ ] **Whisper local para cerrar el gate de voz** — mientras no exista, dictar "mi nómina de
  Inetum" manda el audio a Groq aunque el turno se resuelva en Ollama. Pendiente a propósito: exige
  decidir infraestructura nueva en la única máquina (motor de Whisper local, contención de VRAM con
  Ollama qwen3:8b que ya deja ~6,2 GB de 8 GB ocupados con `keep_alive`, y una ruta nueva en el
  túnel Cloudflare autenticado) — decisión del señor, no algo para resolver sin consultar
- [x] **Segunda pasada del LLM tras una herramienta de solo lectura** (16/09/2026) — `consultar_cerebro`
  recitaba su volcado de datos tal cual ("PERSONA Ibon: relación: amigo · vive en Bilbao") en vez de
  contestar como mayordomo. Añadida `redactarRespuestaLectura` en `agent.ts`: una segunda llamada,
  con el mismo proveedor y prompt de sistema mínimo (no el de ~16k chars con memorias/personas/
  proyectos — hubiera doblado tokens y latencia sin necesidad), que redacta la respuesta a partir
  del dato crudo sin poder inventar nada que no esté en él. El propio dato manda sobre el gate: si
  `consultarCerebro` devuelve algo sensible aunque la pregunta no lo pareciera ("¿qué sabes de
  Ibon?" no dispara `isSensitive`, pero sus notas guardadas sí pueden hacerlo), la redacción se
  fuerza a local igual — hallazgo de la propia ronda de `/code-review` sobre este cambio
- Encontrado de paso al revisar lo anterior, **una fuga real del invariante §3.3 ya en producción**:
  `getMemories`/`getMemoriesSection` nunca sabían de privacidad, así que las cinco puertas que
  "procesan solo en local" ante contenido sensible seguían embebiendo ese mismo texto por la puerta
  de atrás — `isOllamaAvailable`/`getCachedOllamaStatus` solo comprueban el modelo de chat, nunca el
  de embeddings (`nomic-embed-text`), y si éste fallaba con Ollama arriba, `generateEmbedding` caía
  a Cloudflare igual. Corregido enhebrando `privado` por las tres capas (`generateEmbedding` ya lo
  aceptaba desde antes) y pasándolo en las cinco ramas sensibles (Telegram texto/voz/`/privado`,
  Desktop `/text`/`/voice`/`/stream` vía `getFullSystemPrompt`)
- Dos hallazgos más de la misma ronda, también corregidos: `updateProfileField` devolvía el mismo
  `ok:false` para "campo inexistente" y para "campo válido, fecha imposible", así que `/perfil
  identidad.fecha_nacimiento 31/02/1990` respondía "campo no reconocido" (factualmente falso) y el
  manejador de texto libre de Telegram ni confirmaba ni se quejaba ante la misma fecha imposible, así
  que parecía guardada sin haberlo estado — ahora `reason` distingue los dos casos y ambos avisan; y
  la detección de perfil en lenguaje natural corría DESPUÉS de la corrección genérica de texto libre,
  cuyo disparador "en realidad ..." incluye "nací"/"vivo"/"mi", así que "en realidad nací el
  12/03/1990" o "en realidad vivo en Bilbao" siempre caían como memoria suelta y el patrón estricto
  del perfil nunca llegaba a probarse — reordenado
- `/code-review` y `/security-review` sin hallazgos tras las correcciones anteriores
- `/security-review` (16/09/2026): 3 hallazgos, 1 descartado como falso positivo (el índice del
  cerebro saliendo a la nube, que ya estaba anotado arriba como riesgo aceptado y no lo introduce
  esta rama). Los otros dos, corregidos:
  - [x] **La puerta de atrás del aprendizaje** (Alta) — el gate por historial que se acababa de
    añadir a `/text` se evaporaba en `learnFromConversation`, que recalculaba la sensibilidad solo
    sobre el turno suelto: "¿cuánto te dije que cobraba?" → "2.400 € netos, señor" no dispara
    ninguna palabra de `isSensitive`, así que la cifra que el gate acababa de retener salía a Groq
    por detrás, con embedding incluido. El llamador pasa ahora su decisión (`{ sensible }`) y el
    clasificador la suma con OR — quien sabe más endurece el gate, nunca lo rebaja
  - [x] **XSS almacenado en el panel** (Media) — `ubicacion` y `trabajo` se interpolaban sin
    escapar en el `innerHTML` de la tarjeta de persona (`meta`), justo los dos campos que el
    clasificador de B1 empezó a escribir solo desde texto libre de conversación: "trabaja en
    `<img src=x onerror=...>`" creaba la ficha, y el payload se ejecutaba en la sesión del
    superadmin al abrir Personas, con el JWT de 30 días en `localStorage` a tiro. Escapados en
    origen; `escHtml` cubre ahora también comillas (los `value="..."` de los tres formularios de
    edición eran rompibles) y tolera no-strings; y `brain.ts` recorta y filtra ángulos en los
    campos de texto libre como defensa de repuesto
- [x] **Gate de sensibilidad en la voz de Telegram** (16/09/2026) — encontrado al verificar un
  hallazgo colateral. El manejador de texto tenía el gate desde siempre; el de voz **no tenía
  ninguno**: dictar "mi nómina de Inetum" por Telegram iba a Groq sin más y encima quedaba en la
  sesión, así que volvía a salir en cada turno posterior. Replicado el mismo gate, sin sesión ni
  aprendizaje en la rama sensible. Con esto las cinco puertas (Telegram texto y voz, Desktop
  `/text`, `/voice` y `/stream`) tienen por fin el mismo criterio

### B3 — Curiosidad: las preguntas sólidas

Aquí es donde BAKO deja de ser pasivo. El riesgo a evitar es el interrogatorio: una pregunta buena y
oportuna vale más que diez seguidas.

**Decisión del señor (17/09/2026) que sustituye el planteamiento original de este bloque** (escaneo
periódico + presupuesto de una pregunta): el disparador no es un cron ni un cierre de conversación,
es **reactivo** — justo cuando el clasificador de B1 crea o completa de verdad una Persona o un
Conocimiento, aprovechando que el tema ya está sobre la mesa ("cuando se le corrija o se le dé
información sobre alguien o algo"). Y no es una pregunta, son **2-3, estilo niño aprendiendo**: BAKO
se interesa por los huecos de esa ficha concreta, en un único mensaje cálido, no un formulario.

- [x] **B3.1 — Huecos de Persona** (17/09/2026) — `huecosDePersona()` en `brain.ts`: relación aún en
  "conocido" (el cajón por defecto), o descripción/ubicación/trabajo/cumpleaños vacíos. Un campo
  preguntado una vez no se vuelve a preguntar nunca (`preguntasHechas` en el propio documento
  `Person`) — así se cumple "no insistir" sin necesitar un registro de rechazos aparte: si el señor
  no contesta, el hueco sigue vacío pero BAKO no vuelve a tocarlo
- [x] **B3.2 — Disparo y prioridad** (17/09/2026) — enganchado al final de `learnFromConversation`,
  sobre la operación de `persona` más relevante del turno (creada > actualizada con cambio real),
  nunca más de una ficha por turno — cubre "preguntas encadenadas: nombre nuevo antes que algo
  aleatorio" sin necesitar cola ni prioridad explícita, porque solo hay un candidato por turno
- [x] **B3.3 — Redacción y entrega** (17/09/2026) — un LLM redacta 2-3 preguntas naturales sobre los
  huecos (máx. 3, elegidos por `huecosDePersona`), en el mismo proveedor que decidió el turno
  (nube/local, invariante §3.3 — se salta entero si el turno fue sensible). Sale por
  `sendSystemMessage()`, el mismo canal que ya usan los crons: llega a Telegram y a la cola de
  `Notification` que consultan PWA/Desktop. Es un mensaje aparte, segundos después de la respuesta
  normal — no se mete en el turno en curso para no añadirle latencia a cada mensaje
- [ ] **Pendiente, alcance recortado a propósito**: huecos de `KnowledgeEntry` (solo tiene un hueco
  genérico razonable — `detalles` vacío — demasiado pobre para 2-3 preguntas con sentido; se deja
  para cuando haga falta de verdad) y el "dato caducado" del planteamiento original (nada estructural
  que lo señale sin heurísticas frágiles). `Project` queda fuera: desde B2 es un espejo puro de
  Notion (`projectSync.ts`), Notion ya obliga a tener estado
- **Verificación en vivo (18/09/2026) — el señor no vio ninguna pregunta de curiosidad sobre Yaimy.**
  Sin acceso a los logs de Render ni a la BD de producción desde este entorno (el `mongodb+srv://`
  de Atlas no resuelve aquí — DNS de tipo SRV bloqueado en la sandbox, confirmado con y sin red
  restringida), no se pudo confirmar la causa exacta. Repasado el código de arriba a abajo sin
  encontrar un bug de lógica; la hipótesis más plausible es una interacción con el invariante §3.3:
  si algún campo ya guardado de Yaimy contiene una palabra de `SENSITIVE_PATTERN` (p. ej. "banco"
  como empleador), CUALQUIER pregunta de curiosidad posterior sobre ella —aunque sea de un hueco
  no sensible, como el cumpleaños— hereda `local:true` porque `conocido` (el resumen que se le pasa
  al LLM) incluye ese campo entero; si Ollama no estaba arriba en ese momento, `askClaude` lanza
  `PrivacyError`, el `catch` de `preguntarPorHuecos` lo traga en silencio y no queda rastro visible
  para el señor. Es el comportamiento correcto de cara a la privacidad (nunca se manda a la nube),
  pero deja la función muda sin avisar. Pendiente confirmar con el señor y, si se confirma, decidir
  si conviene alguna señal (aunque sea solo en logs) quando la curiosidad se descarta por esto

### Correcciones sueltas (18/09/2026)

Encontradas al verificar en vivo lo entregado hasta ahora — no forman parte de ningún bloque del
cerebro, van aquí por no abrir una sección nueva para dos líneas.

- [x] **"Hola Bako" salía como "¿Qué ha querido decir, señor?"** — dos causas, corregidas las dos.
  `classifyQueryComplexity()` (`llm/claude.ts`) anclaba el saludo con `$` justo después de la palabra
  ("hola", "buenas"...), así que cualquier vocativo detrás ("Bako") lo dejaba fuera de "simple" y
  usaba el prompt completo para un saludo — regex sacadas de la función a constantes de módulo de
  paso, para no reconstruirlas en cada mensaje. Pero el problema de fondo estaba en el prompt de
  sistema (`telegram.ts`): la regla de "mensajes ininteligibles" no distinguía un saludo claro de
  texto incoherente, y el modelo (sobre todo el local) lo metía en ese cajón. Añadida una regla
  explícita de saludo, antes de la de ininteligibles
- [x] **18/09/2026 — Pausados los 7 avisos automáticos, salvo la sincronización en sí de
  `notion_sync`.** El señor confirmó que quiere los 7 en pausa (no solo briefing y resumen semanal
  como se había anotado el mismo día), pero que `notion_sync` debe seguir sincronizando plan.md →
  Notion cuando se avanza en el plan o se sube algo a git — solo su aviso de Telegram debía callarse.
  Añadida una `JOB_DEF` nueva y independiente `notion_sync_aviso` (`memory/AutoConfig.ts`) que
  envuelve el `sendSystemMessage` de `runNotionSyncJob` (`services/ProactivityService.ts`) sin tocar
  el propio `syncPlanWithNotion()`. Aplicado en Mongo de producción: `briefing`, `alertas`,
  `pr_review`, `perfil`, `techradar`, `resumen_semanal` y `notion_sync_aviso` → `enabled: false`;
  `notion_sync` sin tocar (sigue activo). Reversible con `/automaticos` en Telegram (los 7 aparecen
  ahí, incluido el nuevo) o con el panel `/api/autoconfig/jobs`. `/code-review` sobre el diff
  encontró dos fallos reales, corregidos antes de cerrar: la descripción de `notion_sync_aviso`
  decía "mensaje de Telegram" pero `sendSystemMessage` también dispara Web Push y la `Notification`
  del panel — corregida para reflejar que silencia el aviso completo; y el panel admin dejaba editar
  un horario para `notion_sync_aviso` que no tiene cron propio (vive dentro de `runNotionSyncJob`) sin
  que hiciera nada — añadido `ownSchedule: boolean` a `JobDef`, la ruta `PATCH .../schedule` rechaza
  con 400 si el job no lo tiene, y el panel oculta el botón de editar horario en ese caso. Segunda
  pasada de `/code-review` limpia, `npm run build` sin errores
- **Límite de la sandbox anterior, no de esta máquina**: la nota de esta mañana decía que no había
  red hacia el `mongodb+srv://` de Atlas. Confirmado hoy que sí la hay (`nslookup` resuelve el SRV
  sin problema), pero el resolver DNS de Node (`dns.resolveSrv`, usado internamente por el driver de
  Mongo para expandir `mongodb+srv://`) da `ECONNREFUSED` igualmente, con o sin sandbox de Bash —
  parece un bloqueo específico a consultas SRV salientes de Node, no del sistema. Workaround aplicado
  hoy: resolver los 3 hosts del shard y el `replicaSet` a mano con `nslookup -type=SRV` / `-type=TXT`
  y construir una URI `mongodb://` directa (sin SRV) con los mismos hosts, en vez de
  `mongodb+srv://` — funciona igual, mismo cluster, misma auth. Útil para cualquier próximo script
  que necesite tocar Mongo de producción desde aquí

### B4 — Conexiones y deducción ✅ 28/09/2026

Las cinco fases del bloque, todas cerradas el 28/09/2026:

- [x] **B4.1 — Relaciones tipadas.** Nuevo modelo `Relation` (`memory/Relation.ts`): aristas tipadas
  entre Persona↔Proyecto↔Conocimiento (`origenTipo/origenId`, `destinoTipo/destinoId`, `relacion` en
  texto libre breve), con `dicha`/`confianza`/`explicacion` para distinguir un hecho de una deducción
  desde el propio esquema (B4.3). `Person.conexiones` no se toca — sigue sirviendo para la prosa
  simple del prompt —, esto es el grafo real que permite consultar y deducir. El clasificador de
  `brain.ts` (B1) gana una cuarta caja, "relacion", solo para conexiones que el señor dijo de verdad:
  `resolverEntidad()` resuelve el nombre propuesto contra lo que YA EXISTE (nunca crea una entidad
  nueva por esta vía) y exige que el nombre aparezca en lo dicho — mismo guardarraíl que ya usaba
  `aplicarPersona` contra nombres inventados —, salvo para "conocimiento" (se identifica como
  "categoria/clave", un formato que no se dice así en una frase hablada; se exige en su lugar que una
  palabra real de la clave aparezca en el texto)
- [x] **B4.2 — Deducción.** `deducirConexiones()`: tras aplicar lo DICHO del turno, mira el vecindario
  de 1 salto de la persona tocada (mismo alcance acotado que la curiosidad de B3, a propósito) y le
  pregunta al LLM si hay algo razonable que deducir que no conste ya. Guardarraíles: nunca inventa una
  entidad nueva (mismo `resolverEntidad`, sin exigir mención literal — una deducción por definición
  conecta cosas no dichas juntas, pero deben existir ya) y cualquier propuesta por debajo de confianza
  0,5 se descarta como ruido
- [x] **B4.3 — Distinguir lo dicho de lo deducido.** `consultarCerebro()` presenta las relaciones
  DICHAS como hecho ("RELACIÓN: X — trabaja en — Y") y las DEDUCIDAS con etiqueta de confianza
  (alta/media/baja) y la explicación de por qué se dedujo, nunca igualadas. `redactarRespuestaLectura`
  (agent.ts) recibe la instrucción explícita de transmitir una "POSIBLE CONEXIÓN" como deducción propia
  ("podría ser que...") y no como hecho comprobado, para que la redacción final no borre la distinción
  que ya trae el dato crudo. Invariante nuevo en `spec.md` §3.16
- [x] **B4.4 — Contradicciones.** `aplicarPersona`/`aplicarConocimiento` detectan cuándo un campo
  factual (relación, ubicación, trabajo, cumpleaños; o el valor de un Conocimiento) cambia de un valor
  real a otro distinto — no de vacío a lleno, eso sigue siendo un hueco de B3. El valor nuevo se sigue
  aplicando (no se bloquea nada), pero ahora se pregunta en vez de callarlo: un único mensaje por turno
  (`preguntarPorContradiccion`), con prioridad sobre la curiosidad de B3 si las dos aplican a la vez —
  nunca las dos preguntas en el mismo turno
- [x] **B4.5 — Caducidad.** `antiguedadAviso()`: cualquier dato con más de un año o más de dos años sin
  confirmarse (por `updatedAt`) lleva un aviso al presentarse desde `consultarCerebro`. Reconfirmar una
  relación ya dicha en una conversación posterior refresca `updatedAt` sin generar ruido en el log —
  mencionar algo de nuevo "limpia" el aviso de caducidad de forma natural
- **Cascada de olvido**: `olvidarPersona`/`olvidarConocimiento` (B2.5) ahora desactivan también las
  relaciones que mencionan a la entidad olvidada (`apagarRelacionesDe`) — hallazgo de `/code-review`:
  sin esto, una persona "olvidada" seguía resurgiendo por la puerta de atrás del grafo de relaciones
- Alcance recortado a propósito, igual que B3: la deducción solo corre sobre la persona candidata del
  turno (mismo criterio de "una ficha por turno" que ya usa la curiosidad), no sobre cada entidad
  tocada — se amplía si hace falta de verdad
- Riesgo aceptado y no resuelto: sin índice único en `Relation`, dos turnos casi simultáneos sobre la
  misma conexión podrían crear una fila duplicada antes de que termine el primer guardado — condición
  de carrera de baja probabilidad en un asistente de un único usuario, documentada aquí en vez de
  añadir upsert atómico por ahora
- Cuatro rondas de `/code-review` corrigieron: el paso de deducción no comprobaba la sensibilidad del
  propio vecindario de relaciones recuperado (solo la del turno, invariante §3.3); el valor por
  defecto "conocido" de `Person.relacion` se marcaba como contradicción al completarse (debía tratarse
  como hueco de B3, no como hecho previo); el guardarraíl de mención se saltaba del todo para
  relaciones DICHAS hacia "conocimiento" (podían fijarse como hecho con confianza 1 sin que el señor
  las mencionara); el filtro "ya es un hecho dicho" de la deducción no comprobaba la etiqueta de
  relación, así que una relación dicha entre dos entidades bloqueaba TODAS las deducciones futuras
  sobre ese mismo par; las operaciones "relacion" podían procesarse antes que la persona que crean en
  el mismo turno (resuelto con dos pasadas: primero persona/conocimiento/recuerdo, luego relacion);
  una deducción podía pisar en silencio una Relation curada a mano (`fuente:'manual'`) si el panel
  llega a permitirlo en el futuro; y tres copias sueltas de la misma búsqueda de Persona por
  nombre/alias se unificaron en `personasPorNombre()`. `/security-review` sin hallazgos, `npm run
  build` limpio

### B5 — Recuperación a escala ✅ 28/09/2026

Hasta ahora la búsqueda semántica cargaba todas las memorias de Mongo y calculaba el coseno en Node
en cada consulta. Correcto con 100 registros, insostenible con 10.000.

- [x] **MongoDB Atlas Vector Search** en vez del coseno en memoria. Nuevo módulo
  `tools/vectorSearch.ts`: dos índices (`memory_vector_768`/`384`, uno por modelo de embedding —
  `nomic-embed-text` de Ollama y `bge-small-en-v1.5` de Cloudflare) creados de forma idempotente al
  arrancar (`ensureVectorSearchIndexes`, sin bloquear ni romper el arranque si el cluster no es
  Atlas). `buscarMemoriasSimilares()` intenta `$vectorSearch` primero y cae al coseno en memoria sin
  que el llamador lo note — mismo contrato `{m, score}[]` de antes. Disponible en el plan free M0
  desde 2023, así que no choca con el invariante de coste $0
- [x] **Recuperación híbrida** (B5.2): `consultarCerebro` usa los vecinos del grafo de B4 para ampliar
  la búsqueda de memorias más allá de la similitud pura — si "Ibon" tiene una relación con "BAKO", una
  pregunta sobre Ibon también rastrea memorias sobre "BAKO", no solo las que lo mencionan
  literalmente. Acotado a 3 vecinos más recientes (por `updatedAt`) y 2 memorias por vecino
- [x] **Retiradas las listas de tags hardcodeadas** de `tools/memory.ts` (`SOCIAL_TAGS`,
  `PROJECT_TAGS`, `PERSONAL_TAGS`) — tenían nombres reales de familia y amigos escritos a mano en un
  repo público, exactamente el invariante §0 que B2 ya había corregido en `profile.ts`, sobrevivía
  aquí sin que nadie lo hubiera notado. Encontrada y corregida también su copia gemela en el propio
  panel (`index.html`, usada solo para un badge visual de "tier") — sustituida por clasificación
  según `Memory.type` (fact/preference/…), un campo propio de cada memoria, sin nombres
- [x] **Medir contexto** (B5.4): `medirContexto()` deja constancia en el log de cuántos ítems y
  caracteres se sirven en cada llamada a `getMemories`/`searchMemories`, y por qué vía (semántica,
  búsqueda o el fallback genérico)
- Fallback genérico sin tags: cuando la semántica no tiene suficientes candidatas, se sirve lo más
  importante y reciente sin favoritismos de nombre — riesgo aceptado y documentado: ya no garantiza
  que algo sobre familia/amigos sobreviva siempre al recorte si su `importance` es `medium` (el
  defecto) y hay memorias técnicas más recientes; la continuidad de esos datos vive ahora en `Person`
  (B1), no en `Memory` suelta
- Cinco rondas de `/code-review` corrigieron: `getMemories` ordenaba `importance` como texto
  (alfabético: "medium" > "low" > "high", justo al revés de lo que pedía el comentario) — se traduce a
  rango numérico en la propia agregación; 0 resultados de Atlas se trataban como "índice sin
  poblar" y caían al escaneo completo cada vez incluso a escala, derrotando el propósito de la
  migración — ahora se cachea `queryable` una vez confirmado; `deduplicateAndSave` pedía de más y
  filtraba `source:'manual'` después en vez de con el filtro nativo de Atlas (arriesgando perder el
  mejor duplicado no-manual); el operador `$ne` en el prefiltro de `$vectorSearch` se cambió a `$eq`
  por seguridad de compatibilidad; la consulta de relaciones para vecinos no tenía `sort`, así que
  "los 3 vecinos más recientes" no lo eran; y el score normalizado de Atlas ((1+coseno)/2, rango
  [0,1]) se comparaba directamente contra umbrales pensados en coseno crudo ([-1,1]) — el criterio de
  "es un duplicado" cambiaba según si Atlas estaba listo o no. `/security-review` sin hallazgos

### B6 — El panel como ventana al cerebro ✅ 28/09/2026

- [x] **Limpieza inmediata**: quitado el botón "Limpiar memorias importadas" y su endpoint
  (`clean-manual-memories`, ya sin ningún llamador — su trabajo puntual ya se hizo en 7b-A);
  "Previsualizar deduplicación" y "Deduplicar memoria" se fusionaron en un solo botón que analiza
  primero y solo pide confirmar si de verdad hay algo que borrar ("Migrar memoria" ya se había
  quitado en B2.3)
- [x] **Pestañas reorganizadas** siguiendo el cerebro: `Perfil` · `Personas` · `Proyectos` ·
  `Conocimiento` · `Recuerdos` (antes "Memorias") · `Sistema` · `Usuarios`. `Sistema` agrupa lo que
  antes eran botones sueltos en Usuarios (avisos automáticos, estado Web Push, mantenimiento —
  deduplicar, generar embeddings); `Usuarios` queda solo con gestión de usuarios y cerrar sesión
- [x] **Pestaña Perfil nueva**: dos endpoints (`routes/profile.ts`, `routes/relations.ts`) para que el
  panel pueda leer y editar los campos de identidad mínima de B2.2 (antes solo accesibles por
  `/perfil` en Telegram) y consultar el grafo de B4. Hallazgo de `/code-review`: nada impedía
  reescribir un campo `immutable` (nombre, fecha de nacimiento, sexo) una vez sembrado — ni por aquí,
  ni por el `/perfil` de Telegram, ni por la detección en conversación — corregido en el propio
  `updateProfileField` (protege los tres cauces a la vez) con un motivo `immutable_field` nuevo y
  mensajes propios en cada uno. Segundo hallazgo: `PROFILE_FIELDS[key]` sin `hasOwnProperty` dejaba
  que una clave `__proto__` resolviera a `Object.prototype` y reventara con un 500 en vez del 400
  limpio de cualquier otra clave inválida — corregido
- [x] **Conexiones y procedencia visibles**: las tarjetas de Personas/Proyectos/Conocimiento muestran
  ahora sus relaciones del grafo de B4 (verde y sólido si están dichas, violeta y discontinuo con
  porcentaje de confianza si son deducidas de BAKO) y, cuando la ficha se aprendió hablando, la frase
  de origen (B1) — antes esa trazabilidad solo existía en la base de datos, invisible desde el panel
- Riesgo aceptado y documentado: sin índice único en `Relation` (ya anotado en B4), y el grafo de
  relaciones se cachea una vez por apertura del panel en vez de por cada cambio de pestaña — aceptable
  a la escala de un único usuario
- Cuatro rondas de `/code-review` sin hallazgos pendientes tras corregir lo de arriba. `npm run build`
  limpio, JS del panel verificado sin errores de sintaxis. `/security-review` sin hallazgos

---

### ✅ Routing LLM local/nube — cerrado con la GPU nueva (05/09/2026)

- [x] **Infraestructura de routing Ollama/Groq**, con el defecto en Groq hasta tener GPU suficiente
  - [x] Badge de la PWA: solo se puede elegir con el túnel vivo; **deshabilitado y fijo en Groq**
    cuando el PC o el túnel están apagados (era lo que fallaba: el badge dejaba forzar Ollama caído)
  - [x] `/llm-status` publica el defecto real del servidor y la PWA lo obedece, así que activar la
    variable en Render cambia el comportamiento sin tocar el cliente
  - [x] `/text` y `/voice`: el sondeo de Ollama va en paralelo con la construcción del prompt, no en
    serie (ahorra hasta 6 s cuando el túnel está caído)
  - [x] `think:false` + `stripThinking()` (qwen3 devuelve `<think>`, y truncado se colaba en el TTS)
  - [x] `OLLAMA_MODEL` / `OLLAMA_NUM_CTX` / `OLLAMA_TIMEOUT_MS` / `LLM_PREFER_LOCAL` por entorno,
    validando que los numéricos sean > 0 (una variable vacía dejaba axios sin timeout)
- [x] **GPU de 8 GB montada y medida** (05/09/2026) — la GPU nueva **no es NVIDIA**: es una **AMD
  Radeon RX 7600 de 8 GB**, que funciona con Ollama vía **ROCm, no CUDA** (dato a tener en cuenta en
  todo lo de visión/IA de `bako-lab`, cuyo `spec.md` aún da por hecha una GTX 1650 con CUDA).
  Medido con un prompt real de 7.695 tokens, contra los 85 s de `qwen3:8b` en la GTX 1650:

  | `num_ctx` | En frío | Caliente | Generación | Reparto |
  |---|---|---|---|---|
  | 4096 | 11,1 s | 0,5 s | 43,2 tok/s | 100 % GPU |
  | **8192** | **14,8 s** | **0,6 s** | **37,5 tok/s** | **100 % GPU** |
  | 12288 | 48,5 s | 3,6 s | 5,4 tok/s | 100 % GPU |
  | 16384 | 49,7 s | 3,7 s | 5,2 tok/s | 93 % GPU |

  - [x] **`OLLAMA_NUM_CTX` se queda en 8192, no 16384** como decía este plan: de 8192 a 12288 la
    generación se desploma de 37,5 a 5,4 tok/s aunque `ollama ps` siga diciendo 100 % GPU. Subirlo
    habría hecho a BAKO 6 veces más lento creyendo que se le mejoraba
  - [x] **`OLLAMA_TIMEOUT_MS` subido de 12 s a 18 s** — bug que el cambio de GPU destapa: cargar el
    modelo en frío cuesta 14,8 s, así que con 12 s la primera pregunta tras un rato de inactividad
    se iba **siempre** a Groq aunque el PC estuviese encendido. 18 s deja margen bajo el safety de
    25 s de los endpoints desktop
  - [x] **`keep_alive` añadido a las llamadas a Ollama** (`OLLAMA_KEEP_ALIVE`, por defecto 30m) — con
    el modelo residente se responde en 0,6 s en vez de 14,8 s. Cuesta ~6,2 GB de VRAM ocupados
    mientras dura
  - [x] `LLM_PREFER_LOCAL=true` y `OLLAMA_MODEL=qwen3:8b` en `render.yaml` y en los defectos del
    código — **falta aplicarlos en el dashboard de Render**, que es donde manda de verdad
  - ⚠️ Se creó una tarea `BAKO-Ollama-Serve` al ver que Ollama no estaba corriendo, **y sobraba**:
    Ollama ya arranca solo con su app de bandeja (acceso directo en la carpeta de Inicio de Windows),
    que además levanta el servidor sin ventana. El fallo fue comprobar solo la clave `Run` del
    registro y no la carpeta de Inicio; el resultado era un arranque duplicado y un CMD de más en
    pantalla. Tarea eliminada el 05/09/2026
  - [x] **El túnel pasa a servicio de Windows** (`Cloudflared`, LocalSystem, automático) el
    05/09/2026: sin ventana de consola y **arranca antes de iniciar sesión**, así que el túnel está
    vivo aunque nadie se loguee. `BAKO-Ollama-Tunnel` queda desactivada como respaldo. Trampa que
    costó dos pasadas: `cloudflared service install` registró el servicio **sin argumentos** (solo el
    exe, sin `--config` ni `tunnel run`), figurando como "Running" sin servir nada — se detectó
    mirando el `binPath` y se corrigió con `sc config`. **Verificado**: con el `cloudflared` de la
    tarea ya matado, el badge de la PWA sigue en "Ollama ✦", así que el túnel lo sirve el servicio
  - [x] Verificado extremo a extremo: `qwen3:8b` respondiendo por `ollama.bohdeveloper.com`, 6,2 GB,
    100 % GPU, contexto 8192
  - [x] **`OLLAMA_URL` faltaba en `render.yaml`** (05/09/2026) — era la causa de que el botón
    Groq/Ollama de la PWA saliera siempre gris: sin esa variable el backend en Render buscaba Ollama
    en **su propio contenedor** (`localhost:11434`, donde no hay nada), así que `isOllamaAvailable()`
    devolvía `false` siempre, el badge se bloqueaba fijo en Groq y `LLM_PREFER_LOCAL` no llegaba a
    aplicarse nunca por muy encendido que estuviera el PC. Añadida apuntando al túnel
  - [x] El endpoint `/voice` ignoraba la elección del badge (solo miraba `LLM_PREFER_LOCAL`), y al
    corregirlo salió un segundo fallo: `/voice` va por `multipart/form-data` (multer), así que
    `useCloud` llega como **string**, no como booleano — la comprobación `typeof === 'boolean'` no
    casaba nunca y el arreglo era un no-op. Resuelto con `parseBoolField()`, usado en los dos
    endpoints. Hallazgo de `/code-review`
  - La lógica del cliente ya era correcta: con túnel vivo manda la preferencia guardada del señor y,
    si no la hay, `LLM_PREFER_LOCAL`; sin túnel el badge se deshabilita y queda fijo en Groq
  - [x] **La causa de fondo era el filtro de bots de Cloudflare**, no `OLLAMA_URL` (que también
    faltaba): `ollama.bohdeveloper.com` devolvía **200 desde la red de casa y 403 desde cualquier
    datacenter** — y Render es un datacenter. Como Ollama no tiene autenticación propia y el hostname
    está en un repo público, no se arregló abriendo el hostname sino **autenticándolo**:
    `OLLAMA_AUTH_KEY` → cabecera `x-bako-key` en las seis llamadas a Ollama (chat, stream, tools,
    sondeo y los dos endpoints de embeddings) + regla WAF que bloquea lo que no la lleve, y Bot Fight
    Mode apagado (en el plan gratuito no se puede saltar con reglas WAF). **Badge en verde
    verificado el 05/09/2026**
  - [x] `isOllamaAvailable()` dejaba de tragarse el error: que fuera mudo es la razón de que esto
    costara una sesión entera — "no disponible" tapaba por igual el túnel caído, un 403, un timeout y
    un DNS roto. Ahora registra el motivo
  - Trampa a recordar, documentada en `spec.md` §5: **el ISP de casa bloquea a ratos los rangos de IP
    de Cloudflare**, y mientras dura no se puede diagnosticar el túnel desde el PC (el dominio parece
    caído desde casa y está perfectamente en pie para Render). La prueba buena es el badge o los logs

### 🟠 P2 · Importante — cerrar Horizonte 1 (mayordomo funcional completo)

- [ ] Verificar en producción la capa de Notion adaptada a "Centro de Mando" (commit `fa05fb4`):
  crear y cerrar una tarea de prueba desde Telegram y comprobar prioridad P1..P4 y "Fecha objetivo"
- ➡️ ~~Confirmación explícita antes de acciones irreversibles (Gap 2)~~ — **movido a B0**: con
  tool-calling deja de ser un parche, la propia herramienta declara si es destructiva
- [x] **Voz TTS persistida y elegible desde PWA/Desktop** (30/08/2026) — antes solo se cambiaba con
  `/voz` en Telegram y se guardaba en una variable en memoria del proceso, así que se reseteaba a
  Álvaro en cada reinicio de Render. Ahora persiste en Mongo (`AutoConfig`, key `tts_voice`).
  - [x] `tools/tts.ts`: `getCurrentVoiceKey`/`setVoice` async contra Mongo, con caché de 30s
  - [x] `GET`/`POST /api/desktop/voice-config` (con try/catch — hallazgo de `/code-review`)
  - [x] PWA: selector `<select>` nativo estilizado como pill junto al badge de LLM (ux-ui-designer)
  - [x] Desktop Python: `OptionMenu` en el header, junto al toggle de tema
  - [x] Saludo inicial ahora se dice en voz alta en los dos clientes (no solo texto) — PWA vía
    `playTTS()` en `initAuth`, Desktop vía `_speak_text()` nuevo en los tres flujos de arranque
  - Hallazgo crítico corregido en la propia sesión: el endpoint nuevo pisaba silenciosamente
    `POST /api/desktop/voice` (audio→LLM→audio) porque compartía la misma ruta — renombrado a
    `/voice-config` antes de desplegar
- [x] **Botón silenciar por mensaje + control de volumen + catálogo solo España** (31/08/2026)
  - [x] El botón 🔊 de cada mensaje alterna a 🔇 mientras suena; un segundo clic lo para. Antes no
    había forma de detenerlo, y el estado "sonando" se quitaba solo al *empezar* a reproducir (bug de
    promesas: `el.play()` resuelve al arrancar, no al terminar)
  - [x] Control de volumen: popover anclado a un icono de altavoz junto al selector de voz
    (ux-ui-designer), persistido en `localStorage` (por dispositivo, no en Mongo)
  - [x] Catálogo de voces reducido a las 3 únicas reales de España — verificado con
    `MsEdgeTTS.getVoices()` (45 voces es-*, solo 3 son es-ES): `alvaro`, `elvira`, `ximena` (nueva).
    Se quitaron `jorge`/`dalia` (México) y `tomas`/`elena` (Argentina) a petición expresa
  - [x] De paso corregida `TTS_VOICE` → `TTS_VOICE_KEY` (env var muerta desde antes, el código nunca
    leyó `TTS_VOICE`) en `.env.example` y `render.yaml`
  - Hallazgos de `/code-review` (varios pases) corregidos antes de desplegar: condición de carrera si
    se pulsaba "escuchar" en dos mensajes seguidos sin esperar respuesta (la segunda petición podía
    pisar el estado de la primera y dejarlas sonando ambas) — resuelto con contador de secuencia y
    `pendingTtsBtn` distinto de `activeTtsBtn`; fuga del blob URL al interrumpir a mitad; borrar un
    mensaje mientras suena o mientras su petición sigue en vuelo no paraba el audio; el volumen no
    afectaba al saludo inicial en vivo; aviso en log si una voz persistida ya no existe en el catálogo
    (jorge/dalia/tomas/elena)
  - [x] **Unificado con la reproducción automática** (31/08/2026): al responder, BAKO habla solo sin
    que se pulse "escuchar" — antes solo se podía parar tocando el botón del micro (que ya cambiaba a
    icono de stop, pero era poco descubrible). Ahora el propio 🔊 del mensaje que se reproduce solo se
    marca como `autoPlayBtn` y muestra 🔇, así que se para con el mismo gesto que el resto. Solo suena
    un audio de BAKO a la vez en cualquier combinación (manual/automático). El botón de borrar también
    para el audio si el mensaje que se borra es el que suena en automático — antes solo cubría el caso
    manual. Toggle de icono consolidado en un único `setTtsBtnState()` (hallazgo de `/code-review`,
    evita que las tres rutas de reproducción diverjan entre sí)
- [x] **PWA móvil — cabecera apretada y salto de altura inicial** (01/09/2026, reportado por el
  usuario; resuelto 01/09/2026 por ux-ui-designer)
  - [x] Header rehecho como 3 zonas flex (`.header-left` / `.header-title` / `.header-right`) en vez
    de overlays con `position:absolute` sobre un `justify-content:center` — el título ya no puede
    quedar debajo de nada, sea cual sea el ancho real de cada lado. Selector de voz y volumen salen
    del header y se agrupan en un nuevo botón "Ajustes" (icono de sliders, `#btnSettings`) a la
    izquierda junto al de administración; abre `#settingsPopover`, un popover accesible para
    cualquier usuario logueado (a diferencia de `#adminPanel`, solo `superadmin`). Dentro, cada
    control (`#voiceSelectWrap`, `#volumeControl`) se movió tal cual, sin tocar su lógica interna —
    solo `#btnSettings`/`#settingsPopover` son código nuevo. El header queda con lo esencial: admin
    (si aplica) + ajustes a la izquierda, badge LLM + wake word + tema a la derecha
  - [x] Altura real de viewport fijada por JS: `setAppHeight()` guarda
    `window.visualViewport?.height ?? window.innerHeight` en `--app-height` sobre `<html>`, y `body`
    usa `height: var(--app-height, 100dvh)`. Se recalcula en `load`/`resize`/`orientationchange`/
    `visualViewport.resize` más 3 reintentos cortos (50/300/600ms) al arrancar, por si la barra de
    direcciones del navegador aún está animando cuando el script corre por primera vez
  - Verificado con Playwright headless a 360×740 y 320×650 (con y sin rol superadmin): sin overlaps
    del título con ningún control, popover de ajustes dentro del viewport, slider de volumen sigue
    guardando en `localStorage`, `--app-height` se recalcula tras resize, sin errores de JS en
    consola. Archivo tocado:
    `backend/public/bako-client/index.html`
  - Hallazgo de `/code-review` corregido antes de desplegar: el volumen quedó como un popover propio
    (`.volume-btn` + `.volume-popover`) anidado dentro del popover de ajustes — un flotante
    `position:absolute` dentro de otro rompía el recorte visual del padre en móvil (el volumen se
    salía por debajo del popover de ajustes). Aplanado a una fila inline (icono indicador + slider +
    %) dentro de `.settings-row`, sin popover propio; se eliminó el toggle/open/close/outside-click
    de `#volumePopover` que ya no aplicaba
- ➡️ ~~Perfil dinámico v2 (proyectos y rutina fuera de `profile.ts`, Gap 5)~~ — **movido a B2**, que
  vacía el fichero entero a la BD en vez de campo a campo
- [ ] **Fase 9 — Desktop, VAD por amplitud** en `_record_loop` (Python) para auto-stop tras silencio;
  hoy sigue en push-to-talk después de la palabra de activación
- [ ] **Fase 9 — Móvil, wake word sin clics (WebAudio VAD).** `SpeechRecognition(continuous:true)`
  provoca un clic del sistema en cada reinicio (~5 s), así que está desactivado por detección de UA
  1. `getUserMedia` abre el micro una sola vez (un único clic de activación)
  2. `AudioContext` + `AnalyserNode` monitorizan el volumen sin `SpeechRecognition`
  3. Al superar el umbral de amplitud, lanzar `SpeechRecognition` una vez para capturar la frase
  4. Si aparece "bako" → modo conversación; si no → volver a escuchar volumen
  - Trade-off: falsos positivos en entornos ruidosos. La detección exacta exigiría un modelo ONNX en
    JS (TensorFlow.js + openwakeword), alta complejidad
  - Con la pantalla bloqueada es imposible en una PWA (el SO congela el JS): requeriría app nativa

### 🟡 P3 · Deseable — pulido opcional

- [ ] Fase 7c, paso 4 — **cache de respuestas frecuentes** (opcional): briefing y agenda cacheados
  5 min en MongoDB, ~20 % menos tokens. Implementar solo si vuelven a aparecer 429 en uso normal
- [x] **Incidente (30/08/2026): Groq retiró `llama-3.3-70b-versatile`** — descubierto al verificar la
  rotación de credenciales (BAKO respondía 404 `model_not_found` en todo, sin relación con Google/Mongo).
  Groq ya no ofrece ningún modelo Llama; el catálogo actual es `openai/gpt-oss-120b` (elegido, 131k
  contexto), `gpt-oss-20b`, `qwen/qwen3.6-27b`/`qwen3.8-27b` y `groq/compound`(-mini). Corregido en
  `render.yaml`, `llm/claude.ts` (default) y `.env.example`.
- [ ] Revisar periódicamente el catálogo de Groq **y** la cadena de OpenRouter: los modelos gratuitos
  cambian sin aviso y devuelven 404; consultar `GET /openai/v1/models` de Groq y
  `/api/v1/models` de OpenRouter cuando ocurra
- [ ] Fase 9 — modelo de wake word propio: ~30 grabaciones de "Bako" → ONNX, sustituye a `hey_jarvis`
- [ ] Widget de chat público en bohdeveloper.com (diferido desde la Fase 7)
- ➡️ ~~Edición de perfil ampliada en el panel admin~~ — **movido a B2/B6**: con el perfil en la BD,
  editarlo deja de ser una tarea aparte

### ⚪ P4 · Diferido / bloqueado

- [ ] Fase 6 — Twitter/X + LinkedIn: **bloqueada**, ambas APIs requieren plan de pago y el invariante
  es $0/mes. Reevaluar solo si aparece una vía gratuita
  - [ ] Cola de posts en MongoDB, BAKO genera y publica con confirmación
  - [ ] Modo automático con calendario editorial

---

## Fase 7c — Rate limits de Groq ⏳ (pasos ya cerrados, pendiente en P3 arriba)

- [x] Paso 1 — routing por complejidad con regex determinista (07/06/2026)
- [x] Paso 2 — fallback multi-proveedor Groq → OpenRouter → re-throw del 429 (07/06/2026)
- [x] Paso 3 — prompt siempre compact en los endpoints desktop + captura del 413 (08/06/2026)

## Fase 9 — Wake word y modo conversación ⏳ (pasos ya cerrados, pendiente en P2/P3 arriba)

- [x] PWA escritorio — botón 👂, `SpeechRecognition(continuous:true)` detecta "bako", modo
  conversación con VAD nativa del navegador, timeout de 20 s (09/06/2026)
- [x] Desktop — OpenWakeWord opt-in (`BAKO_WAKE_WORD=1`), modelo `hey_jarvis` como placeholder
  fonético (08/06/2026)

---

## Horizonte 1 — Cerrar BAKO como asistente completo

Lo que queda del horizonte son los pendientes de arriba (7c paso 4, Fase 9 móvil/Desktop, Fase 6
diferida). Cuando esos se cierren, el horizonte está completo.

## Horizonte 2 — BAKO inteligente (~1-2 años)

> **Reenfocado el 05/09/2026.** El núcleo de "BAKO inteligente" ya no son los agentes: es el bloque
> **🧠 El cerebro de BAKO** de arriba (partir de cero, aprender preguntando, conectar y deducir), que
> pasa a prioridad 1. Lo de abajo viene **después**, y algunas piezas cambian de sentido cuando el
> cerebro exista: la Fase 10 (patrones) es prácticamente B4 aplicado al tiempo, y la Fase 11
> (multi-agente) solo tiene sentido sobre el tool-calling de B0.

### Fase 10 — Aprendizaje de patrones
- [ ] Analizar commits, tareas y rutinas para detectar patrones ("llevas 3 días sin avanzar en
  Diamadmin — ¿bloqueado?")
- [ ] Adaptar el briefing a la energía histórica por día de la semana

### Fase 11 — Orquestación multi-agente
Patrón ReAct propio, sin CrewAI ni dependencias externas. Un orquestador reparte y un verificador
valida las salidas antes de ejecutar.

| Agente | Rol | Herramientas clave |
|---|---|---|
| Dev Agent | Analiza código, genera componentes, revisa PRs, detecta bugs, genera tests | github_read/write, code_analyzer, code_generator |
| PM Agent | Gestiona sprints de Diamadmin y Unyona, prioriza, detecta deuda técnica | github_read, notion_read/write |
| Research Agent | Investiga tecnologías, compara librerías, sintetiza docs y papers | web_search, web_fetch, scraper, rss_reader |
| Learning Agent | Tutor de IA/ML, guía las fases del proyecto JARVIS | web_search, web_fetch, code_analyzer |
| Content Agent | Posts para bohdeveloper, copy, READMEs, SEO | web_search, file_read/write |
| Ops Agent | Monitoriza deploys Cloudflare/Vercel, analiza logs, audita seguridad | cloudflare_api, vercel_api |
| Ideas Agent | Valida micro-SaaS, analiza competencia, estima esfuerzo | web_search, scraper |

### Fase 12 — Fine-tuning con datos propios
- [ ] Entrenar Llama 3.2 3B o Mistral 7B con conversaciones, estilo de código y forma de comunicar

## Horizonte 3 — IA con identidad propia (~2-3 años)

- **Fase 13 — Visión:** OpenCV · YOLOv8 fine-tuneado · MediaPipe + FaceNet · ORB-SLAM2 · fusión de
  sensores con filtro de Kalman
- **Fase 14 — Multi-dispositivo:** app React Native · extensión de navegador · integración VS Code
- **Fase 15 — Casa inteligente:** Raspberry Pi como hub · luces/temperatura/música por voz ·
  "modo trabajo" · alertas físicas por LED

## Horizonte 4 — Presencia física / JARVIS (~3-5 años)

> **Prerequisito de aprendizaje en marcha (01/09/2026):** repo hermano
> [bako-lab](https://github.com/bohdeveloper/bako-lab) (`C:\aplic\bako-lab`) — electrónica y
> robótica desde cero hasta nivel experto aplicado, con Spec-Driven Development propio (su
> `plan.md` desglosa 15 módulos en 3 tracks). Ninguna fase de este Horizonte empieza en este repo
> hasta cerrar ese aprendizaje con criterio real (su Track C, módulo C2, es precisamente actualizar
> esta sección con detalle realista de chasis/CAD/presupuesto en vez de lo estimado hoy).

- **Fase 16 — Plataforma robótica:** Pi 4/5 8 GB + Arduino · chasis con encoders · CAD e impresión 3D
- **Fase 17 — Percepción:** cámara estéreo · micrófono de campo amplio · ultrasónico, IMU, LiDAR
- **Fase 18 — Autonomía:** ROS2 + nav2 · Gazebo (sim-to-real) · Stable-Baselines3 · Jetson Nano/Orin
- Presupuesto incremental: 1.500-3.000 €

## Ruta de aprendizaje IA/ML (prerequisito de los Horizontes 2+)

Punto de partida: nivel cero en IA/ML sobre una base fullstack sólida.

| Fase | Contenido | Duración | Recursos |
|---|---|---|---|
| A — Fundamentos | Álgebra lineal, cálculo, probabilidad + NumPy/Pandas/Matplotlib | Meses 1-3 | 3Blue1Brown, Andrew Ng (audit), StatQuest, Kaggle |
| B — ML clásico + NN | scikit-learn, regresión/clasificación, primera red Keras (MNIST) | Meses 3-6 | ML Specialization, Hands-On ML caps. 1-4 |
| C — Deep Learning + NLP | CNN, Transformers, fine-tune BERT, chatbot en Pi | Meses 6-18 | FastAI, Hugging Face NLP Course, CS224N |
| D — Visión + robótica | OpenCV, YOLOv8, SLAM, ROS2, sim-to-real con Gazebo | Meses 18-48 | Ultralytics, CS231N, ROS2 docs |

Hitos: mes 6 primera red neuronal · mes 14 chatbot en Raspberry Pi · mes 24 YOLOv8 custom +
reconocimiento facial · mes 36 navegación autónoma · mes 48+ sistema JARVIS integrado.
Presupuesto: 0-150 € (GPU cloud para entrenamientos pesados).

---

## Histórico de fases completadas

<details>
<summary><b>Tooling — Spec-Driven Development y migración del grafo (14/08/2026)</b></summary>

- `spec.md` y `plan.md` creados; `ROADMAP.md` fusionado aquí y eliminado
- `README.md` reescrito contra el estado real; `CLAUDE.md` unificado en la raíz
- **Grafo de código migrado de `graphify` a `codebase-memory-mcp`**: motor en C con tree-sitter, sin
  LLM y sin coste de tokens. `graphify-out/` (~1,3 MB versionados) eliminado del repo, `.mcp.json`
  declarado, `GRAPH_REPORT.md` regenerado en la raíz, hooks de `.claude/settings.json` reescritos
- Subagentes `git-master`, `ux-ui-designer` y `seo-master` instalados en `.claude/agents/` y
  versionados para que viajen entre las dos máquinas
</details>

<details>
<summary><b>Seguridad — hardening y retirada de secretos (junio 2026 → 01/09/2026, cerrado)</b></summary>

- Hardening completo: `helmet` con CSP, CORS con allowlist, rate limiters por familia de endpoint,
  validación y sanitización centralizadas, límite de 256 KB por request, error handler global que
  oculta stack traces en producción (commit `c302eb4`)
- Secretos retirados del árbol de trabajo: `import-borja-context-v2.ts` tenía la URI de Atlas con
  usuario y contraseña; `.env.example` tenía un `GOOGLE_CLIENT_SECRET` real (commit `fa05fb4`)
- `scripts/check-secrets.js`: escanea el índice antes de cada commit y aborta si encuentra
  credenciales de Mongo, Google, GitHub, Groq, Notion, Telegram, Anthropic/OpenAI o claves PEM;
  `.gitignore` reforzado (commit `99c0c80`)
- Notion adaptado al esquema "Centro de Mando": nombres de propiedad en constantes, relación de
  proyecto, `normalizePrioridad` → P1..P4, `normalizeEstadoTarea` → "Hecho", consultas paginadas
- **Purgado el historial de git** (10/08/2026) — `git filter-repo` reescribió los 187 commits
  afectados y se forzó el push a `origin/master`. Verificado por **git-master** el 30/08/2026 sobre
  los 580 blobs del historial alcanzable: no queda ni rastro de la URI de Mongo ni del client secret
  de Google, solo placeholders `***REMOVED-...***`
- **Máquina única confirmada sincronizada** (30/08/2026) — el PC del trabajo se dio de baja, ya no
  existe ningún dispositivo con la copia vieja del historial que pudiera resucitar la filtración con
  un push. El PC de casa (`bohpc`) tiene `HEAD` = `origin/master`, sin divergencia
- **Credenciales rotadas** (30/08/2026, confirmado en Notion y por el usuario el 01/09/2026) — nueva
  contraseña generada en MongoDB Atlas, `MONGODB_URI` actualizada en Render y `backend/.env`; cliente
  OAuth de Google recreado del todo (el viejo se borró), consent screen pasado de Testing a
  producción (con páginas de política de privacidad y home en `/bako-client`), `token.json`
  regenerado sin el límite de 7 días, `GOOGLE_CLIENT_ID`/`SECRET`/`TOKEN_JSON` actualizados en Render
  y `.env`, `auth-google.ts` re-autorizado. Cierra el riesgo real: las credenciales viejas estuvieron
  públicas ~10 semanas (02/06 → 10/08/2026) antes de redactarse, tiempo de sobra para que algún
  scraper las indexara — ya no sirven de nada
</details>

<details>
<summary><b>Horizonte 0 — Los cinco gaps del mayordomo</b></summary>

**Gap 1 — Memoria.** Colección `Memory` con tipo/importancia/fuente/tags · extracción automática
asíncrona tras cada conversación · carga por tiers con presupuesto de caracteres · comandos naturales
("recuerda que…", "olvida…", `/memorias`) · sin extracción en mensajes sensibles · saneada eliminando
`source: 'manual'` una vez las colecciones estructuradas cubrieron ese conocimiento.

**Gap 2 — Ejecución.** Crear tareas y cambiar estados en Notion · crear eventos en Google Calendar ·
sincronización bidireccional de issues GitHub+Notion · marcar el Tracker por voz ("completé el
Kronoshin", "no pude ir a BIZIKI porque llovía") · recordatorios internos con `setTimeout` y aviso
por voz.

**Gap 3 — Proactividad.** Briefing 05:45 (L-V) · resumen semanal viernes 18:00 · alerta de Tracker
vacío 22:00 · alertas inteligentes 08:30 (días sin commits, PRs sin actividad, reuniones) · motor de
reglas configurables evaluadas por LLM (`/regla`, `/reglas`, `/borrarregla`).

**Gap 4 — Acceso sin fricción.** Lenguaje natural sin comandos, con remap semántico de intenciones
(tareas→Tracker, eventos→Calendar, proyectos→Notion) · personalidad de 10 parámetros con 3 presets ·
estado de ánimo dinámico en 6 estados · 6 voces TTS vía `/voz` · correcciones fonéticas de Whisper
(Paco→BAKO) · respuestas por debajo de 2 s.

**Gap 5 — Conocimiento vivo.** `ProfileOverride` en MongoDB con prioridad sobre `profile.ts` ·
`buildDynamicProfileContext()` · actualización por lenguaje natural ("ya no trabajo en Inetum") ·
`/perfil` para ver y editar · historial de cambios con `prevValue` · alerta los lunes a las 09:00 si
un campo lleva 90+ días sin tocarse.
</details>

<details>
<summary><b>Fase 7b — Memoria cognitiva (junio 2026)</b></summary>

Convertir 103 memorias planas en un sistema cognitivo estructurado, semántico y auto-actualizable,
manteniendo el coste en $0.

- **7b-A — Colecciones estructuradas:** `People`, `Projects` y `KnowledgeEntry` en MongoDB con API
  REST completa y panel admin (5 columnas, drag & drop con `PATCH /reorder`) · formateo a prosa
  natural en el system prompt · deduplicación algorítmica en 3 pasadas sin LLM · migración desde
  `profile.ts` sin LLM (familia, 9 proyectos incluida Operación Galego, 19 entradas de conocimiento)
  · limpieza de memorias `source: 'manual'` · system prompt optimizado eliminando el JSON de
  `BAKO_PROFILE` (~3.000 chars redundantes)
- **7b-B — Embeddings:** `nomic-embed-text` (768d) en background al guardar, con fallback a
  Cloudflare Workers AI `bge-small-en-v1.5` (384d) · campos `embedding`/`embeddingDim`/`embeddingModel`
  · endpoint de backfill y botón en el panel
- **7b-C — Búsqueda semántica:** `getMemories(query)` con similitud coseno en Node.js, top-15, con
  caída a tiers si el embedding falla o hay pocos candidatos
- **7b-D — Modificación activa:** `deduplicateAndSave()` busca similares ≥ 0,85 excluyendo
  `source: 'manual'` y un prompt mínimo decide ACTUALIZAR o CREAR — "ya no voy a BIZIKI" actualiza en
  vez de duplicar

Resultado: ~20 registros ricos (~800 chars) sustituyen a 33 fragmentos planos (~1.800 chars).
</details>

<details>
<summary><b>Fases 5, 7 y 8 — Email, panel admin y automatización (junio 2026)</b></summary>

- **Fase 5 — Gmail:** `/email` lista los correos sin leer por voz y texto · redacción por voz con
  preview y botones inline [Enviar] [Borrador] [Cancelar] · envío vía `drafts.send`, nunca sin
  confirmación · presencia en el briefing matutino
- **Fase 7 — Panel admin** integrado en la PWA: auth JWT con roles superadmin/user y gestión de
  usuarios · pestaña Memorias con badges de tier e importancia, búsqueda en tiempo real, filtros,
  edición inline sobre Atlas, creación y borrado
- **Fase 8 — Automatización sin n8n**, dentro de `ProactivityService`: Tech Radar los lunes a las
  09:30 (5 feeds filtrados por LLM) · PR Review automático L-V 08:30 (diff de GitHub analizado como
  senior dev) · `/automaticos` con 7 crons conmutables persistidos en `AutoConfig`
</details>

<details>
<summary><b>Clientes — PWA, Desktop y Web Push (junio 2026)</b></summary>

- **PWA v1→v4:** chat con burbujas e historial · input de texto · revisión de transcripción con
  countdown (`REVIEW_TIMEOUT` 5 s → 10 s) · modo claro/oscuro · pull-to-refresh · mic inline ·
  interrupción de BAKO con `AbortController` e icono stop rojo · 63 presets en 11 categorías ·
  badge de LLM en la navbar con refresco cada 60 s · limpiar chat pulsando en "BAKO"
- **Desktop v1→v4:** GUI tkinter con el mismo lenguaje visual · hotkey global `Ctrl+Alt+B` ·
  auth JWT compartida · `llama3.2:3b` con prompt compacto y `num_ctx` 2048
- **Web Push:** `sw.js` + `PushSubscription` en MongoDB + `/api/push` — notificaciones nativas con la
  app cerrada · voz al tocar la notificación vía `postMessage` (evita la restricción de autoplay)
- **Endpoints desktop:** `/api/desktop/voice`, `/text`, `/transcribe`, `/stream`
</details>

<details>
<summary><b>Contexto, LLM y correcciones (junio 2026)</b></summary>

- Groq `llama-3.3-70b-versatile` tras la retirada de `gemma2-9b-it` · cadena OpenRouter de 5 modelos
  con skip en 404 y re-throw del 429
- Geolocalización por IP (`ip-api.com`, caché 30 min): clima y previsión siguen a la ubicación real
- Ubicación por rutina: Inetum L-V 7-15 h, Errentería el resto, con override manual "estoy en X"
- Weather con semántica temporal en 5 ramas (pasado, ahora, mañana, esta semana, defecto) y caché de
  10 min; Errentería→Donostia por cobertura de datos
- Tracker siempre con datos frescos de D1 cuando se menciona, con respuesta explícita
  "completada" / "no completada: motivo" / "pendiente"
- Calendar en tiempo real distinguiendo eventos pasados y futuros, sin extraer eventos a memoria
- Temperatura 0,4 y `max_tokens` 400 para respuestas precisas · "No le entiendo, señor" ante
  mensajes ininteligibles · instrucción anti-alucinación con los emails en contexto
- Fix del clasificador: `\b` en JavaScript no reconoce vocales acentuadas — "¿Lloverá mañana?" se
  clasificaba como compleja y agotaba el TPD de Groq en ~21 peticiones (commit `f2f7dba`)
- Noticias en español con feeds de actualidad (El Confidencial, 20minutos, La Vanguardia) y resumen
  traducido por LLM
- 101 memorias importadas desde 10/10 XMLs de contexto (ver [KNOWLEDGE.md](KNOWLEDGE.md))
</details>

---

## Hitos personales vinculados

| Meta | Parte de BAKO que la sostiene |
|---|---|
| Diamadmin en producción con usuarios | PM Agent + Dev Agent + ejecución de acciones |
| Unyona validada con leads reales | Content Agent + Ideas Agent |
| Portfolio que consigue clientes | Blog comments + IA pública (Fase 7) |
| Aprender IA/ML en profundidad | Learning Agent guía la ruta de aprendizaje |
| Vivir en Galicia trabajando en remoto | BAKO viaja contigo: misma experiencia en cualquier sitio |
| JARVIS físico funcional | Horizontes 3 y 4 |
