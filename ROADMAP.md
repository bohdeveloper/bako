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
| Memoria Atlas — 101 registros verificados (10 XMLs + conocimiento personal, nunca borrar) | ✅ |
| Carga adaptativa — todas las personales siempre + técnicas por LLM (Ollama=5, Groq=20) | ✅ |
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
| `prompt_MASTER` | Contexto universal: identidad, stack completo, proyectos, reglas de desarrollo, filosofía | ✅ Asimilado (15 memorias) |
| `prompt_app_kefir` | Proyecto kefir artesanal en Galicia (largo plazo), modelo negocio, legal, stack | ✅ Asimilado (12 memorias) |
| `prompt_automatizar_IA` | Arquitectura BAKO completa: 7 agentes, n8n, RAG, 4 fases 18 meses | ✅ Asimilado (7 memorias) |
| `prompt_busqueda_empleo` | Perfil mercado laboral, preferencias, criterios evaluación ofertas | ✅ Asimilado (3 memorias) |
| `prompt_desarrollar_ia` | Ruta ML/DL completa, stack, recursos, hardware robótica | ✅ Asimilado (6 memorias) |
| `prompt_desarrollar_ju...` | Matrix Game open-world UE5: visión, stack, timeline, skills necesarias | ✅ Asimilado (6 memorias) |
| `prompt_estilo_vida` | Rutina semanal completa, estoicismo-shaolin, horario desde tracker | ✅ Asimilado (4 memorias) |
| `prompt_ingresos_pasivos` | Estrategia ingresos pasivos, criterios, validación, plataformas | ✅ Asimilado (2 memorias) |
| `prompt_operacion_galicia` | Mudanza Galicia, vivienda, Yaimy, laboral, proceso judicial | ✅ Asimilado (3 memorias) |
| `prompt_piloto_drones` | Hobby FPV post-Galicia, locaciones, ruta AESA A2, presupuesto | ✅ Asimilado (5 memorias) |

**Cómo continuar:** Abrir Claude Code, decir "vamos a continuar con los XMLs" y pegar el siguiente. Claude tiene el contexto completo del proceso.

> Progreso: 10/10 completados ✅ (reimportados el 03/06/2026)

---

## Conocimiento Personal Profundo de Borja

BAKO debe conocer a su señor como lo haría un mayordomo de toda la vida — no solo su stack técnico, sino quién es como persona.

**Fuentes de conocimiento:**
- Sesiones de preguntas con Claude Code → memorias importadas en MongoDB
- XMLs de contexto personal asimilados
- Conversaciones diarias que BAKO extrae y recuerda automáticamente

**Categorías a cubrir:**

| Categoría | Estado |
|---|---|
| Datos básicos (edad, cumpleaños, ubicación) | ✅ En profile.ts |
| Situación laboral actual | ✅ En profile.ts (LAE corregido 03/06/2026) |
| Proyectos personales vs profesional | ✅ En profile.ts |
| Rutina diaria y entrenamiento | ✅ En profile.ts |
| Familia y relaciones personales | ✅ En Atlas (19 memorias: pareja, padres, hermana, cuñada, abuelos, amigos, suegros) |
| Gustos y preferencias (comida, música, ocio) | ✅ En Atlas (comida, música, ocio) |
| Historia personal y momentos clave | ✅ En Atlas (origen, hábitos, psicólogo, proceso judicial) |
| Miedos, motivaciones y valores | ✅ En Atlas (orgullo carrera, transformación personal, miedo a perder libertad, estoicismo+shaolin) |
| Salud y bienestar | ✅ En Atlas (digestión, sueño, suplementos, dieta) |
| Objetivos vitales más allá de BAKO | ✅ En Atlas (casa Galicia, hobbies, proyecto repostería Yaimy, hijos, libertad) |
| Finanzas y situación económica | ✅ En Atlas (2k ahorrados, meta 5-10k, sin deudas, coste vida Errentería) |
| Carácter: cómo se describe Borja a sí mismo | ✅ En Atlas (energico, valiente, empático, leal / autocontrol, foco, constancia) |

**Cómo continuar:** Abrir Claude Code y decir "quiero que BAKO me conozca mejor — hazme preguntas personales". Claude hace las preguntas, Borja responde, se importan como memorias.

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
- ✅ **Carga adaptativa por tipo y LLM** — todas las personales siempre (~44, limit 60) + técnicas según LLM: Ollama=5, Groq=20 (fix 03/06/2026)
  - Antes: ratio 70/30 del total (Ollama=25 → 18 personal + 7 técnico) — datos personales podían quedar fuera
  - Ahora: padre, familia, salud, historia… siempre en contexto independientemente del modo LLM
