# BAKO — Roadmap completo
### Borja's Autonomous Knowledge Operator

> De asistente personal a mayordomo digital omnisciente con presencia física.
> El objetivo final: un Jarvis real. No en ficción — en producción.

---

## Ideología de desarrollo

**BAKO es un mayordomo, no un chatbot.**

Un mayordomo de verdad — Alfred, Jarvis — tiene cinco características que lo definen. Cada decisión de arquitectura, cada feature, cada prioridad debe evaluarse contra esta lista:

| Característica | Descripción | Estado BAKO |
|---|---|---|
| **Memoria** | Recuerda todo lo que le has dicho. Conoce tu historia, tus bloqueos, tus decisiones | ✅ Implementado |
| **Ejecución** | No solo informa — actúa. Crea, modifica, cierra, agenda | ✅ Implementado |
| **Proactividad** | Anticipa necesidades. Habla sin que le preguntes cuando hay algo relevante | ✅ Implementado |
| **Acceso sin fricción** | Está ahí. Levantas la vista, dices su nombre, ya está | ⚠️ Requiere abrir Telegram + escribir |
| **Conocimiento vivo** | Aprende y se actualiza. Tu vida evoluciona, él también | ✅ Implementado |

**Regla de priorización:** antes de añadir una nueva integración de lectura, pregunta si resuelve uno de estos 5 gaps. Si no, espera.

**Coste objetivo:** $0/mes en infraestructura digital. Hardware robótico incremental a largo plazo.

---

## Estado actual — MVP en producción

