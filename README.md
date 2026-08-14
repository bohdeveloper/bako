# BAKO — Borja's Autonomous Knowledge Operator

> Un mayordomo digital personal. No un chatbot — un Alfred.
> Conoce quién eres, dónde estás, qué tienes pendiente y cómo van tus proyectos.
> Habla por voz, actúa sobre sistemas reales y toma la iniciativa. Coste: **$0/mes**.

**Estado:** MVP en producción 24/7 · Horizonte 0 cerrado · Horizonte 1 casi completo
· [plan.md](plan.md) tiene el detalle.

---

## La filosofía

Un mayordomo de verdad tiene cinco cualidades. Cada feature se evalúa contra esta lista antes de
entrar en el plan:

| Cualidad | Qué significa | Estado |
|---|---|---|
| **Memoria** | Recuerda tu historia, tus bloqueos, tus decisiones | ✅ Memoria cognitiva con embeddings |
| **Ejecución** | No solo informa — actúa: crea, cierra, agenda | ✅ Notion, Calendar, GitHub, Tracker |
| **Proactividad** | Habla sin que le preguntes cuando hay algo relevante | ✅ 7 crons + motor de reglas |
| **Acceso sin fricción** | Dices su nombre y está ahí | ⚠️ Wake word en PWA de escritorio |
| **Conocimiento vivo** | Tu vida evoluciona, él también | ✅ Perfil dinámico + colecciones estructuradas |

---

## Qué hace hoy

**Conversación.** Voz o texto, en lenguaje natural y sin comandos, desde Telegram, la PWA o el
escritorio. Entiende la intención y enruta al sistema correcto: "¿qué tengo hoy?" va al Tracker,
"¿lloverá mañana?" al servicio de clima, "crea un issue en Unyona" a Notion y GitHub a la vez.

**Memoria cognitiva.** Personas, proyectos y conocimiento viven en colecciones estructuradas; los
hechos sueltos se extraen de las conversaciones, se buscan por similitud semántica y se **actualizan
en lugar de duplicarse** — decir "ya no voy a BIZIKI" corrige la memoria anterior.

**Ejecución real.** Crea tareas en Notion, eventos en Google Calendar, issues sincronizados entre
GitHub y Notion, marca el tracker diario por voz, programa recordatorios y redacta y envía emails
(siempre con confirmación explícita).

**Proactividad.** Briefing matutino a las 05:45, alertas inteligentes a las 08:30, Tech Radar los
lunes, PR Review automático, resumen semanal los viernes y reglas propias definidas por voz. Todo
conmutable desde `/automaticos`.

**Privacidad de verdad.** Los mensajes sensibles se procesan solo en el Ollama local; si el PC está
apagado, BAKO rechaza el mensaje en vez de mandarlo a la nube.

**Nunca se queda sin LLM.** Cadena de fallback Ollama → Groq → OpenRouter, con clasificación previa
de la consulta para gastar el mínimo de tokens posible.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Node 20 · Express 5 · TypeScript |
| BD principal | MongoDB Atlas M0 (Mongoose) |
| BD portfolio | Cloudflare D1 (Tracker, blog) |
| LLM local | Ollama `llama3.2:3b` vía Cloudflare Tunnel |
| LLM cloud | Groq `llama-3.3-70b-versatile` |
| LLM fallback | OpenRouter (modelos free) |
| Embeddings | Ollama `nomic-embed-text` · Cloudflare Workers AI |
| Voz | `msedge-tts` (salida) · Groq Whisper (entrada) |
| Clientes | Telegram Bot · PWA vanilla JS · Python tkinter |
| Seguridad | helmet · CORS allowlist · rate limiting · JWT · bcrypt |
| Hosting | Render (free) |

---

## Estructura

```
bako/
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express, seguridad, rutas, arranque de bot y crons
│   │   ├── llm/claude.ts       # Orquestador LLM y cadena de fallback
│   │   ├── knowledge/          # Perfil base
│   │   ├── memory/             # Modelos Mongoose (Memory, Person, Project, Knowledge…)
│   │   ├── middleware/         # Auth JWT · rate limiting · validación
│   │   ├── routes/             # API REST
│   │   ├── tools/              # Telegram, Notion, GitHub, Calendar, Gmail, clima, voz…
│   │   ├── agents/             # MorningBriefingAgent
│   │   └── services/           # Proactividad (crons) · Web Push
│   ├── scripts/                # OAuth Google, seeds, autostart Windows
│   └── public/bako-client/     # PWA instalable
├── bako-desktop/               # Cliente de escritorio Python
└── scripts/check-secrets.js    # Escáner de secretos pre-commit
```

---

## Puesta en marcha

```bash
cd backend
npm install
cp .env.example .env     # rellenar — .env NUNCA entra en git
npm run dev
```

Arranque correcto:

```
✅ MongoDB conectado
🤖 BAKO Telegram activo
📡 BAKO Proactividad activa
```

**Google Calendar y Gmail** (una sola vez): `npx ts-node scripts/auth-google.ts`.

**Hook de secretos** (obligatorio en cada máquina): `node scripts/check-secrets.js --install`.

**Producción:** Render despliega automáticamente al hacer push a `master`. Las variables se
configuran en el dashboard; `render.yaml` declara cuáles.

La guía completa de instalación en una máquina nueva, con la tabla de credenciales y los límites de
cada servicio gratuito, está en [SETUP.md](SETUP.md).

> ⚠️ Este repositorio es **público**. Ningún secreto puede entrar en git.

---

## Documentación

| Documento | Contenido |
|---|---|
| [spec.md](spec.md) | Especificación viva: arquitectura, decisiones invariantes, metodología |
| [plan.md](plan.md) | Plan de trabajo: pendientes por fases e histórico de lo completado |
| [GRAPH_REPORT.md](GRAPH_REPORT.md) | Grafo estructural del código: hotspots, clusters, cómo consultarlo |
| [SETUP.md](SETUP.md) | Instalación en máquina nueva, credenciales, límites de servicios |
| [CLIENTS.md](CLIENTS.md) | Telegram, PWA y Desktop: comandos y capacidades |
| [KNOWLEDGE.md](KNOWLEDGE.md) | Base de conocimiento: fuentes, categorías, proceso |

---

## Metodología

Este repositorio usa **Spec-Driven Development**: `spec.md` y `plan.md` son la única fuente de
verdad. Nada se implementa sin su punto en el plan, y toda decisión de arquitectura queda registrada
en la spec en la misma sesión en que se toma. Las reglas operativas para Claude Code están en
[CLAUDE.md](CLAUDE.md).
