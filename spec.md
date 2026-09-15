# spec.md — BAKO (Borja's Autonomous Knowledge Operator)

> Documento vivo de especificación (Spec-Driven Development).
> Memoria del proyecto: qué es, cómo está construido, decisiones y metodología.
> El trabajo pendiente vive en [plan.md](plan.md), que incluye el histórico resumido de lo completado.
> **Regla: toda decisión nueva de producto o arquitectura se registra aquí en la misma sesión.**

---

## 1. Qué es BAKO

Un **mayordomo digital personal** para Borja. No un chatbot: un Alfred. Conoce quién es su señor,
dónde está, qué tiene pendiente y cómo van sus proyectos; habla por voz, actúa sobre sistemas reales
(Notion, GitHub, Google Calendar, Cloudflare D1, Gmail) y toma la iniciativa sin que se lo pidan.

- **Usuario:** uno solo (Borja). No es un producto multi-tenant; hay auth con roles porque el panel
  admin y los clientes están expuestos en internet, no porque haya clientes.
- **Fase actual:** MVP en producción, 24/7. Horizonte 0 (los 5 gaps de mayordomo) cerrado;
  Horizonte 1 casi completo.
- **Coste:** **$0/mes** de infraestructura. Es un requisito de diseño, no una casualidad.

### Superficies

| Superficie | Dónde |
|---|---|
| Backend / API | `https://ai-personal-os.onrender.com` (Render, plan free, deploy automático desde `master`) |
| PWA cliente web | `https://ai-personal-os.onrender.com/bako-client/` — instalable en móvil y PC |
| Telegram | Bot `@bako_bot`, polling desde el backend |
| Desktop | `bako-desktop/bako_desktop.py`, GUI tkinter, hotkey `Ctrl+Alt+B` |
| Ollama local | `https://ollama.bohdeveloper.com` (Cloudflare Tunnel `bako-ollama` desde el PC de casa) |
| Repositorio | `github.com/bohdeveloper/bako` — **público**. El servicio de Render conserva el nombre antiguo `ai-personal-os` |

### Las cinco cualidades del mayordomo

Toda feature se evalúa contra esta lista antes de entrar en el plan:

| Cualidad | Estado |
|---|---|
| **Memoria** — recuerda tu historia, bloqueos y decisiones | ✅ Memoria cognitiva con embeddings |
| **Ejecución** — no informa, actúa | ✅ Notion, Calendar, GitHub, Tracker, recordatorios |
| **Proactividad** — habla sin que le preguntes | ✅ 8 crons configurables + motor de reglas |
| **Acceso sin fricción** — dices su nombre y está | ⚠️ Wake word en PWA de escritorio; móvil pendiente |
| **Conocimiento vivo** — evoluciona contigo | ✅ ProfileOverride + colecciones estructuradas |

**Regla de priorización:** antes de añadir una integración de *lectura* nueva, comprobar que cierra
uno de estos cinco gaps. Si no, espera.

---

## 2. Stack y arquitectura