| Componente | Estado |
|---|---|
| Backend Express + TypeScript | ✅ |
| MongoDB Atlas (memoria cloud) | ✅ |
| LLM híbrido Ollama local + Groq fallback | ✅ |
| Morning Briefing con voz (AlvaroNeural) | ✅ |
| Tool GitHub — repos, commits, PRs, issues | ✅ |
| Tool Weather — Open-Meteo, geocoding dinámico por ciudad actual | ✅ |
| Tool News — RSS (El País, Hacker News) | ✅ |
| Tool TTS — msedge-tts, voz neural española | ✅ |
| Telegram Bot — voz, comandos, texto libre | ✅ |
| Desplegado en Render (24/7, gratis) | ✅ |
| Perfil personal cargado en contexto | ✅ |
| Google Calendar — agenda en briefing y `/agenda` | ✅ |
| Notion — tareas y proyectos, `/tareas` actualizado | ✅ |
| Selector de privacidad — `/privado` + detección automática | ✅ |
| Cloudflare D1 — Tracker diario + Blog comments | ✅ |
| Memoria dinámica — MongoDB Memory collection | ✅ |
| Memoria Atlas — sustituida por colecciones estructuradas People/Projects/Knowledge (junio 2026) | ✅ |
| Carga adaptativa por tiers — social(20)→proyectos(5)→personal(3)→técnico garantizados | ✅ |
| Ejecución — crear tareas Notion + eventos Calendar | ✅ |
| Proactividad — cron briefing 05:45, alertas 08:30, resumen semanal viernes | ✅ |
| Tracker Personal — siempre en contexto ambiental (sin keywords) | ✅ |
| Historial de sesión — BAKO recuerda la conversación actual (30 min) | ✅ |
| Ubicación: Inetum L-V 7-15h / Errentería resto / override manual "estoy en X" | ✅ |
| Personalidad configurable — 10 parámetros (+ ironía) + 3 presets + estado de ánimo dinámico | ✅ |
| Conocimiento profundo — 101 memorias en Atlas (10/10 XMLs + conocimiento personal) | ✅ |
| Selector de voz TTS — 6 voces ES/MX/AR via `/voz` | ✅ |
| Perfil dinámico — `ProfileOverride` MongoDB, `/perfil`, detección NL de cambios | ✅ |
| Tracker escritura NL — marcar actividades por voz ("completé el Kronoshin") | ✅ |
| Remap intenciones — tareas→Tracker, eventos→Calendar, proyectos→Notion | ✅ |
| Motor de reglas configurables — `/regla [condición]` evaluada por LLM cada 08:30 | ✅ |
| GitHub issues escritura — "crea un issue en diamadmin" | ✅ |
| Recordatorios internos — "recuérdame en 30 min..." + `/recordatorios` | ✅ |
| PWA cliente web — `/bako-client`, instalable en móvil y PC | ✅ |
| PWA v3 — chat history con burbujas, input texto, revisión transcripción, modo claro/oscuro | ✅ |
| Script Python PC — `bako-desktop/bako_desktop.py`, hotkey Ctrl+Alt+B | ✅ |
| Script Python v3 — GUI tkinter con chat, burbujas, modo claro/oscuro, revisión transcripción | ✅ |
| Endpoints desktop — `/api/desktop/voice`, `/api/desktop/text`, `/api/desktop/transcribe` | ✅ |
| Gmail inteligente — `/email`, leer sin leer, redactar + enviar con confirmación botones inline | ✅ |
| Gmail proactivo — scopes gmail.send + drafts.send, confirmación antes de enviar | ✅ |
| Tech Radar semanal — lunes 09:30, feeds JS/Node/React/AI, LLM filtra top 5 · `/techradar` | ✅ |
| PR Review automático — L-V 08:30, diff GitHub por LLM como senior dev · `/prreview` | ✅ |
| Gestión mensajes automáticos — `/automaticos`, toggle inline por cada cron, persiste MongoDB | ✅ |
| Calendar datos en tiempo real — distinción pasados/futuros, cache 1min, no extrae eventos a memoria | ✅ |
| PWA v4 — mic inline en text-row, interrupción de BAKO (AbortController), 63 presets en 11 categorías | ✅ |
| Auth JWT — login persistente 30d, roles superadmin/user, panel admin gestión de usuarios | ✅ |
| Memoria por tiers — social(20)→proyectos(5)→personal(3)→técnico garantizados, char budget anti-413 | ✅ |
| Weather mejorado — caché 10 min, Errentería→Donostia para mejor cobertura de datos | ✅ |
| Gmail en PWA/Desktop — emails reales en contexto, instrucción anti-alucinación | ✅ |
| Temperatura LLM 0.4 + max_tokens 400 — respuestas precisas y concisas, sin divagar | ✅ |
| Desktop v4 — sincronizado con PWA: auth JWT, interrupt, presets, panel admin | ✅ |
| Icono stop SVG rojo en mic — feedback visual claro al interrumpir BAKO | ✅ |
| Fase 7 — panel admin Memorias: listar, buscar, filtrar, editar, crear, eliminar (Atlas directo) | ✅ |
| "No le entiendo, señor" — respuesta cuando el mensaje es ininteligible o sin sentido | ✅ |
| **Fase 7b-A completa** — People + Projects + KnowledgeEntry en MongoDB, API REST, panel admin | ✅ |
| Respuestas naturales — formatPersonForContext/Project/Knowledge en prosa, no listas estructuradas | ✅ |
| Migración People desde profile.ts — Yaimy y familia sin LLM (profile.ts es autoritativo) | ✅ |
| Migración Projects desde profile.ts — 9 proyectos incl. Operación Galego con detalle completo | ✅ |
| Migración Knowledge desde profile.ts — 19 entradas (salud, valores, finanzas, rutina, historia…) | ✅ |
| Limpieza memorias manuales — endpoint + botón admin, elimina source=manual de Memory collection | ✅ |
| System prompt optimizado — eliminado BAKO_PROFILE JSON redundante, budget proyectos 3000 chars | ✅ |
| PWA — limpiar chat clicando en BAKO (con confirmación), sin subtítulo "MAYORDOMO PERSONAL" | ✅ |
| Panel admin v2 — 5 columnas desktop, navbar z-index, mobile wrap, textareas, texto seleccionable | ✅ |
| Badge LLM en navbar — Ollama (teal) o Groq (amarillo), refresco cada 60s | ✅ |
| Desktop optimizado — llama3.2:3b, prompt compacto para Ollama (sin Knowledge, budget reducido), num_ctx 2048, timeout 45s | ✅ |
| Embeddings semánticos — nomic-embed-text (Ollama) + bge-small-en-v1.5 (Cloudflare Workers AI fallback), cosine similarity en Node.js | ✅ |
| **Sesión 10/06/2026** | |
| Groq model: `llama-3.3-70b-versatile` (12K TPM) — `gemma2-9b-it` decommissioned por Groq | ✅ |
| OpenRouter fallback chain v2 — 5 modelos en orden: `gemma-4-31b → nemotron-3-super-120b → kimi-k2.6 → gemma-4-26b → nemotron-3-ultra-550b`; skip en 404/unavailable, re-throw 429 al cliente | ✅ |
| REVIEW_TIMEOUT 10s — aumentado desde 5s en PWA y Desktop (más margen para revisar la transcripción) | ✅ |
| Geolocalización por IP (`ip-api.com`, caché 30 min) — BAKO conoce la ciudad actual; tiempo y previsión adaptados a la ubicación real del usuario | ✅ |
| **Sesión 07/06/2026** | |
| Fix crítico "Sin conexión" — `llmMode` con `let` dentro de IIFE `initAuth` causaba ReferenceError; `sendMessage` en scope exterior nunca ejecutaba el fetch | ✅ |
| Contexto BAKO mejorado — sort People/Projects por `orden` (manual), budgets calibrados (compact: people=5k/projects=6k/knowledge=4k · full: 6k/6k/5.5k), secciones reordenadas: Proyectos→Personas→Conocimiento→Memorias | ✅ |
| Groq por defecto en PWA/Desktop — llama3.2:3b sufre "lost-in-the-middle"; Groq siempre salvo badge Ollama✦ forzado | ✅ |
| **Fase 7c — Rate limits Groq** | |
| Routing por complejidad — clasificador regex determinista (0ms, sin LLM): saludos/tiempo/hora → Ollama minimal; todo lo demás → Groq completo | ✅ |
| Prompt minimal para Ollama (~5854 chars) — solo identidad + contexto ambiental, sin People/Projects/Knowledge (Ollama via Cloudflare tunnel timeout con 17k chars) | ✅ |
| Multi-provider fallback — Groq 429 → OpenRouter automático (google/gemma-4-31b-it:free); OPENROUTER_MODEL env var para cambiar modelo sin código | ✅ |
| Cadena completa Ollama→Groq→OpenRouter — fallback en ambas rutas (badge auto y badge Ollama forzado) | ✅ |
| Error handling graceful — si OpenRouter también falla: re-throw 429 original (cliente ve "Rate limit" en vez de 500 rojo) | ✅ |
| **Sesión 06/06/2026** | |
| Notificaciones por cliente — `?since=` timestamp, sin race condition WPA/Desktop | ✅ |
| TTS en WPA — BAKO habla al llegar notificaciones; botón 🔊 en cada burbuja | ✅ |
| Briefing en español — noticias traducidas/resumidas por LLM (Claude/Groq) | ✅ |
| Noticias actualidad española — El Confidencial, 20minutos, La Vanguardia en feeds | ✅ |
| Notion Issues — "Tareas" renombrada a "Issues"; proyectos Pausado/Activo en briefing | ✅ |
| Notion siguiente_acción — briefing menciona el siguiente paso de cada proyecto activo | ✅ |
| Issues en GitHub — 20 issues creados: 6 BAKO, 8 Diamadmin, 6 Unyona (token PAT clásico) | ✅ |
| **Web Push móvil** — `sw.js` + PushSubscription MongoDB + `/api/push` · notificaciones nativas aunque la WPA esté cerrada | ✅ |
| **Issue sync Notion+GitHub** — "crea issue X en Y" / "cierra issue X" sincroniza automáticamente en ambos | ✅ |
| Briefing: fuente de verdad Notion — issues GitHub eliminados del briefing (Notion es canonical) | ✅ |
| "Siguiente acción" actualizable por voz — "Bako, actualiza siguiente paso de X a Y" · `updateNotionProjectSiguienteAccion` | ✅ |
| Briefing: issues agrupados por proyecto — `BAKO (3): Slash commands [Alta] · Unyona (2): Chat WebSocket` | ✅ |
| Pull-to-refresh WPA — swipe down (60px) refresca notificaciones · botón ✕ por burbuja borra mensajes | ✅ |
| Voz en notificación móvil — SW `notificationclick` → `postMessage({type:'PLAY_VOICE'})` → TTS (bypass autoplay restriction) | ✅ |
| Fix proyectos en contexto — `activo: { $ne: false }` incluye proyectos sin campo explícito (Unyona resuelto) | ✅ |
| **Weather semántica temporal** — 5 ramas: pasado (sin datos históricos) / ahora mismo / mañana / esta semana / default (presente + hoy + mañana) | ✅ |
| Weather regex ampliada — `lloverá`, `nevará`, `está lloviendo`, `llueve`, `lluvia esta tarde`, `pronóstico del tiempo`, `tiempo mañana` | ✅ |

