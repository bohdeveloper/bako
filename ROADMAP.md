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
| Seed inicial — 19 memorias sobre Borja cargadas | ✅ |
| Ejecución — crear tareas Notion + eventos Calendar | ✅ |
| Proactividad — cron briefing 05:45, alertas 08:30, resumen semanal viernes | ✅ |
| Tracker Kronoshin — siempre en contexto ambiental (sin keywords) | ✅ |
| Historial de sesión — BAKO recuerda la conversación actual (30 min) | ✅ |
| Ubicación inferida por rutina horaria — Donostia 07-15h L-V | ✅ |

---

## Configuración PC de casa

| Tarea | Estado |
|---|---|
| Ollama autostart en inicio de sesión | ✅ Vía Ollama.lnk en carpeta Startup |
| Cloudflare Tunnel bako-ollama | ✅ Task Scheduler arranca cloudflared al login |
| Render usa Ollama local vía túnel | ✅ OLLAMA_URL=https://ollama.bohdeveloper.com |
| Fallback automático a Groq si PC apagado | ✅ isOllamaAvailable() con timeout 3s |
| Selector manual de LLM | ✅ /llm ollama\|groq\|auto + lenguaje natural |

---

## Límites de uso de servicios

| Servicio | Plan | Límite | Cuándo aplica |
|---|---|---|---|
| **Ollama** (qwen2.5-coder:7b) | Local | Sin límites | PC encendido |
| **Groq Chat** (llama-3.1-8b-instant) | Free | 20.000 tokens/min · 14.400 req/día · reset 01:00h España | PC apagado |
| **Groq Whisper** (voz→texto) | Free | 20 req/min · ~33 min audio/día · reset 01:00h España | PC apagado |
| **Cloudflare D1** | Free | 5M lecturas/día · 100K escrituras/día | Siempre |
| **Notion API** | Free | 3 req/seg | Siempre |
| **GitHub API** | Free | 5.000 req/hora | Siempre |
| **Google Calendar** | Free | 1M req/día | Siempre |
| **Open-Meteo** | Free | 10.000 req/día (cacheado 30 min) | Siempre |
| **MongoDB Atlas** | M0 Free | 512MB almacenamiento | Siempre |
| **Render** | Free | 750h/mes (no duerme con ping activo) | Siempre |

**Regla práctica:** Con PC encendido, BAKO no consume ninguna cuota. Con PC apagado, espaciar mensajes de voz y preferir texto para consultas rápidas.

---

## Asimilación de XMLs de contexto

Proceso para importar XMLs de roles, proyectos e información personal a la memoria de BAKO.
**Flujo:** Claude parsea el XML → propone memorias → usuario aprueba → se guardan en MongoDB Atlas vía `POST /api/agent/memories/import`.