| Capa | Tecnología |
|---|---|
| Backend | Node 20 · Express 5 · TypeScript · `ts-node`/`nodemon` en dev, `tsc` → `dist/` en prod |
| BD principal | MongoDB Atlas M0 (512 MB) vía Mongoose — memoria, perfil, usuarios, config |
| BD portfolio | Cloudflare D1 (SQLite edge) — Tracker personal y comentarios del blog |
| LLM local | Ollama `qwen3:8b` (`OLLAMA_MODEL`) en la AMD RX 7600 de 8 GB vía ROCm, expuesto por el túnel Cloudflare — **proveedor por defecto** cuando el túnel responde |
| LLM cloud | Groq `openai/gpt-oss-120b` (Groq retiró `llama-3.3-70b-versatile` en agosto 2026 — ya no ofrece modelos Llama, solo `gpt-oss`, Qwen y `compound`) |
| LLM fallback | OpenRouter (cadena de 5 modelos free, `OPENROUTER_MODEL` configurable) |
| Embeddings | Ollama `nomic-embed-text` (768d) · fallback Cloudflare Workers AI `bge-small-en-v1.5` (384d) |
| Voz salida | `msedge-tts` — las 3 únicas voces neuronales es-ES de Microsoft (Álvaro, Elvira, Ximena; verificado con `MsEdgeTTS.getVoices()` el 31/08/2026, el resto del catálogo es-* es de Latinoamérica/EEUU), elegible y persistida en Mongo (`AutoConfig`, no en memoria del proceso) desde Telegram (`/voz`), PWA y Desktop |
| Voz entrada | Groq Whisper |
| Clientes | Telegram Bot API · PWA vanilla JS · Python tkinter |
| Seguridad | `helmet` · `cors` con allowlist · `express-rate-limit` · JWT (`jsonwebtoken`) · `bcryptjs` |
| Cron | `node-cron` dentro del propio proceso (sin n8n, sin infraestructura extra) |
| Hosting | Render free (`render.yaml`) |
| Grafo de código | `codebase-memory-mcp` (ver [GRAPH_REPORT.md](GRAPH_REPORT.md)) |

### Estructura del repositorio

```
bako/
├── backend/
│   ├── src/
│   │   ├── index.ts                # Express, helmet/CORS/rate limit, monta rutas, arranca bot y crons
│   │   ├── llm/claude.ts           # Orquestador LLM: routing por complejidad + cadena de fallback
│   │   ├── knowledge/profile.ts    # Solo lo irreductible (trato, estilo) — sin datos de Borja desde B2
│   │   ├── memory/                 # Modelos Mongoose: Memory, Person, Project, KnowledgeEntry,
│   │   │                           #   ProfileOverride, User, Task, Rule, Notification,
│   │   │                           #   PushSubscription, AutoConfig
│   │   ├── middleware/             # authMiddleware (JWT + roles) · security (limiters, validación)
│   │   ├── routes/                 # agent, auth, desktop, bakoClient, people, projects, knowledge,
│   │   │                           #   notifications, autoconfig, tts, push
│   │   ├── tools/                  # telegram, notion, github, calendar, gmail, weather, news, tts,
│   │   │                           #   time, context, memory, embeddings, agent, issueSync,
│   │   │                           #   projectSync, planSync, profileDynamic
│   │   ├── agents/MorningBriefingAgent.ts
│   │   └── services/               # ProactivityService (crons) · pushService (Web Push)
│   ├── scripts/                    # auth-google, seed/setup Notion, import de contexto, autostart
│   └── public/bako-client/         # PWA: index.html (~4.000 líneas) + manifest.json + sw.js
├── bako-desktop/bako_desktop.py    # Cliente de escritorio Python
├── scripts/check-secrets.js        # Escáner de secretos pre-commit
├── spec.md · plan.md · README.md · GRAPH_REPORT.md · SETUP.md · CLIENTS.md · KNOWLEDGE.md
└── render.yaml · .mcp.json
```

### Patrones de arquitectura establecidos

**Orquestación del LLM (`llm/claude.ts`) — el punto más crítico del sistema.**
`askClaude` tiene fan-in 15: Telegram, PWA, Desktop, briefing y crons pasan todos por ahí.

1. `classifyQueryComplexity()` clasifica con **regex determinista** (0 ms, sin LLM). Un clasificador
   basado en `llama3.2:3b` se probó y **se descartó**: etiquetaba "Diamadmin" o "mi rutina" como simple.
2. Simple (saludos, clima, hora) → `getMinimalSystemPrompt()` (~5.900 chars) → Ollama.
3. Complejo → `getFullSystemPrompt()` → Groq.
4. Cadena de fallback en ambas rutas: **Ollama → Groq → OpenRouter**. Si OpenRouter también falla,
   se re-lanza el 429 original para que el cliente vea "Rate limit" y no un 500.