---

> **Documentación técnica:**
> - Instalación y configuración: [SETUP.md](SETUP.md)
> - Clientes (Telegram, PWA, Desktop): [CLIENTS.md](CLIENTS.md)
> - Base de conocimiento y XMLs: [KNOWLEDGE.md](KNOWLEDGE.md)

---

## HORIZONTE 0 — Convertir BAKO en mayordomo real
### Los 5 gaps críticos. Objetivo: ~1-3 meses.

Estas son las mejoras que más impacto tienen en la experiencia. Sin ellas BAKO es un chatbot avanzado pero no un mayordomo.

```
MEMORIA ──► EJECUCIÓN ──► PROACTIVIDAD
   ▲                            │
   └──── CONOCIMIENTO VIVO ◄───┘
                    ▲
              ACCESO SIN FRICCIÓN (mejora continua)
```

### Gap 1 — Memoria persistente y dinámica 🧠 ✅ Verificado

- ✅ Colección `Memory` en MongoDB (schema: tipo, importancia, fuente, tags)
- ✅ Extracción automática de hechos tras cada conversación (async, no bloquea)
- ✅ **Carga por tiers** — social(20)→proyectos(5)→personal(3)→técnico(2) garantizados, charBudget 1800 chars
- ✅ Endpoint `DELETE /api/agent/memories/:id` para gestión desde Claude Code
- ✅ Comandos naturales: "Bako, recuerda que..." / "Bako, olvida..." / `/memorias [tema]`
- ✅ Privacidad respetada: sin extracción en mensajes sensibles o `/privado`
- ✅ **Memory collection saneada** — eliminadas memorias `source: 'manual'` (junio 2026)
  - People/Projects/KnowledgeEntry cubren todo el conocimiento estructurado
  - Memory solo contiene hechos dinámicos extraídos de conversaciones (`source: 'extracted'`)

### Gap 2 — Ejecución de acciones ⚡ ✅ Verificado
BAKO lee pero no actúa. Necesita poder ejecutar órdenes.

- ✅ **Notion**: crear tareas, cambiar estado, asignar fecha límite
- ✅ **Google Calendar**: crear eventos con hora, descripción, ubicación
- ✅ **GitHub + Notion sync**: "crea un issue X en Diamadmin" → crea en GitHub Y en Notion simultáneamente · "cierra issue X" → cierra en ambos
- ✅ **Tracker Personal**: marcar actividades por voz/texto ("completé el Kronoshin", "no pude ir a BIZIKI porque llovía")
- ✅ **Recordatorios**: "recuérdame en X minutos/horas [qué]" — setTimeout + voz al disparar · `/recordatorios` · `/cancelarrecordatorio [id]`
- ⚠️ Confirmación antes de ejecutar acciones irreversibles (confía en el LLM para interpretar intención)

### Gap 3 — Proactividad y alertas 📡 ✅ Verificado
BAKO solo habla cuando le hablas. Necesita iniciativa propia.

- ✅ Briefing automático a las 05:45 (L-V, cron en Render)
- ✅ Resumen semanal automático los viernes a las 18:00
- ✅ Alerta Tracker vacío a las 22:00 (L-V)
- ✅ Alertas inteligentes a las 08:30 (L-V):
  - "Llevas X días sin commits en Diamadmin — ¿bloqueado?"
  - "Tienes N PRs sin actividad desde hace 2+ días"
  - "Mañana tienes reunión a las 9 — ¿quieres el briefing antes?"
- ✅ Motor de reglas configurables: `/regla [condición]` · `/reglas` · `/borrarregla [id]` — evaluadas por LLM cada día a las 08:30

### Gap 4 — Acceso sin fricción 🎤 ✅ Verificado
Reducir al mínimo los pasos para hablar con BAKO.

- ✅ Todo en lenguaje natural — sin necesidad de comandos `/comando`
- ✅ Detección de intención y remap semántico:
  - "tareas de hoy" / "mi horario" / "actividades" → **Tracker** (datos reales Cloudflare D1)
  - "eventos" / "reuniones" / "citas" → **Google Calendar** (datos reales)
  - "proyectos de Notion" / "tareas de diamadmin" → **Notion** (datos reales)
  - "cómo está el tiempo" → **Weather API** · "dame un briefing" → **Briefing Agent**
  - Ubicación, correcciones, modo LLM, personalidad, memoria: detección automática
- ✅ **Personalidad configurable** — 10 parámetros (0-10):
  - `sinceridad` · `sarcasmo` · `ironía` · `simpatía` · `empatía` · `discreción` · `lealtad` · `precisión` · `detallista` · `anticipación`
  - Presets: `mayordomo clásico` (default, sarcasmo=8 ironía=8) / `colega directo` / `modo Jarvis`
  - `/personalidad` · `/personalidad [preset]` · lenguaje natural: "modo Jarvis"
- ✅ **Estado de ánimo dinámico** — detectado del tono del mensaje, 6 estados:
  - `neutro` · `juguetón` · `directo` · `empático` · `impaciente` · `reflexivo`
  - Inyectado en el system prompt — BAKO adapta el tono automáticamente
  - `/animo [estado]` para cambio manual
- ✅ **Selector de voz** — 6 voces TTS disponibles vía `/voz [nombre]`:
  - `alvaro` (ES, actual) · `elvira` (ES) · `jorge` (MX) · `dalia` (MX) · `tomas` (AR) · `elena` (AR)
- ✅ Correcciones fonéticas Whisper: Paco→BAKO, Josiel→Yosiel, vocabulario de personas añadido
- ✅ Sin asteriscos en voz (`cleanForVoice` elimina todo markdown antes del TTS)
- ✅ System prompt reordenado: personalidad y estado de ánimo van PRIMERO
- ✅ Respuestas en menos de 2 segundos (Ollama local: ~1s · Groq: ~2-3s)
- ✅ Wake word PWA (Chrome/Edge PC) — botón 👂, detecta "bako", modo conversación auto (09/06/2026)
- ⚠️ Wake word Desktop — opt-in `BAKO_WAKE_WORD=1`, sigue en push-to-talk tras activación (VAD pendiente)

### Gap 5 — Conocimiento vivo 📚 ✅ Verificado
El perfil deja de ser un archivo que editas a mano.