| XML | Contenido | Estado |
|---|---|---|
| `prompt_MASTER` | Contexto universal: identidad, stack completo, proyectos, reglas de desarrollo, filosofía | ✅ Asimilado (10 memorias) |
| `prompt_app_kefir` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_automatizar_IA` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_busqueda_empleo` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_desarrollar_ia` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_desarrollar_ju...` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_estilo_vida` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_ingresos_pasivos` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_operacion_galicia` | Pendiente de revisar | ⏳ Pendiente |
| `prompt_piloto_drones` | Pendiente de revisar | ⏳ Pendiente |

**Cómo continuar:** Abrir Claude Code, decir "vamos a continuar con los XMLs" y pegar el siguiente. Claude tiene el contexto completo del proceso.

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

### Gap 1 — Memoria persistente y dinámica 🧠 ✅ COMPLETADO
Un mayordomo recuerda todo. BAKO olvida cada conversación al terminar.

- ✅ Colección `Memory` en MongoDB (schema: tipo, importancia, fuente, tags)
- ✅ Extracción automática de hechos tras cada conversación (async, no bloquea)
- ✅ Memoria inyectada en cada system prompt (máx 15 recuerdos: alta importancia + recientes)
- ✅ Comandos naturales: "Bako, recuerda que..." / "Bako, olvida..." / "Bako, qué recuerdas"
- ✅ Privacidad respetada: sin extracción en mensajes sensibles o `/privado`
- ✅ Script `seed-memory.ts` con 19 memorias iniciales sobre Borja (vida, proyectos, rutina, metas)

### Gap 2 — Ejecución de acciones ⚡ ✅ COMPLETADO (v1)
BAKO lee pero no actúa. Necesita poder ejecutar órdenes.

- ✅ **Notion**: crear tareas, cambiar estado, asignar fecha límite
- ✅ **Google Calendar**: crear eventos con hora, descripción, ubicación
- ❌ **GitHub**: crear issues, añadir comentarios (pendiente)
- ❌ **Recordatorios**: "Bako, recuérdame esto en 2 horas" (pendiente)
- Confirmación antes de ejecutar acciones irreversibles

### Gap 3 — Proactividad y alertas 📡 ✅ COMPLETADO (v1)
BAKO solo habla cuando le hablas. Necesita iniciativa propia.

- ✅ Briefing automático a las 05:45 (L-V, cron en Render)
- ✅ Resumen semanal automático los viernes a las 18:00
- ✅ Alerta Tracker vacío a las 22:00 (L-V)
- ✅ Alertas inteligentes a las 08:30 (L-V):
  - "Llevas X días sin commits en Diamadmin — ¿bloqueado?"
  - "Tienes N PRs sin actividad desde hace 2+ días"
  - "Mañana tienes reunión a las 9 — ¿quieres el briefing antes?"
- ❌ Motor de reglas configurables por Borja (pendiente)

### Gap 4 — Acceso sin fricción 🎤
Reducir al mínimo los pasos para hablar con BAKO.

- Texto libre natural sin necesidad de comandos `/comando`
- BAKO detecta la intención solo ("quiero ver mi agenda" = `/agenda`)
- Wake word en PC: di "Bako" → responde sin tocar el teclado
- Respuestas en menos de 2 segundos para preguntas simples
- ❌ **Personalidad configurable** — parámetros de tono inyectados en el system prompt:
  - `sinceridad` (0-10): cuánto te dice las verdades incómodas sin filtros
  - `sarcasmo` (0-10): ironía y humor seco al estilo Alfred/Jarvis
  - `simpatía` (0-10): calidez y empatía en las respuestas
  - Presets: `mayordomo clásico` / `colega directo` / `modo Jarvis`
  - Configurable vía `/personalidad <preset>` o desde el futuro panel admin

### Gap 5 — Conocimiento vivo 📚
El perfil deja de ser un archivo que editas a mano.

- Las conversaciones alimentan el perfil automáticamente
- `profile.ts` se convierte en base de datos dinámica
- BAKO pregunta cuando necesita actualizar algo importante
- Historial de cambios de vida: trabajo, ciudad, proyectos, rutina

---

## HORIZONTE 1 — BAKO completo como asistente
### Objetivo: BAKO gestiona toda tu vida digital. ~6-12 meses.

### Fase 5 — Email inteligente
- Gmail API → resumen de correos sin leer priorizados
- Borrador de respuesta generado por LLM
- `/email` en Telegram → lista de los más importantes por voz
- Acción: "Bako, redacta una respuesta a este email de Inetum"

### Fase 6 — Redes Sociales
- Twitter/X + LinkedIn API
- Cola de posts en MongoDB → BAKO genera y publica con confirmación
- Modo automático: calendario editorial definido por ti

### Fase 7 — Portfolio Integration + Panel de administración BAKO

**Modo público** — visitantes de bohdeveloper.com hablan con BAKO:
- Widget de chat embebido
- Conoce tus proyectos, stack, experiencia y formas de contacto
- Responde preguntas reales sobre ti

**Modo privado — Panel admin en bohdeveloper.com/admin** — tú, autenticado, gestionas a BAKO desde una interfaz web:

*Gestión del conocimiento:*
- Editor de perfil dinámico — modifica quién es Borja sin tocar `profile.ts`
- Visor y editor de memorias — ve, edita o elimina lo que BAKO recuerda
- Historial de conversaciones con búsqueda y filtros

*Configuración:*
- Activa o desactiva tools individuales (GitHub, Notion, Calendar...)
- Ajusta parámetros: voz, idioma, nivel de detalle del briefing, hora del cron
- Gestión de reglas de privacidad y palabras sensibles

*Seguimiento y evolución:*
- Estadísticas de uso: conversaciones por día, tools más usadas, temas frecuentes
- Log de acciones ejecutadas (tareas creadas, eventos agendados, issues abiertos)
- Línea de tiempo del aprendizaje — cómo ha crecido la memoria de BAKO
- Estado del sistema: Ollama online/offline, Groq, cada tool con su estado

*Stack:* Next.js (ya existe en bohdeveloper) + API REST de BAKO + MongoDB + autenticación existente

### Fase 8 — Wake Word
- **OpenWakeWord** — escucha el micrófono en background, sin internet
- Dices "Bako" → detecta → ejecuta briefing → responde por voz
- Sin tocar el teclado, sin abrir el móvil

### Fase 9 — Agentes autónomos y memoria larga
- Decisiones asistidas: BAKO propone opciones, tú confirmas con un número
- Cron jobs: briefing a las 05:45, resumen viernes a las 18:00 (ya en Gap 3)
- Alertas proactivas sin que las pidas: PRs sin revisar, deadlines próximos
- Memoria persistente entre conversaciones (ya en Gap 1)

---

## HORIZONTE 2 — BAKO inteligente
### Objetivo: BAKO aprende de ti y actúa sin instrucciones. ~1-2 años.

### Fase 10 — Aprendizaje de patrones
- BAKO analiza tus commits, tareas y rutinas para detectar patrones
- "Llevas 3 días sin avanzar en Diamadmin — ¿bloqueado?"
- Adapta el briefing según tu energía histórica por día de la semana

### Fase 11 — Orquestación multi-agente
Agentes especializados trabajando en paralelo:
- **DevAgent** — revisa PRs, sugiere refactors, detecta bugs en commits
- **PMAgent** — gestiona sprints de Diamadmin y Unyona
- **ContentAgent** — genera posts, copy, docs para tus proyectos
- **ResearchAgent** — investiga tecnologías y sintetiza en 5 bullets
- **LearningAgent** — tutor personal de IA/ML, sigue tu roadmap de aprendizaje
- **IdeasAgent** — valida features nuevas para Unyona y Diamadmin

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
- Cámara conectada → BAKO ve lo que tienes en pantalla
- "BAKO, revisa este código" → captura pantalla → analiza → responde
- Reconocimiento de documentos físicos (facturas, notas)

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
- Raspberry Pi 4/5 como cerebro central
- Arduino para control de motores y sensores
- Movimiento básico: seguimiento de persona, navegación de habitación
- Presupuesto incremental: ~500€ de hardware

### Fase 17 — Percepción del entorno
- Cámara estéreo → profundidad y reconocimiento de objetos
- Micrófono de campo amplio → escucha sin necesidad de wake word
- Sensores de proximidad y temperatura

### Fase 18 — Autonomía completa
- BAKO toma decisiones sin instrucción directa
- Integra ROS (Robot Operating System) para navegación
- Aprendizaje por refuerzo: mejora con cada interacción
- Sincronización con todos los sistemas digitales en tiempo real

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
| LLM local | Ollama qwen2.5-coder | Llama 3.2 fine-tuneado |
| Voz salida | msedge-tts AlvaroNeural | Modelo TTS propio |
| Voz entrada | Whisper (Groq) | Whisper local |
| Wake word | — | OpenWakeWord |
| Móvil | Telegram Bot | App React Native |
| Frontend | — | Next.js dashboard |
| Visión | — | OpenCV + YOLO |
| Robótica | — | Raspberry Pi + ROS |
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