5. `isGroqRateLimit()` captura **429 y 413** (request too large): ambos disparan el fallback.

**Construcción del system prompt.** Orden fijo: personalidad y estado de ánimo primero, luego
Proyectos → Personas → Conocimiento → Memorias. Cada sección tiene **presupuesto de caracteres**
(compact: people 5k / projects 6k / knowledge 4k · full: 6k / 6k / 5,5k) porque el límite real es el
TPM de Groq, no el contexto del modelo. Las cabeceras llevan el total real cuando el presupuesto
recorta la lista.

**Memoria cognitiva.** Al guardar un hecho, `deduplicateAndSave()` busca similares por coseno
(≥ 0,85) y un prompt mínimo decide ACTUALIZAR o CREAR. `getMemories(query)` recupera por relevancia
semántica y solo cae al sistema de tiers (social 20 → proyectos 5 → personal 3 → técnico 2) si el
embedding falla o hay menos de 5 candidatos.

**Contexto ambiental con caché.** `getAmbientContext()` compone hora española, ubicación, clima y
agenda. Cachés cortas (clima 10 min, calendar 1 min) con invalidación explícita
(`invalidateCityWeatherCache`, `invalidateCalendarCache`, `invalidateTrackerCache`) cuando el mensaje
menciona el recurso — el tracker y el calendario nunca se responden desde caché si se preguntan.

**Ejecución de acciones — tool-calling, no regex** (`tools/agent.ts`, desde el 05/09/2026;
`tools/actions.ts` con su detección por regex queda eliminado). `runAgentTurn()` es el punto de
entrada único: una sola llamada a `askClaudeWithTools()` (Groq/Ollama, formato OpenAI) decide, con el
mismo contexto de siempre, si BAKO conversa en texto o llama a una de las 6 herramientas registradas
(crear/actualizar tarea, crear evento, crear/cerrar issue, siguiente acción). Las herramientas
`destructive` (hoy solo crear evento de Calendar) piden confirmación explícita antes de ejecutarse,
con estado en memoria (`pendingActions`, TTL 5 min). En Telegram la confirmación va con **botones
inline** (igual que el envío de email); en PWA y Desktop, comparando la **frase completa
normalizada** (sin acentos ni signos) contra una lista cerrada, más una vía acotada para
confirmaciones habladas — nunca por prefijo, o "Si mañana llueve…" ejecutaría la acción pendiente.
Medido el 05/09/2026: `qwen3:8b` en Ollama alucina llamadas a herramientas sin que nadie
las pida (Groq no), así que el gate de confirmación cubre **todas** las herramientas cuando quien
respondió de verdad fue Ollama, no solo las `destructive` — hasta que un modelo local más grande o
más fino en instrucciones lo haga innecesario. `issueSync.ts` y `projectSync.ts` mantienen Notion y
GitHub sincronizados en ambos sentidos; `planSync.ts` mantiene las tareas de BAKO en Notion
sincronizadas con `plan.md`.

**Proactividad.** `ProactivityService` registra los crons y `AutoConfig` (MongoDB) guarda qué está
activado; `/automaticos` los conmuta con botones inline. `isJobEnabled()` se consulta antes de cada
ejecución. Cron `notion_sync` (cada 6h): lee `plan.md` en crudo desde GitHub (raw.githubusercontent.com,
sin auth), extrae las líneas `[x]`, y con una llamada a Groq empareja cada una contra las tareas de
BAKO todavía abiertas en Notion — si hay coincidencia clara, las marca "Hecho" y avisa por Telegram.
Evita el desfase que hubo hasta el 30/08/2026 entre lo cerrado en el plan y lo reflejado en Notion.

