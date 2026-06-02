# BAKO — Borja's Autonomous Knowledge Operator

> Un mayordomo digital omnisciente. No un chatbot — un Alfred.
> Conoce quién eres, dónde estás, qué tienes pendiente, cómo va tu trabajo.
> Disponible 24/7, voice-first, privacidad real, coste $0/mes.

---

## La filosofía

BAKO no es un asistente que responde preguntas. Es un **mayordomo** que tiene cinco cualidades que lo definen:

| Cualidad | Qué significa | Estado |
|---|---|---|
| **Memoria** | Recuerda todo lo que le has dicho. Conoce tu historia, tus bloqueos, tus decisiones | ⚠️ Perfil estático (en desarrollo) |
| **Ejecución** | No solo informa — actúa. Crea, modifica, cierra, agenda | ⚠️ Solo lectura (en desarrollo) |
| **Proactividad** | Anticipa necesidades. Habla sin que le preguntes cuando hay algo relevante | ❌ Pendiente |
| **Acceso sin fricción** | Está ahí. Dices su nombre, ya está | ⚠️ Vía Telegram (mejorando) |
| **Conocimiento vivo** | Tu vida evoluciona, él también | ❌ Pendiente |

Cada decisión de arquitectura, cada feature nueva, se evalúa contra esta lista.

---

## Arquitectura del sistema

```
╔══════════════════════════════════════════════════════════════════════╗
║                         TÚ (Borja)                                   ║
║          Telegram móvil / Telegram desktop / API REST                ║
╚═══════════════════════╦══════════════════════════════════════════════╝
                        │ mensaje texto o voz
                        ▼
╔══════════════════════════════════════════════════════════════════════╗
║              TELEGRAM BOT (@bako_bot)                                ║
║              Servidor: api.telegram.org                              ║
║         Token: TELEGRAM_BOT_TOKEN (de @BotFather)                   ║
╚═══════════════════════╦══════════════════════════════════════════════╝
                        │ polling cada 1s
                        ▼
╔══════════════════════════════════════════════════════════════════════╗
║            BAKO BACKEND — Express + TypeScript                       ║
║            Render.com — cloud 24/7, HTTPS automático                 ║
║                                                                      ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │ TELEGRAM HANDLER (src/tools/telegram.ts)                     │   ║
║  │  1. Recibe mensaje                                            │   ║
║  │  2. Si voz → Groq Whisper (speech-to-text)                   │   ║
║  │  3. Detecta contenido sensible (regex privacidad)             │   ║
║  │  4. Detecta comando o intención                               │   ║
║  │  5. Obtiene contexto relevante (weather, calendar, etc.)      │   ║
║  │  6. Llama a askClaude()                                       │   ║
║  │  7. Genera voz (msedge-tts WebM/Opus)                         │   ║
║  │  8. Responde con nota de voz                                  │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                                                                      ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │ LLM ORCHESTRATOR (src/llm/claude.ts)                         │   ║
║  │                                                               │   ║
║  │   BAKO_PROFILE + contexto real + hora española                │   ║
║  │              │                                                │   ║
║  │    ¿isOllamaAvailable()?                                      │   ║
║  │        SÍ ◄──┤──► NO                                         │   ║
║  │        ▼             ▼                                        │   ║
║  │    OLLAMA          GROQ                                       │   ║
║  │    LOCAL           CLOUD                                      │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════════╝
         │                              │
         │ PC encendido                 │ Siempre disponible
         ▼                              ▼
╔══════════════════╗        ╔═══════════════════════════╗
║  TU PC (Windows) ║        ║  GROQ CLOUD               ║
║                  ║        ║  api.groq.com              ║
║  Ollama          ║        ║  Llama 3.3 70B             ║
║  localhost:11434 ║        ║  + Whisper (STT)           ║
║  qwen2.5-coder   ║        ║  Gratis ~14.400 req/día    ║
║  :7b (4.7GB)     ║        ║                            ║
║  Privado         ║        ║  Token: GROQ_API_KEY        ║
╚══════════════════╝        ╚═══════════════════════════╝


━━━━━━━━━━━ TOOLS DE CONTEXTO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│  WEATHER     │  │  GITHUB      │  │  GOOGLE CALENDAR         │
│  Open-Meteo  │  │  API GitHub  │  │  googleapis.com          │
│  Sin token   │  │  GITHUB_TOKEN│  │  OAuth2 (3 vars)         │
│  Errentería  │  │  repos,PRs   │  │  Agenda hoy/mañana       │
│  3 días      │  │  commits     │  │                          │
└──────────────┘  └──────────────┘  └──────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│  NOTION      │  │  CLOUDFLARE  │  │  NEWS (RSS)              │
│  api.notion  │  │  D1 SQLite   │  │  Sin token               │
│  NOTION_TOKEN│  │  CF_API_TOKEN│  │  El País                 │
│  Tareas y    │  │  Tracker     │  │  Hacker News             │
│  proyectos   │  │  Blog        │  │  Top 5 titulares         │
└──────────────┘  └──────────────┘  └──────────────────────────┘


━━━━━━━━━━━ BASES DE DATOS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────────────────────┐  ┌──────────────────────────────┐
│  MONGODB ATLAS (cloud)       │  │  CLOUDFLARE D1 (edge)        │
│  Historial de conversaciones │  │  tracker_tasks               │
│  Colección: tasks            │  │  tracker_records             │
│  prompt + respuesta + fecha  │  │  tracker_notes               │
│                              │  │  blog_comments               │
│  Futuro: Memory collection   │  │  blog_posts                  │
└──────────────────────────────┘  └──────────────────────────────┘
```