- ✅ Endpoint `DELETE /api/agent/memories/:id` para gestión desde Claude Code
- ✅ Comandos naturales: "Bako, recuerda que..." / "Bako, olvida..." / `/memorias [tema]`
- ✅ Privacidad respetada: sin extracción en mensajes sensibles o `/privado`
- ✅ 101 memorias en Atlas (10/10 XMLs + conocimiento personal) — solo evolucionar, nunca borrar

### Gap 2 — Ejecución de acciones ⚡ ✅ Verificado
BAKO lee pero no actúa. Necesita poder ejecutar órdenes.

- ✅ **Notion**: crear tareas, cambiar estado, asignar fecha límite
- ✅ **Google Calendar**: crear eventos con hora, descripción, ubicación
- ✅ **GitHub**: crear issues por voz/texto ("crea un issue en diamadmin sobre el bug del login")
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
- ❌ Wake word en PC — diferido a Horizonte 1 (requiere OpenWakeWord + setup local)

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

## Clientes de acceso a BAKO

### Telegram (principal)
- Bot activo 24/7 en Render
- Voz + texto + comandos naturales
- No requiere instalación

### PWA — Cliente web v3 (móvil y PC)
URL: `https://ai-personal-os.onrender.com/bako-client/`

**Características v3:**
- Chat history con burbujas (usuario derecha verde · BAKO izquierda azul)
- Botón ↩ por mensaje → copia al input para editar y reenviar
- Input de texto + botón Enviar (además de voz)
- Revisión de transcripción: 5s countdown + barra de progreso, editable
- Modo claro/oscuro con toggle luna/sol (patrón bohdeveloper.com)
- Rate limit: bloquea UI automáticamente con countdown visible

**Instalación en Android (Chrome):**
1. Abre Chrome → navega a la URL
2. Menú (⋮) → "Añadir a pantalla de inicio"
3. Se instala como app con icono propio

**Instalación en iOS (Safari):**
1. Safari → icono compartir (⬆) → "Añadir a pantalla de inicio"

---

### Script Python — Cliente de escritorio v3 (PC)
Archivo: `bako-desktop/bako_desktop.py`

**Características v3:**
- GUI tkinter con chat history y burbujas (mismo estilo que la PWA)
- Botón ↩ por mensaje → pega texto en el input para reenviar
- Input de texto + botón Enviar
- Modo claro/oscuro con toggle luna/sol
- Revisión de transcripción: 5s countdown, editable
- Rate limit: bloquea botones automáticamente con countdown
- Hotkey global Ctrl+Alt+B

**Instalación (una sola vez):**
```bash
cd bako-desktop
pip install -r requirements.txt
```

**Uso diario:**
```bash
python bako_desktop.py
```

**Configuración opcional** (variables de entorno):
```
BAKO_URL=https://ai-personal-os.onrender.com
DESKTOP_TOKEN=<token>
BAKO_HOTKEY=ctrl+alt+b
```

**Arranque automático con Windows:**
1. `Win+R` → `shell:startup` → acceso directo a `python bako_desktop.py`

---

### App React Native (Horizonte 1) ❌ Pendiente
- App nativa Android + iOS
- Wake word "Bako" con pantalla bloqueada
- Notificaciones push proactivas
- Acceso completo sin abrir ninguna app

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

### Fase 7 — Portfolio Integration + Panel de administración BAKO ❌ Pendiente
- Panel admin en bohdeveloper.com/admin — gestión visual de memorias, perfil, tools, stats
- Widget de chat público en bohdeveloper.com
- Stack: Next.js + API REST BAKO + MongoDB + auth existente

### Fase 8 — Automatización (sin n8n) ✅ Completado (junio 2026)
Implementado directamente en ProactivityService sin infraestructura adicional:
- ✅ **Tech Radar semanal** (lunes 09:30) — 5 feeds tech (JS Weekly, Node, React, HN, TLDR AI) → LLM filtra top 5 relevantes para el stack de Borja · `/techradar` manual
- ✅ **PR Review automático** (L-V 08:30) — PRs actualizados en 24h → diff GitHub → análisis LLM como senior dev · `/prreview` manual
- ✅ Morning Briefing (05:45), Weekly Summary (viernes 18:00), Alerta Tracker (22:00)
- ✅ **Gestión mensajes automáticos** — `/automaticos` con botones inline, 7 crons configurables, estado persiste en MongoDB (`AutoConfig`)

### Fase 9 — Wake Word ❌ Pendiente
- **OpenWakeWord** — escucha el micrófono en background, sin internet
- Dices "Bako" → detecta → ejecuta briefing → responde por voz
- Sin tocar el teclado, sin abrir el móvil

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
| LLM local | Ollama qwen2.5-coder | Llama 3.2 fine-tuneado |
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