**Seguridad transversal.** Rate limiters por familia de endpoint (`loginLimiter`, `llmLimiter`,
`generalLimiter`, `ttsLimiter`), validadores y sanitizadores centralizados en `middleware/security.ts`
(`sanitizeString`, `validateMessage`, `validatePrompt`, `sanitizeTags`, `buildSafeSearchRegex`),
límite de 256 KB por request y error handler global que oculta stack traces en producción.

### Modelo de dominio

`Person`, `Project` y `KnowledgeEntry` son el **conocimiento estable y estructurado** (familia,
amigos, proyectos con su siguiente acción, salud, valores, finanzas, historia). `Memory` guarda solo
hechos dinámicos extraídos de conversaciones. `ProfileOverride` pisa campos de `profile.ts` sin tocar
código. Los tres primeros se formatean a **prosa legible** (`formatPersonForContext` y hermanas), no
a listas `clave: valor`, porque el LLM responde de forma más natural con prosa. `AutoConfig`, `Rule`,
`Notification`, `PushSubscription`, `User` y `Task` sostienen crons, reglas, avisos, Web Push, auth e
historial.

---

## 3. Decisiones de producto y reglas de negocio (invariantes)

No se reabren sin decisión explícita del usuario.

0. **BAKO parte de cero y aprende hablando** (decidido el 05/09/2026, reenfoque del proyecto). El
   conocimiento sobre Borja y su entorno **vive en la base de datos, nunca en el código**: BAKO lo
   construye poco a poco conversando, pregunta con criterio lo que le falta, y sabe conectar y
   deducir en vez de recitar fichas. Cualquier propuesta que añada conocimiento personal al código
   choca con este invariante. **Reset real ejecutado el 15/09/2026 (B2)**: las 306 líneas de
   `profile.ts` y lo migrado en 7b-A (9 proyectos, familia, 19 entradas de conocimiento) se
   descartaron sin conservar — con volcado de seguridad local, fuera del repo — en vez de migrarse.
   Lo único sembrado fue la identidad mínima que pidió el señor (nombre, nombre completo, fecha de
   nacimiento, sexo, ubicación), como `ProfileOverride`, nunca en código. Todo lo demás se reaprende
   hablando con el clasificador de `tools/brain.ts` (B1). Detalle y fases en `plan.md`, bloque
   "🧠 El cerebro de BAKO".
1. **Coste $0/mes.** Cualquier propuesta que introduzca un servicio de pago se rechaza o se difiere
   (por eso Twitter/X y LinkedIn siguen pendientes: sus APIs requieren plan de pago).
2. **El repositorio es público.** Ningún secreto entra en git, nunca. `scripts/check-secrets.js`
   corre como hook pre-commit y aborta el commit si detecta credenciales. Instalación:
   `node scripts/check-secrets.js --install`. Ya hubo una filtración (URI de Atlas con contraseña y
   un client secret de Google, expuestas 187 commits / ~10 semanas): el historial se purgó con
   `git filter-repo` el 10/08/2026 y ambas credenciales se rotaron el 30/08/2026 (Atlas + cliente
   OAuth de Google recreado del todo) — incidente cerrado.
3. **Privacidad por dos capas.** Palabras sensibles (`inetum`, `contrato`, `nómina`, `sueldo`,
   `password`, `token`, `credencial`, `dni`, `banco`) → se procesan solo en Ollama local; si Ollama
   no está disponible, el mensaje se rechaza en vez de salir a la nube. `/privado` fuerza local.
4. **Nunca dos instancias del bot de Telegram.** El backend local (`npm run dev`) no puede correr en
   paralelo con Render: duplica mensajes. En local nunca se levanta con PM2.
5. **Notion es la fuente de verdad de los issues.** El briefing no incluye issues de GitHub; GitHub
   se sincroniza *desde* Notion.