- ✅ `ProfileOverride` en MongoDB — campos clave del perfil actualizables sin tocar código
- ✅ `buildDynamicProfileContext()` — fusiona perfil base con overrides, inyectado en cada system prompt con prioridad sobre el JSON estático
- ✅ **profile.ts actualizado**: sección `pareja` (Yaimy), LAE corregido, ubicación laboral correcta (03/06/2026)
- ✅ Lenguaje natural: "ya no trabajo en Inetum", "me he mudado a Galicia" → actualiza el perfil automáticamente
- ✅ Comando `/perfil` — ver todos los campos con su valor actual y fecha de actualización
- ✅ Comando `/perfil [campo] [valor]` — actualizar cualquier campo manualmente
- ✅ Historial de cambios: `prevValue` almacenado en cada override
- ✅ Alerta proactiva lunes 09:00 — avisa si algún campo lleva 90+ días sin actualizarse
- ⚠️ Campos actualizables en v1: edad, ubicación, empleador, situación laboral, oficina. Proyectos y rutina siguen en `profile.ts` (v2 con panel admin)

---

---

## HORIZONTE 1 — BAKO completo como asistente
### Objetivo: BAKO gestiona toda tu vida digital. ~6-12 meses.

### Fase 5 — Email inteligente ✅ Completado (junio 2026)
- ✅ Gmail API — `getUnreadEmails`, `/email` lista correos sin leer por voz y texto
- ✅ Redactar email por voz/texto: "Bako, redacta un email a X sobre Y"
- ✅ Preview del email + botones inline [✅ Enviar] [📁 Borrador] [❌ Cancelar]
- ✅ Envío directo via `drafts.send` — nunca envía sin confirmación explícita
- ✅ Gmail en briefing matutino 05:45 — menciona correos sin leer
- ✅ Scopes: gmail.readonly + gmail.compose + gmail.modify + gmail.send
- ✅ Re-auth con nuevos scopes documentada en auth-google.ts

### Fase 6 — Redes Sociales ❌ Pendiente
- Twitter/X + LinkedIn API (requieren plan de pago — diferido)
- Cola de posts en MongoDB → BAKO genera y publica con confirmación
- Modo automático: calendario editorial definido por ti

### Fase 7 — Panel de administración BAKO ✅ Completado (junio 2026)
Panel integrado en la PWA (no en bohdeveloper.com).

- ✅ Auth JWT — login, roles superadmin/user, gestión de usuarios (crear, editar, activar/desactivar, eliminar)
- ✅ Pestaña 🧠 Memorias — listar 104+ memorias con badges de tier y importancia
- ✅ Buscar en tiempo real por contenido o tags, filtrar por tier e importancia
- ✅ Edición inline — content, importance, type, tags directamente en Atlas
- ✅ Crear nueva memoria desde el panel
- ✅ Eliminar con confirmación
- ❌ Edición de perfil ampliada — más campos que ProfileOverride (pendiente Fase 7b)
- ❌ Widget de chat público en bohdeveloper.com (diferido)

### Fase 7b — Memoria Cognitiva ✅ Completado (08/06/2026)
> Convertir la memoria plana de 103 registros en un sistema cognitivo real: estructurado, semántico y auto-actualizable. **Coste objetivo: $0.**

#### El problema actual
La colección `Memory` es una tabla plana de texto libre. BAKO no sabe que "Paula" es una persona, que tiene relación contigo, o que su cumpleaños está vinculado a "amigos vascos". Son 103 fragmentos de texto desconectados. Además, solo acumula: si dices "dejé BIZIKI", crea una memoria nueva sin tocar la antigua que dice "corro con BIZIKI", generando contradicciones.

Consecuencia directa: el sistema de tiers (social 20 + proyectos 5 + personal 3 + técnico 2 = 30 max) es un parche para meter el máximo contexto útil sin reventar el límite de tokens. Con memoria cognitiva real, 30 registros ricos valen más que 103 fragmentos planos.

#### Arquitectura objetivo (todo en servicios gratuitos existentes)

```
ENTRADAS (voz / texto / PWA / Desktop)
        │
        ▼
  MEMORIA DE TRABAJO  ←──── contexto de conversación actual (RAM, no persiste)
        │
        ▼
┌───────────────────────────────────────┐
│         MEMORIA A LARGO PLAZO         │  ← MongoDB Atlas M0 (gratis, 512MB)
│                                       │
│  [Personas]   [Proyectos]  [General]  │
│  colección    colección    colección  │
│  estructurada estructurada plana      │
│       │            │           │      │
│       └────────────┴─────── [Vectores]│  ← embeddings en arrays Float[]
└───────────────────────────────────────┘
        │
        ▼
  RECUPERACIÓN SEMÁNTICA
  (búsqueda por similitud coseno en Node.js — sin Qdrant, sin coste)
        │
        ▼
   LLM DECIDE: ¿actualizar memoria existente o crear nueva?
        │
        ▼
SALIDAS (respuesta, voz, acciones Calendar/Notion/GitHub)
```

#### Fase A — Colecciones estructuradas (MongoDB M0, coste: $0)

Nuevas colecciones en Atlas paralelas a `Memory`. No migración forzada: conviven.

**`People` — personas en la vida de Borja:**
```json
{
  "nombre": "Paula",
  "relacion": "amiga de infancia",
  "cumpleaños": "15-08",
  "ubicacion": "Madrid",
  "trabajo": "diseño gráfico",
  "notas": ["conocidas desde el colegio", "quedamos cuando viene al norte"],
  "conexiones": ["Ibon", "Julen"],
  "ultima_actualizacion": "2026-06-04"
}
```
Beneficio: una pregunta sobre Paula = una consulta directa a un registro, sin consumir tiers ni tokens en 20 memorias planas.

**`Projects` — estado vivo de cada proyecto:**
```json
{
  "nombre": "BAKO",
  "estado": "producción",
  "siguiente_accion": "Fase 7b memoria cognitiva",
  "bloqueantes": [],
  "decisiones_clave": ["usar Groq en cloud", "MongoDB Atlas M0"],
  "ultima_sesion": "2026-06-05"
}
```

**`Memory` (actual)** — conserva los hechos que no encajan en schema (observaciones, estados emocionales, eventos únicos). Se reduce drásticamente a medida que la info migra a colecciones estructuradas.

#### Fase B — Búsqueda semántica (embeddings locales, coste: $0)