---

## Flujo completo de una conversación

**Ejemplo: nota de voz "Buenos días Bako, ¿cómo está el tiempo?"**

```
1. Nota de voz en Telegram
2. Groq Whisper transcribe el audio
3. Detección de sensibilidad → no hay palabras sensibles
4. Keyword "tiempo" → llama a getWeather()
5. Open-Meteo devuelve datos de Errentería
6. Construye prompt: [BAKO_PROFILE] + [hora: 08:32 lunes] + [weather] + [pregunta]
7. isOllamaAvailable()? → SÍ: Ollama qwen2.5 / NO: Groq llama-3.3
8. LLM genera respuesta contextualizada con hora y datos reales
9. msedge-tts genera nota de voz WebM (AlvaroNeural)
10. Telegram envía nota de voz de vuelta
11. MongoDB guarda [prompt → respuesta]
```

---

## Estructura del proyecto

```
ai-personal-os/
├── backend/
│   ├── src/
│   │   ├── index.ts                  # Entrada Express + MongoDB + Telegram
│   │   ├── agents/
│   │   │   └── MorningBriefingAgent.ts  # Briefing paralelo de todos los tools
│   │   ├── routes/
│   │   │   └── agent.ts              # REST API: /ask, /morning-briefing, /tasks
│   │   ├── knowledge/
│   │   │   └── profile.ts            # BAKO_PROFILE — quién es Borja
│   │   ├── memory/
│   │   │   └── Task.ts               # Schema MongoDB para historial
│   │   ├── llm/
│   │   │   └── claude.ts             # Orquestador Ollama/Groq + privacidad
│   │   └── tools/
│   │       ├── telegram.ts           # Bot, comandos, voz, contexto
│   │       ├── github.ts             # Repos, commits, PRs, issues
│   │       ├── notion.ts             # Tareas y proyectos
│   │       ├── calendar.ts           # Google Calendar OAuth2
│   │       ├── weather.ts            # Open-Meteo
│   │       ├── news.ts               # RSS feeds
│   │       ├── tts.ts                # msedge-tts voz neural
│   │       └── cloudflare.ts         # D1: Tracker + Blog
│   ├── scripts/
│   │   ├── auth-google.ts            # Setup OAuth Google Calendar
│   │   └── setup-windows-autostart.ps1  # Ollama + PM2 como servicios Windows
│   └── package.json
├── ROADMAP.md                         # Visión completa y fases
├── README.md                          # Este archivo
└── render.yaml                        # Config despliegue Render.com
```

