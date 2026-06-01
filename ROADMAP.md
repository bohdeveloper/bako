# BAKO — Roadmap completo
### Borja's Autonomous Knowledge Operator

> De asistente personal a IA autónoma con presencia física.
> El objetivo final: un Jarvis real. No en ficción — en producción.

---

## Estado actual — MVP en producción

| Componente | Estado |
|---|---|
| Backend Express + TypeScript | ✅ |
| MongoDB Atlas (memoria cloud) | ✅ |
| LLM híbrido Ollama local + Groq fallback | ✅ |
| Morning Briefing con voz (AlvaroNeural) | ✅ |
| Tool GitHub — repos, commits, PRs, issues | ✅ |
| Tool Weather — Open-Meteo, Errentería | ✅ |
| Tool News — RSS (El País, Hacker News) | ✅ |
| Tool TTS — msedge-tts, voz neural española | ✅ |
| Telegram Bot — voz, comandos, texto libre | ✅ |
| Desplegado en Render (24/7, gratis) | ✅ |
| Perfil personal cargado en contexto | ✅ |

---

## HORIZONTE 1 — BAKO completo como asistente
### Objetivo: BAKO gestiona toda tu vida digital. ~6-12 meses.

### Fase 4 — Calendario y Tareas
- Google Calendar API → agenda del día en el briefing y por Telegram
- Notion API → tareas pendientes reales (no solo GitHub issues)
- `/agenda` en Telegram → eventos de hoy y mañana por voz

### Fase 5 — Email inteligente
- Gmail API → resumen de correos sin leer priorizados
- Borrador de respuesta generado por LLM
- `/email` en Telegram → lista de los más importantes por voz

### Fase 6 — Redes Sociales
- Twitter/X + LinkedIn API
- Cola de posts en MongoDB → BAKO genera y publica con confirmación
- Modo automático: calendario editorial definido por ti

### Fase 7 — Portfolio Integration
**Modo público** — visitantes de bohdeveloper.com hablan con BAKO:
- Widget de chat embebido
- Conoce tus proyectos, stack, experiencia y formas de contacto
- Responde preguntas reales sobre ti

**Modo privado** — tú, autenticado, con acceso completo al asistente

### Fase 8 — Wake Word
- **OpenWakeWord** — escucha el micrófono en background, sin internet
- Dices "Bako" → detecta → ejecuta briefing → responde por voz
- Sin tocar el teclado, sin abrir el móvil

### Fase 9 — Agentes autónomos y memoria larga
- Alertas proactivas sin que las pidas: PRs sin revisar, deadlines próximos
- Resumen semanal automático cada viernes
- Decisiones asistidas: BAKO propone opciones, tú confirmas con un número
- Memoria persistente entre conversaciones (MongoDB `Memory`)
- Cron jobs: briefing a las 05:45, resumen viernes a las 18:00

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
| Diamadmin en producción con usuarios | PMAgent + DevAgent |
| Unyona validada con leads reales | ContentAgent + IdeasAgent |
| Portfolio que consigue clientes | Fase 7 — IA pública |
| Aprender ML/IA en profundidad | LearningAgent guía el roadmap |
| Vivir en Galicia trabajando remoto | Ops integrado con rutina nueva |
| JARVIS físico funcional | Horizontes 3 y 4 |