Para que BAKO encuentre la memoria *correcta* ante "dejé BIZIKI" en lugar de buscar por keywords:

- **Ollama local** genera embeddings de cada memoria al guardarla (`nomic-embed-text`, 768 dimensiones, 80MB modelo)
- El vector se guarda como campo `embedding: Float[]` en MongoDB
- Cuando llega un mensaje, se genera su embedding y se calcula **similitud coseno** en Node.js contra las memorias del tier relevante
- Sin Qdrant, sin infraestructura adicional, sin coste — el cálculo es O(n) sobre 30-100 vectores, ~1ms
- Cuando el PC está apagado y Ollama no disponible → **Cloudflare Workers AI** tiene embeddings gratuitos (100k inferencias/día) como fallback

#### Fase C — Modificación activa de memoria (coste: tokens Groq mínimos)

El flujo que convierte a BAKO en un mayordomo que aprende y corrige:

```
1. Usuario dice: "Ya no voy a BIZIKI, lo dejé por la rodilla"

2. extractAndSaveMemories() extrae: {content: "dejó BIZIKI por lesión de rodilla", tags: ["entrenamiento","biziki"]}

3. NUEVO — antes de guardar, búsqueda semántica:
   → encuentra: "Borja corre con grupo BIZIKI lunes y viernes" (similitud 0.91)

4. LLM decide (prompt pequeño, ~50 tokens):
   → "¿Es una actualización de la memoria existente o un hecho nuevo?"
   → Respuesta: ACTUALIZAR

5. Se modifica la memoria existente:
   → "Borja dejó BIZIKI en junio 2026 por lesión de rodilla"
   → Se añade nota: "anteriormente corría L/V con el grupo"

6. No se crea duplicado. Memoria coherente.
```

Para evitar modificaciones erróneas:
- Similitud mínima de 0.85 para considerar candidata a actualización
- El LLM solo puede actualizar (no borrar) sin confirmación explícita
- Las memorias `source: 'manual'` (importadas desde XMLs) son **intocables** — solo lectura

#### Impacto sobre los tiers y los límites

| Situación actual | Con memoria cognitiva |
|---|---|
| 20 memorias sociales (textos planos) | 10-15 registros `People` (estructurados, ricos) |
| 5 memorias de proyectos | 3-5 registros `Projects` (estado completo) |
| 8 memorias personales | 5 registros generales relevantes por similitud |
| **33 registros, ~1800 chars** | **~20 registros, ~800 chars, más información** |

El sistema de tiers desaparece o se simplifica enormemente: en lugar de cargar los 20 más importantes por importancia/fecha (heurístico), se recuperan los más *relevantes semánticamente* para la pregunta concreta.

#### Stack técnico (todo gratuito)
| Componente | Solución | Coste |
|---|---|---|
| Colecciones estructuradas | MongoDB Atlas M0 (ya existe) | $0 |
| Embeddings (PC encendido) | Ollama `nomic-embed-text` | $0 |
| Embeddings (PC apagado) | Cloudflare Workers AI | $0 (100k/día) |
| Búsqueda semántica | Node.js cosine similarity | $0 |
| Decisión actualizar/crear | Groq Llama (prompt ~50 tokens) | $0 (cuota existente) |
| Almacenamiento vectores | Campo Float[] en MongoDB | $0 |
| Panel de gestión | PWA + Desktop admin (ya existe) | $0 |

#### Estado de implementación

**Fase 7b-A — Colecciones estructuradas ✅ Completado (junio 2026)**

- ✅ Colección `People` (MongoDB) — nombre, relación, cumpleaños, ubicación, trabajo, notas, conexiones, orden
- ✅ Colección `Projects` (MongoDB) — nombre, slug, tipo, estado, prioridad, descripcion, siguiente_acción, stack, urls, horizonte, notas, orden
- ✅ Colección `KnowledgeEntry` (MongoDB) — categoría, clave, valor, detalles, importancia (nueva, junio 2026)
- ✅ API REST completa — CRUD personas (`/api/people`), proyectos (`/api/projects`), conocimiento (`/api/knowledge`)
- ✅ Panel admin PWA + Desktop — pestañas Personas, Proyectos y Conocimiento (5 columnas en desktop)
  - Panel a pantalla completa, monocromático con acentos teal (`#14b8a6`)
  - Drag & drop reordering — grip handle, `PATCH /api/people/reorder` y `/projects/reorder`
- ✅ **Formato natural en system prompt** — `formatPersonForContext`, `formatProjectForContext`, `formatKnowledgeForContext` generan prosa legible, no listas `key: valor`
- ✅ **Deduplicación algorítmica** — `POST /api/agent/deduplicate-memories` sin LLM
  - Pass 1: prefijos comunes (100 chars), Pass 2: patrones junk, Pass 3: word overlap >88%
- ✅ **Migración completa desde profile.ts** — `POST /api/agent/migrate-memories`
  - Personas: Yaimy, familia directa, familia política, amigos — datos autoritativos sin LLM
  - Proyectos: 9 proyectos incl. Operación Galego (fases, zonas candidatas, agencias, siguiente acción)
  - Conocimiento: 19 entradas — salud, valores, carácter, finanzas, historia, rutina, objetivos, legal, hobbies
- ✅ **Limpieza memorias manuales** — `POST /api/agent/clean-manual-memories` + botón admin (rojo, con confirm)
  - Elimina todos los docs `Memory` con `source: 'manual'` (datos ya cubiertos por colecciones estructuradas)
  - Conserva intactas las memorias `source: 'extracted'` (hechos extraídos de conversaciones)
- ✅ **System prompt optimizado** — eliminado bloque `BAKO_PROFILE JSON` (~3000 chars redundantes)
  - Solo queda 1 línea de identidad; People/Projects/Knowledge cubren todo lo demás
  - `getProjectsSection()` con charBudget=3000 chars; notas limitadas a 4 por proyecto

**Fase 7b-B — Embeddings semánticos ✅ Completado (junio 2026)**
- ✅ Ollama `nomic-embed-text` (768 dims) al guardar cada memoria — background, no bloquea respuesta
- ✅ Fallback: Cloudflare Workers AI `bge-small-en-v1.5` (384 dims, 100k/día)
- ✅ Campo `embedding: Float[]` + `embeddingDim` + `embeddingModel` en MongoDB `Memory`
- ✅ `searchMemories()` usa similitud coseno en Node.js — fallback keyword si <3 candidatos
- ✅ Endpoint `POST /api/agent/embed-memories` — backfill memorias existentes sin embedding
- ✅ Botón "Generar embeddings" en panel admin