6. **Notion — Centro de Mando.** El esquema vive en constantes en `tools/notion.ts`: el título es
   `Tarea`, el proyecto es una **relación** (no texto), la fecha es `Fecha objetivo`.
   `normalizePrioridad` traduce alta/media/baja → P1..P4 y `normalizeEstadoTarea` "completada" →
   "Hecho", para que los prompts sigan hablando en lenguaje natural. Las consultas **paginan**.
7. **Las memorias `source: 'manual'` son intocables** para el LLM (solo lectura). Solo puede
   actualizar, nunca borrar, sin confirmación explícita.
8. **El proveedor por defecto lo decide `LLM_PREFER_LOCAL`, desde el 05/09/2026 `true` → Ollama**
   con Groq de respaldo. Lo que lo bloqueaba era la VRAM y dejó de serlo al montar la **AMD Radeon
   RX 7600 de 8 GB** (funciona con Ollama vía **ROCm, no CUDA** — la máquina ya no tiene GPU NVIDIA).
   Medido el 05/09/2026 con un prompt real de 7.695 tokens: `qwen3:8b` responde en **0,6 s** con el
   modelo caliente y 14,8 s si hay que cargarlo, frente a los 85 s de la GTX 1650 anterior.
   Tres reglas que salieron de esa medición y no son obvias:
   `OLLAMA_NUM_CTX` **se queda en 8192** (a 12288 la generación cae de 37,5 a 5,4 tok/s en esta GPU,
   aunque `ollama ps` siga diciendo 100 % GPU); `OLLAMA_TIMEOUT_MS` **debe superar los 14,8 s de
   carga en frío** y quedar bajo el safety de 25 s de los endpoints desktop — con los 12 s de antes,
   la primera pregunta tras un rato de inactividad se iba siempre a Groq; y las llamadas mandan
   `keep_alive` (`OLLAMA_KEEP_ALIVE`, 30m) para que el modelo siga residente y se responda en 0,6 s
   en vez de 14,8 s, a costa de ~6,2 GB de VRAM ocupados mientras dura.
   Ollama arranca solo con su propia app de bandeja (`ollama app.exe`, acceso directo en la carpeta
   de Inicio de Windows), que levanta el servidor **sin ventana de consola**. Ojo al comprobar si
   arranca solo: mirar **la carpeta de Inicio**, no solo la clave `Run` del registro — mirar solo el
   registro llevó el 05/09/2026 a crear una tarea `BAKO-Ollama-Serve` que duplicaba el arranque y
   abría un CMD de más; se eliminó.
   El túnel corre como **servicio de Windows** (`Cloudflared`, LocalSystem, arranque automático):
   sin ventana y **antes de iniciar sesión**, así que el túnel está vivo aunque nadie se loguee. La
   tarea `BAKO-Ollama-Tunnel` que hacía esto antes queda **desactivada** como respaldo
   (`Enable-ScheduledTask` la recupera). Trampa al instalarlo: `cloudflared service install` registró
   el servicio **sin argumentos** (solo el exe, sin `--config` ni `tunnel run`), así que figuraba como
   "Running" sin servir nada; hay que comprobar el `binPath` con `sc qc Cloudflared` y, si falta,
   fijarlo con `sc config`.
   **El túnel está autenticado** (`OLLAMA_AUTH_KEY` → cabecera `x-bako-key` en las seis llamadas a
   Ollama): Ollama no tiene login propio y su hostname está publicado en un repo público, así que hay
   una regla WAF en Cloudflare que **bloquea todo lo que no lleve esa cabecera**. Antes de eso, lo
   único que separaba la GPU de casa de internet era el filtro de bots de Cloudflare, que devolvía
   403 a los datacenters — y por tanto **a Render**, dejando el badge gris permanentemente por mucho
   que el PC estuviera encendido. Al montar la regla hay que apagar Bot Fight Mode: en el plan
   gratuito no se puede saltar con reglas WAF.
   Reglas que sí están activas: el badge de la PWA solo permite elegir **con el túnel vivo** — sin él
   queda deshabilitado, fijo en Groq, ignorando la preferencia guardada; y el backend siempre manda
   sobre el cliente. `think:false` es obligatorio con qwen3 (emite `<think>` por defecto) y
   `stripThinking()` lo limpia también sin cerrar, por si `num_predict` trunca el razonamiento.