---

## Comandos de Telegram

| Comando | Qué hace |
|---------|----------|
| `texto libre` | Pregunta o pide cualquier cosa en lenguaje natural |
| `nota de voz` | Habla directamente — Whisper transcribe y responde por voz |
| `/briefing` | Briefing completo: weather + noticias + calendar + GitHub + Notion |
| `/tiempo` | Tiempo actual + pronóstico 3 días, por voz |
| `/proyectos` | Repos activos, commits recientes, PRs abiertas |
| `/tareas` | Tareas Notion + issues GitHub asignados |
| `/agenda` | Eventos de Google Calendar hoy y mañana |
| `/tracker` | Estado del tracker diario (✅ ❌ ⏳) |
| `/comentarios` | Comentarios del blog bohdeveloper.com |
| `/privado <msg>` | Fuerza modo local Ollama — nunca sale a la nube |
| `/servicio` | Muestra si BAKO está usando Ollama local o Groq cloud |
| `/personalidad <preset>` | *(próximamente)* Ajusta el tono: `mayordomo`, `colega`, `jarvis` |

---

## Variables de entorno

Todas las variables van en `backend/.env` para local y en el dashboard de Render para producción.

| Variable | Servicio | Cómo obtenerla |
|----------|---------|----------------|
| `GROQ_API_KEY` | groq.com | console.groq.com → API Keys |
| `TELEGRAM_BOT_TOKEN` | Telegram | @BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | Telegram | Primer /start al bot |
| `GITHUB_TOKEN` | GitHub | Settings → Developer Settings → PAT (classic) → scope: repo |
| `GITHUB_USERNAME` | GitHub | Tu nombre de usuario |
| `NOTION_TOKEN` | Notion | Settings → Integrations → New Integration |
| `NOTION_TASKS_DB_ID` | Notion | URL de la base de datos de tareas |
| `NOTION_PROJECTS_DB_ID` | Notion | URL de la base de datos de proyectos |
| `GOOGLE_CLIENT_ID` | Google Cloud | Cloud Console → Credenciales OAuth2 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud | Cloud Console → Credenciales OAuth2 |
| `GOOGLE_TOKEN_JSON` | Google (auto) | Generado por `npx ts-node scripts/auth-google.ts` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | Dashboard → API Tokens → D1:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | Dashboard → Overview (barra lateral) |
| `CLOUDFLARE_D1_DB_ID` | Cloudflare | Workers & Pages → D1 → tu base de datos |
| `MONGODB_URI` | MongoDB Atlas | Atlas → Connect → Drivers |
| `OLLAMA_URL` | Local | Fijo: `http://localhost:11434` |
| `OLLAMA_MODEL` | Local | Fijo: `qwen2.5-coder:7b` |
| `TTS_VOICE` | msedge-tts | `es-ES-AlvaroNeural` o `es-ES-ElviraNeural` |
| `WEATHER_LAT` | Open-Meteo | `43.3108` (Errentería) |
| `WEATHER_LON` | Open-Meteo | `-1.8997` (Errentería) |
| `BAKO_OWNER_NAME` | — | `Borja` |

---

## Sistema de privacidad

BAKO tiene dos capas de privacidad:

**Detección automática** — si el mensaje contiene palabras sensibles (`inetum`, `contrato`, `nómina`, `sueldo`, `password`, `token`, `credencial`, `dni`, `banco`) el sistema:
- Si Ollama está disponible (PC encendido) → procesa SOLO en local, nunca toca Groq
- Si Ollama no está disponible → rechaza el mensaje con error explicativo