**Fase 7b-C — Búsqueda semántica ✅ Completado (08/06/2026)**
- `getMemories(query?)` — si hay query: cosine similarity contra embeddings MongoDB, top-15 relevantes
- Fallback automático a tiers si embedding falla o <5 candidatos relevantes
- Callers: Telegram (x5) + Desktop pasan mensaje del usuario como query

**Fase 7b-D — Modificación activa ✅ Completado (08/06/2026)**
- `deduplicateAndSave()` — antes de crear memoria: busca similares (≥0.85), excluye `source: 'manual'`
- LLM decide ACTUALIZAR o CREAR con prompt mínimo (~10 tokens de respuesta)
- "Ya no voy a BIZIKI" → actualiza memoria existente de BIZIKI en lugar de duplicar

### Fase 7c — Eliminar rate limits Groq ✅ Completado (07/06/2026)
> Groq free tier: ~6.000 tokens/min (TPM). Cada query compleja consume ~4.500 tokens → 1 req/min antes de 429.

**Paso 1 — Routing por complejidad ✅** (regex, 0ms, sin Ollama)
- `classifyQueryComplexity()` en `claude.ts` — determinista, sin LLM, sin latencia
- Simple (saludos puros, tiempo/clima, hora/fecha) → `getMinimalSystemPrompt()` → Ollama (~5854 chars)
- Complex (todo lo demás) → `getFullSystemPrompt()` → Groq (~18033 chars completo)
- Nota: el clasificador LLM (llama3.2:3b) fue descartado — clasificaba "Diamadmin", "BIZIKI", "mi rutina" como simple
- Nota: Ollama via Cloudflare tunnel timeout con 17k chars (sin GPU, modelo 3B en CPU); el prompt minimal sí cabe en 10s

**Paso 2 — Multi-provider fallback ✅** (Groq → OpenRouter → re-throw)
- `askOpenRouter()` en `claude.ts`, API compatible OpenAI, default `google/gemma-4-31b-it:free`
- Cadena completa en AMBAS rutas: `Ollama→Groq→OpenRouter` y `Groq directo→OpenRouter`
- Si OpenRouter también falla: re-throw 429 original (cliente ve "Rate limit" limpio, no 500)
- `OPENROUTER_API_KEY` en Render · `OPENROUTER_MODEL` env var para cambiar modelo sin tocar código
- ⚠️ Modelos gratuitos de OpenRouter cambian frecuentemente — consultar `/api/v1/models` si 404

**Paso 3 — Prompt siempre compact + captura 413 ✅** (08/06/2026)
- `getFullSystemPrompt(compact=true)` en los 3 endpoints desktop (`/text`, `/voice`, `/stream`) — full (18104 chars ≈ 6023 tokens) siempre supera el límite de 6000 TPM de Groq → siempre 413
- `isGroqRateLimit()` captura también **413** (request too large) además de 429 — ahora el fallback OpenRouter salta en ambos casos
- Flujo unificado: Ollama disponible → Ollama · Ollama caído → Groq (compact) → si 429/413 → OpenRouter

**Paso 4 — Cache respuestas frecuentes** ❌ Pendiente/Opcional
- Preguntas recurrentes (briefing, agenda) → cache 5 min en MongoDB
- ~20% reducción adicional de tokens Groq — solo implementar si siguen apareciendo 429s en uso normal

**Sesión 08/06/2026 (parte 2) — Memoria cognitiva completa + Wake Word PWA**
- **7b-C**: `getMemories(query?)` — cosine similarity contra embeddings MongoDB, top-15 relevantes; fallback a tiers si falla
- **7b-D**: `deduplicateAndSave()` — similitud ≥0.85 → LLM decide ACTUALIZAR o CREAR; `source:manual` intocables
- **Fase 9 PWA**: botón 👂 en header → `SpeechRecognition` continua (Chrome/Edge), detecta "bako" + variantes, toggle persistido en localStorage

**Sesión 08/06/2026 (parte 1) — Tracker: datos en tiempo real + respuesta explícita del estado**
- `executeQueryTracker()` — extrae actividad consultada (LLM), consulta D1 directamente (sin caché), responde: "completada" / "no completada: [motivo]" / "pendiente"
- `IS_QUESTION` regex — separa consultas (¿?) de acciones de marcado para evitar falsos positivos
- `executeMarkTracker` — responde "completada" o "marcada como no completada" en lugar del genérico "registrada" (el emoji solo no era suficiente para voz)
- `invalidateTrackerCache()` en `context.ts` — exportada y llamada en Desktop (`getFullSystemPrompt`/`getMinimalSystemPrompt`) y Telegram cuando el mensaje menciona tracker/kronoshin/etc. — BAKO siempre consulta D1 en tiempo real para respuestas sobre el tracker

### Fase 8 — Automatización (sin n8n) ✅ Completado (junio 2026)
Implementado directamente en ProactivityService sin infraestructura adicional:
- ✅ **Tech Radar semanal** (lunes 09:30) — 5 feeds tech (JS Weekly, Node, React, HN, TLDR AI) → LLM filtra top 5 relevantes para el stack de Borja · `/techradar` manual
- ✅ **PR Review automático** (L-V 08:30) — PRs actualizados en 24h → diff GitHub → análisis LLM como senior dev · `/prreview` manual
- ✅ Morning Briefing (05:45), Weekly Summary (viernes 18:00), Alerta Tracker (22:00)
- ✅ **Gestión mensajes automáticos** — `/automaticos` con botones inline, 7 crons configurables, estado persiste en MongoDB (`AutoConfig`)

### Fase 9 — Wake Word + Modo Conversación ✅ Completado (08-09/06/2026)

**Desktop (Python):** OpenWakeWord opt-in (`BAKO_WAKE_WORD=1`)
- Hilo daemon en Python, escucha en background sin bloquear el GUI tkinter
- Modelo `hey_jarvis` como placeholder fonético (similar a "bako" en español)
- Umbral configurable via `BAKO_WAKE_THRESHOLD` · Modelo intercambiable via `BAKO_WAKE_MODEL`
- Prerequisito: `pip install openwakeword` · Custom model: ~30 grabaciones de "Bako" → ONNX
- ⚠️ Tras wake word sigue en push-to-talk (sin VAD) — modo conversación pendiente para Desktop