9. **Prompt siempre compact en los endpoints desktop.** El prompt full (~18.100 chars ≈ 6.023 tokens)
   supera el límite de 6.000 TPM de Groq y garantiza un 413.
10. **`profile.ts` ya no es autoritativo para nada personal** (invariante reescrito el 15/09/2026,
    B2). Solo contiene `instrucciones_para_bako` (trato de "señor", estilo, prioridad de no
    inventar) — nada que dependa de un hecho concreto sobre Borja. La identidad mínima vive en
    `ProfileOverride` (`tools/profileDynamic.ts`), y `buildDynamicProfileContext()` avisa
    explícitamente cuando no hay nada sembrado ("modo génesis") en vez de dejar huecos que el LLM
    rellene inventando.
11. **Personalidad configurable** con `mayordomo clásico` como preset por defecto (sarcasmo 8,
    ironía 8). El tono se adapta solo mediante el estado de ánimo detectado.
12. **La voz nunca lleva markdown.** `cleanForVoice` limpia todo antes del TTS.
13. **Confirmación obligatoria antes de enviar email.** Gmail nunca envía sin botón explícito.
14. **`\b` está prohibido en las regex de clasificación en español.** En JavaScript no reconoce
    caracteres no ASCII: "¿Lloverá mañana?" se clasificaba como compleja por la `á` final y agotaba
    la cuota de Groq. Usar clases explícitas o lookarounds con acentos.

---

## 4. Sistema de diseño y convenciones UI

La PWA es un **único `index.html` de ~4.000 líneas** con CSS y JS inline (sin build, sin framework,
sin bundler). Es deliberado: se sirve como estático desde Express y se actualiza sin pipeline.

- **Paleta:** fondo `#0a0a0a` / `#1a1a1a` (oscuro), texto `#e8e8e8`; acento **teal `#14b8a6`**;
  semánticos: verde `#10b981` (éxito, burbuja usuario), azul `#4a9eff` (BAKO), ámbar `#f59e0b`
  (Groq / avisos), rojo `#ef4444` (error, stop, acciones destructivas), violeta `#a78bfa`.