**Modo explícito** — `/privado <mensaje>` fuerza siempre el procesamiento local independientemente del contenido.

---

## Instalación y puesta en marcha

### Requisitos
- Node.js 20+
- MongoDB Atlas (cuenta gratuita)
- Ollama instalado (`winget install Ollama.Ollama`)
- Modelo descargado: `ollama pull qwen2.5-coder:7b`

### Local
```bash
cd backend
npm install
cp .env.example .env   # rellenar todas las variables
npm run dev            # ts-node, hot reload
```

### Configurar Google Calendar (una sola vez)
```bash
cd backend
npx ts-node scripts/auth-google.ts
# Sigue el link que aparece, autoriza con tu cuenta Google
# Se genera token.json automáticamente
```

### Configurar autostart en Windows + Cloudflare Tunnel

El script configura el túnel que permite a Render usar tu Ollama local cuando el PC está encendido.

**Prerrequisitos (una sola vez):**
```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login                                      # abre navegador, autoriza
cloudflared tunnel create bako-ollama                         # guarda el ID que devuelve
cloudflared tunnel route dns bako-ollama ollama.bohdeveloper.com
```

**Luego ejecuta el script (PowerShell normal, sin Admin):**
```powershell
.\backend\scripts\setup-windows-autostart.ps1
```

**Añade en Render Dashboard:**
```
OLLAMA_URL=https://ollama.bohdeveloper.com
```

**Resultado:**
- PC encendido → Render usa Ollama local vía túnel (privado, sin rate limits)
- PC apagado → túnel cae, Render vuelve a Groq automáticamente sin cortes
- `/servicio` en Telegram → muestra qué LLM está usando BAKO ahora mismo
- `/llm ollama|groq|auto` → cambia manualmente el LLM preferido

### Producción (Render.com)
El deploy es automático desde GitHub (rama `master`).
- Configurar todas las variables de entorno en Render Dashboard
- `GOOGLE_TOKEN_JSON` = contenido completo del `token.json` generado en local

---

## Lo que viene — próximos pasos

1. **Personalidad configurable** — parámetros de sinceridad, sarcasmo y simpatía (0-10) inyectados en el system prompt. Presets: `mayordomo clásico`, `colega directo`, `modo Jarvis`. Comando `/personalidad` + panel admin.
2. **Texto libre sin comandos** — detección de intención pura sin necesidad de `/comando`
3. **Wake word** — di "Bako" en casa y responde sin tocar el teclado (OpenWakeWord)
4. **Gmail** — resumen de correos sin leer, borradores por voz
5. **Panel admin** — dashboard Next.js para gestionar memorias, configurar BAKO y ver estadísticas

Ver [ROADMAP.md](ROADMAP.md) para el plan completo de todos los horizontes.

---

## Stack actual vs. objetivo

| Capa | Hoy | Objetivo |
|------|-----|---------|
| Backend | Express + TypeScript | Express + TypeScript |
| BD conversacional | MongoDB Atlas (historial) | MongoDB + búsqueda semántica |
| BD portfolio | Cloudflare D1 | Cloudflare D1 expandido |
| LLM cloud | Groq Llama 3.3 70B | Groq + modelo fine-tuneado |
| LLM local | Ollama qwen2.5-coder:7b | Llama 3.2 fine-tuneado |
| Voz salida | msedge-tts AlvaroNeural | Modelo TTS entrenado |
| Voz entrada | Groq Whisper (cloud) | Whisper local |
| Wake word | — | OpenWakeWord |
| Interfaz | Telegram Bot | App React Native |
| Dashboard | — | Next.js |
| Visión | — | OpenCV + YOLO |
| Robótica | — | Raspberry Pi + ROS |
| Hosting | Render free | Render + Raspberry Pi hub |
| **Coste mensual** | **$0** | **$0** |