**PWA (JavaScript):** Web Speech API opt-in (botón 👂 en el header)
- Wake word: `SpeechRecognition(continuous:true)` en Chrome/Edge — detecta "bako" y variantes fonéticas
- **Modo conversación (09/06/2026):** tras el wake word entra en `SpeechRecognition(continuous:false)`
  - El browser detecta el fin de frase automáticamente (VAD nativa del SO)
  - Transcripción enviada directa a BAKO sin review panel (bypass intencional en conversación)
  - Tras respuesta de BAKO, `resumeWakeWord` reanuda la escucha → conversación continua
  - Timeout 20s sin hablar → sale de conversación y vuelve a escuchar "bako"
- **Móvil desactivado (09/06/2026):** `SpeechRecognition(continuous:true)` genera clics constantes de micro en Chrome móvil → detección UA + `wakeBtn.style.display='none'`
- Toggle persistido en `localStorage` · Pulso visual verde cuando activo
- Limitación inherente del navegador: requiere tab en primer plano

**Sesión 09/06/2026 — Fix conversación PWA**
- Problema: wake word llamaba `startRecording()` (MediaRecorder push-to-talk) → grabación infinita en PC; en móvil el reconocedor continuo generaba clics constantes
- Solución: modo conversación con `SpeechRecognition(continuous:false)` post-wake-word + detección mobile
- ⏳ Pendiente Desktop: añadir VAD por amplitud en `_record_loop` (Python) para auto-stop tras silencio
- ⏳ **Pendiente Móvil — Wake word sin clics (WebAudio VAD):**
  - Limitación actual: `SpeechRecognition(continuous:true)` genera clic de OS en cada restart (~5s) → desactivado
  - Pantalla bloqueada: imposible en PWA (JS congelado por el OS — requeriría app nativa)
  - Pantalla encendida: solución viable con WebAudio amplitude detection
    1. `getUserMedia` abre el micro una vez (un solo clic de activación)
    2. `AudioContext + AnalyserNode` monitoriza volumen en silencio (sin SpeechRecognition, sin clics)
    3. Al superar umbral de amplitud → lanza `SpeechRecognition` una sola vez para capturar la frase
    4. Si detecta "bako" → modo conversación; si no → vuelve a escuchar volumen
  - Trade-off: detecta cualquier sonido alto (falsos positivos en entornos ruidosos); detección exacta de "bako" requeriría modelo ONNX en JS (TensorFlow.js + openwakeword, alta complejidad)

---

## Ruta de Aprendizaje IA/ML
### Prerequisito para HORIZONTE 2+. Punto de partida: IA/ML nivel cero. Base fullstack sólida.

| Fase | Contenido | Duración | Recursos clave |
|---|---|---|---|
| **A — Fundamentos** | Álgebra lineal, cálculo, probabilidad + Python científico (NumPy, Pandas, Matplotlib) | Meses 1-3 | 3Blue1Brown (YouTube), Andrew Ng ML Coursera (audit gratis), StatQuest, Kaggle micro-courses |
| **B — ML clásico + NN básicas** | scikit-learn, regresión/clasificación, primera red Keras en MNIST | Meses 3-6 | Andrew Ng ML Specialization, Hands-On ML with Scikit-Learn book (caps. 1-4) |
| **C — Deep Learning + NLP** | CNN, Transformers, fine-tune BERT, chatbot intent-based corriendo en Pi | Meses 6-18 | FastAI (top-down), Hugging Face NLP Course (gratuito), Stanford CS224N (vídeos) |
| **D — Visión + Robótica** | OpenCV, YOLOv8, SLAM, ROS2, sim-to-real con Gazebo | Meses 18-48 | Ultralytics docs, Stanford CS231N, ROS2 docs oficiales |

**Hitos concretos:**
- Mes 6: modelo ML clásico entrenado + primera red neuronal funcionando (MNIST)
- Mes 14: chatbot conversacional corriendo en Raspberry Pi — MVP1 IA local
- Mes 24: detector YOLOv8 custom + reconocimiento facial en tiempo real en Pi
- Mes 36: navegación autónoma completa sin teleoperación
- Mes 48+: sistema JARVIS-like integrado — conversación + visión + autonomía

**Presupuesto aprendizaje:** 0-150€ (GPU cloud: Google Colab Pro o Lambda Labs para entrenamientos DL pesados)

---

## HORIZONTE 2 — BAKO inteligente
### Objetivo: BAKO aprende de ti y actúa sin instrucciones. ~1-2 años.

### Fase 10 — Aprendizaje de patrones
- BAKO analiza tus commits, tareas y rutinas para detectar patrones
- "Llevas 3 días sin avanzar en Diamadmin — ¿bloqueado?"
- Adapta el briefing según tu energía histórica por día de la semana

### Fase 11 — Orquestación multi-agente
Agentes especializados trabajando en paralelo. Patrón ReAct (Reason + Act) — cada agente piensa antes de actuar e itera si falla:

| Agente | Rol | Herramientas clave |
|---|---|---|
| **Dev Agent** | Analiza código, genera componentes, revisa PRs, detecta bugs, genera tests | github_read/write, code_analyzer, code_generator, file_read |
| **PM Agent** | Gestiona sprints de Diamadmin y Unyona, prioriza tareas, detecta deuda técnica | github_read, notion_read/write, code_analyzer |
| **Research Agent** | Investiga tecnologías, compara librerías, sintetiza docs y papers | web_search, web_fetch, scraper, rss_reader, doc_summarizer |
| **Learning Agent** | Tutor personal de IA/ML, guía fases del proyecto JARVIS, genera ejercicios | web_search, web_fetch, code_analyzer, file_read |
| **Content Agent** | Genera posts para bohdeveloper, copy para landings, READMEs, SEO | web_search, file_read/write, scraper |
| **Ops Agent** | Monitoriza deployments Cloudflare/Vercel, analiza logs, audita seguridad | cloudflare_api, vercel_api, web_fetch, custom_webhook |
| **Ideas Agent** | Valida ideas de micro-SaaS, analiza competencia, estima esfuerzo de features | web_search, scraper, web_fetch |

- Agente orquestador: divide tarea compleja entre sub-agentes en paralelo
- Verificador: agente que valida outputs de otros agentes antes de ejecutar
- Patrón propio (sin dependencias externas de CrewAI u otras librerías)