- **Tipografía:** stack del sistema (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`).
  Sin webfonts — coste de red cero.
- **Modo claro/oscuro** con toggle luna/sol en ambos clientes.
- **Panel admin:** monocromático con acentos teal, a pantalla completa, 5 columnas en escritorio y
  wrap en móvil, drag & drop con grip handle para reordenar.
- **Chat:** burbujas (usuario a la derecha, BAKO a la izquierda) con acciones por mensaje —
  ↩ reenviar · ✕ borrar · 🔊 voz.
- **El Desktop replica la PWA**, no diverge: misma auth, mismos presets, mismo comportamiento de
  interrupción y rate limit.

**Prohibiciones:**
- Nada de frameworks ni bundlers en la PWA. Vanilla JS o no entra.
- Nada de webfonts ni CDNs externos: la CSP de `helmet` solo permite `'self'` más los endpoints de
  LLM declarados en `index.ts`. Añadir un origen nuevo obliga a tocar la CSP conscientemente.
- Nada de iconos por librería: SVG inline.

---

## 5. Entorno de desarrollo y producción

**Local:**
```bash
cd backend
npm install
cp .env.example .env       # rellenar; .env NUNCA entra en git
npm run dev                # nodemon + ts-node
```
Arranque correcto = `✅ MongoDB conectado` + `🤖 BAKO Telegram activo` + `📡 BAKO Proactividad activa`.

- **Una sola máquina** (PC de casa; el del trabajo se dio de baja el 30/08/2026): expone Ollama por
  el túnel Cloudflare `bako-ollama` (Task Scheduler `BAKO-Ollama-Tunnel`).
- **Producción:** Render despliega solo al hacer push a `master`. Las variables van en el dashboard
  de Render; `render.yaml` declara cuáles con `sync: false`. **Cambiar `render.yaml` no cambia nada
  en producción** — solo se aplica al sincronizar el Blueprint; manda siempre el dashboard.
- ⚠️ **El ISP de casa bloquea a ratos los rangos de IP de Cloudflare** (los bloqueos por IP que hacen
  los operadores españoles): las IPs de la zona dejan de responder, presentan un certificado
  autofirmado `core1.netops.test / Widgits Pty Ltd` para cualquier SNI y no envían `cf-ray`. Va y
  viene solo. Verificado el 05/09/2026 con `tracert`: la interceptación está dentro de la red del
  operador (salto 3 en adelante), no en el equipo ni en Cloudflare, y **no afecta a Render**.
  Implicación práctica: **no diagnosticar el túnel desde el PC de casa cuando pase esto** — un
  `bohdeveloper.com` "caído" desde casa puede estar perfectamente en pie para el resto del mundo. La
  prueba buena es el badge de la PWA o los logs de Render. Para distinguirlo en 10 segundos: si otra
  IP de Cloudflare sirve el mismo hostname con certificado válido, es el ISP.
- **Google Calendar/Gmail:** `npx ts-node scripts/auth-google.ts` genera `token.json`; su contenido
  se pega como `GOOGLE_TOKEN_JSON` en Render. El `refresh_token` no caduca salvo revocación.
- **Instalación en máquina nueva:** [SETUP.md](SETUP.md), incluida la tabla de límites por servicio.

**Deuda aceptada deliberadamente:**
- Sin tests automatizados. La verificación es manual, contra la app real.
- PWA en un solo fichero de 4.000 líneas: se asume a cambio de no tener build.

---

## 6. Metodología de desarrollo (Spec-Driven Development)

### Antes de desarrollar
1. Leer `spec.md` (§3 invariantes y §6) y `plan.md`. Si la tarea no está en el plan, **añadirla
   primero**.
2. **Revisar las tareas abiertas de BAKO en Notion** (base "Tareas" del Centro de Mando, proyecto
   BAKO) antes de tocar código: si la tarea no existe ahí, crearla; si ya existe, no duplicarla.
3. Contrastar con los invariantes de §3 y con las cinco cualidades de §1; avisar si algo choca.
4. Explorar el código con **codebase-memory-mcp** (`get_architecture`, `search_graph`, `trace_path`,
   `get_code_snippet`), no releyendo ficheros enteros. `get_graph_schema` primero en cada sesión.
5. Buscar la entidad o el helper que ya cubra el concepto antes de crear uno nuevo — sobre todo en
   `tools/` y `middleware/security.ts`, donde ya hay validadores y cachés centralizados.
6. Para cualquier cosa visual, delegar en el subagente **ux-ui-designer** antes de maquetar.
7. Desglosar las tareas grandes en fases dentro de `plan.md` antes de empezar.

### Durante el desarrollo
- Español en comentarios, mensajes de commit y textos de usuario.
- Todo endpoint nuevo pasa por `requireAuth` (si aplica), un rate limiter y un validador de
  `middleware/security.ts`. No se escribe validación ad hoc.
- Los nombres de propiedades de servicios externos (Notion) viven en constantes, nunca en literales
  repartidos.
- Cualquier prompt nuevo respeta los presupuestos de caracteres de §2.

### Después de desarrollar
1. `cd backend && npm run build` (typecheck + build) de lo tocado.
2. **`/code-review` sobre el diff — obligatorio antes de cerrar cualquier feature.**
3. `/security-review` si se toca auth, privacidad, secretos o se añaden endpoints.
4. Verificar de punta a punta en la app real (Telegram, PWA o Desktop según lo tocado) y cerrar los
   procesos que se hayan levantado. Nunca dejar `npm run dev` corriendo en paralelo con Render.
5. Registrar: marcar el punto en `plan.md` con fecha · **actualizar el estado de la tarea
   correspondiente en Notion** (Hecho/En curso/Bloqueado, con nota si aporta contexto) · decisiones
   nuevas → `spec.md` §3 · cambios de alcance o de stack → `README.md`.
6. Reindexar el grafo si el cambio fue grande: `codebase-memory-mcp cli index_repository
   '{"repo_path":"C:/aplic/bako"}'`.
7. Commit **solo cuando el usuario lo pida** (él revisa el diff), en el estilo del `git log`:
   `tipo: descripción en español` + cuerpo explicando el porqué.
8. `/simplify` opcional al cerrar una fase.

### Skills y cuándo usarlas

| Skill | Cuándo |
|---|---|
| `/code-review` | Obligatoria sobre el diff antes de cerrar cualquier feature |
| `/security-review` | Auth, privacidad, secretos, endpoints nuevos, dependencias |
| `/security-master` | Auditoría completa (IDOR, rate limiting, headers, CORS, uploads), no solo el diff |
| `/grafo-designer` | Reconstruir o explorar el grafo de código; medir blast radius |
| `/spec-driven` | Mantener `spec.md` y `plan.md` sincronizados con la realidad |
| `/simplify` | Limpieza de reutilización y complejidad al cerrar una fase |
| `/claude-api` | Antes de tocar cualquier integración con modelos (params, límites, caching) |
| `/dataviz` | Si el panel admin incorpora gráficas o métricas |
| `/run` | Levantar la app para verificar un cambio de verdad |

### Subagentes del proyecto (`.claude/agents/`)

| Agente | Cuándo usarlo | Cuándo NO |
|---|---|---|
| **git-master** | Git no trivial: conflictos de merge/rebase/cherry-pick, push/pull con divergencia, estrategia de ramas, recuperar trabajo con reflog, limpiar historia — **incluida la purga de los secretos filtrados** | `git status` o un commit rutinario |
| **ux-ui-designer** | Todo lo visual: PWA, panel admin, GUI del Desktop, sistema de diseño, responsive, animaciones, accesibilidad | Lógica de negocio o backend sin componente visual |
| **seo-master** | Posicionamiento e indexabilidad: metadatos, Open Graph, `manifest`, datos estructurados, Core Web Vitals, robots/sitemap si alguna superficie se hace pública | Diseño visual sin objetivo de búsqueda |

Los tres trabajan en español y leen este `spec.md` antes de actuar. Están versionados en el repo
para que cualquier máquina nueva (si el setup vuelve a ser multi-dispositivo) use los mismos
especialistas sin reconfigurar nada.

---

## 7. Documentos del proyecto

| Documento | Rol |
|---|---|
| [spec.md](spec.md) | **Memoria.** Qué es, cómo está construido, invariantes, metodología |
| [plan.md](plan.md) | **Trabajo.** Estado actual, puntos pendientes por fases, histórico completado |
| [README.md](README.md) | **Escaparate.** Presentación pública del repositorio |
| [GRAPH_REPORT.md](GRAPH_REPORT.md) | Grafo estructural del código: hotspots, clusters, cómo consultarlo |
| [SETUP.md](SETUP.md) | Instalación en máquina nueva, credenciales, límites de cada servicio |
| [CLIENTS.md](CLIENTS.md) | Los tres clientes: Telegram, PWA, Desktop — comandos y capacidades |
| [KNOWLEDGE.md](KNOWLEDGE.md) | Base de conocimiento: fuentes, categorías, proceso de asimilación |
| [CLAUDE.md](CLAUDE.md) | Reglas de trabajo para Claude Code (apunta aquí, no duplica) |