### Fase 12 — Fine-tuning con tus datos
- Entrenar un modelo pequeño (Llama 3.2 3B o Mistral 7B) con:
  - Tus conversaciones y preferencias
  - Tu estilo de código
  - Tu forma de comunicarte
- BAKO con personalidad real entrenada sobre ti, no solo prompts

---

## HORIZONTE 3 — IA con identidad propia
### Objetivo: BAKO es único, no un wrapper de otro modelo. ~2-3 años.

### Fase 13 — Visión computacional
- Cámara conectada → BAKO ve lo que tienes en pantalla y el entorno físico
- "BAKO, revisa este código" → captura pantalla → analiza → responde
- Reconocimiento de documentos físicos (facturas, notas manuscritas)
- Detección de objetos en tiempo real: **YOLOv8** (Ultralytics) fine-tuneado para objetos del hogar/oficina
- Reconocimiento facial y de emociones básicas: **MediaPipe** (Google) + FaceNet embeddings
- SLAM visual (ORB-SLAM2): construcción de mapa del entorno para navegación robótica
- Fusión de sensores: cámara + ultrasónico + IMU con filtro de Kalman
- *Stack:* OpenCV · YOLOv8 · MediaPipe · ROS2

### Fase 14 — BAKO en todos tus dispositivos
- App móvil nativa (React Native) → BAKO siempre en el bolsillo
- Extensión de navegador → BAKO lee páginas web por ti
- Integración con VS Code → asistente de código contextual

### Fase 15 — Casa inteligente
- Raspberry Pi como hub central en casa
- Control de luces, temperatura, música por voz
- "Bako, modo trabajo" → luces a 70%, música instrumental, DnD activo
- Alertas físicas: LED que parpadea cuando hay algo urgente

---

## HORIZONTE 4 — Presencia física (JARVIS)
### Objetivo: BAKO tiene cuerpo. ~3-5 años.

### Fase 16 — Plataforma robótica básica
- Raspberry Pi 4/5 (8GB) como cerebro central + Arduino para control de motores
- Chasis wheeled base (~500€) con encoders + controladores motor
- Prototipado CAD + impresión 3D para piezas custom (Fusion 360 / Cura)
- Movimiento básico: seguimiento de persona, navegación de habitación con control remoto
- *Hardware:* Pi 4/5 8GB (~100€) · wheeled base (~300-400€) · Arduino + sensores (~100€)

### Fase 17 — Percepción del entorno
- Cámara Pi estéreo → profundidad y detección de objetos en tiempo real
- Micrófono de campo amplio → wake word sin tocar el móvil
- Sensores: ultrasónico (distancia), IMU (orientación), LiDAR básico (opcional)
- Fusión sensores: filtro de Kalman para estimación de posición robusta
- *Hardware adicional:* cámara Pi (~25-50€) · sensores (~100-150€) · LiDAR (~150€)

### Fase 18 — Autonomía completa
- **ROS2 + nav2**: stack de navegación estándar industria — planificación de rutas, obstacle avoidance
- **Gazebo**: simulador 3D para entrenar comportamientos antes de transferir al robot real (sim-to-real)
- **Stable-Baselines3**: algoritmos RL (PPO, SAC) para aprendizaje de tareas motoras
- **Jetson Nano/Orin** (~200-500€): GPU edge para inference en tiempo real sin depender de cloud
- BAKO toma decisiones sin instrucción directa — navega, percibe, responde, aprende
- Sincronización con todos los sistemas digitales en tiempo real
- *Presupuesto fase robótica completa:* 1.500-3.000€ incremental

---

## Visión final

```
    [Dices "Bako"]
          │
          ▼
    [Wake Word / Cámara / Sensor]
          │
          ▼
    BAKO percibe el contexto
    ├── Quién eres y cómo estás hoy
    ├── Qué tienes en pantalla
    ├── Agenda y prioridades
    ├── Estado de todos tus proyectos
    ├── Emails y mensajes importantes
    └── Clima, noticias, mercados
          │
          ▼
    BAKO actúa
    ├── Responde por voz con personalidad propia
    ├── Ejecuta tareas sin que las pidas
    ├── Mueve el cuerpo robótico si es necesario
    ├── Publica, responde, gestiona en tu nombre
    └── Aprende y mejora con cada interacción
```

**No es ciencia ficción. Es arquitectura de software ejecutada con constancia.**

---

## Stack objetivo completo

| Capa | Hoy | Futuro |
|---|---|---|
| Backend | Express + TypeScript | Express + TypeScript |
| Base de datos | MongoDB Atlas | MongoDB + vector DB (Qdrant) |
| Portfolio DB | Cloudflare D1 (Tracker, Blog) | Cloudflare D1 expandido |
| LLM cloud | Groq (Llama 3.3) | Groq + modelo fine-tuneado |
| LLM local | Ollama llama3.2:3b | Llama 3.2 fine-tuneado |
| Voz salida | msedge-tts AlvaroNeural | Modelo TTS propio |
| Voz entrada | Whisper (Groq) | Whisper local |
| Wake word | — | OpenWakeWord |
| Móvil | Telegram Bot | App React Native |
| Frontend | — | Next.js dashboard |
| Visión | — | OpenCV + YOLOv8 + MediaPipe |
| Robótica | — | ROS2 + nav2 + Gazebo (sim-to-real) |
| Edge compute | — | Raspberry Pi 4/5 8GB → Jetson Nano/Orin |
| RL robótica | — | Stable-Baselines3 + OpenAI Gym |
| Automatización | ProactivityService (cron) | n8n self-hosted + webhooks |
| Cache/colas | — | Redis (Upstash) |
| Infra | Render (free) | Render + Raspberry Pi hub |

**Coste infraestructura digital: $0/mes**
**Inversión hardware robótica: ~500€ incremental en 3-5 años**

---

## Hitos personales vinculados

| Meta | Proyecto BAKO relacionado |
|---|---|
| Diamadmin en producción con usuarios | PMAgent + DevAgent + Ejecución |
| Unyona validada con leads reales | ContentAgent + IdeasAgent |
| Portfolio que consigue clientes | Fase 7 — IA pública + Blog comments |
| Aprender ML/IA en profundidad | LearningAgent guía el roadmap |
| Vivir en Galicia trabajando remoto | BAKO viaja contigo — misma experiencia en cualquier sitio |
| JARVIS físico funcional | Horizontes 3 y 4 |
