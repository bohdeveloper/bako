# AI Personal OS — Roadmap

> Asistente de IA personal que automatiza el día a día de un developer:
> briefings por voz, gestión de proyectos, correo, redes sociales,
> y una IA pública integrada en el portfolio personal.

---

## Estado actual

| Componente | Estado |
|---|---|
| Backend Express + TypeScript | ✅ Hecho |
| MongoDB (memoria de tareas) | ✅ Hecho |
| LLM local con Ollama (qwen2.5-coder:7b) | ✅ Hecho |
| GitHub tool (repos, commits, PRs) | ✅ Hecho |
| Morning Briefing Agent (texto) | ✅ Hecho |

---

## Fase 2 — Voz + Clima + Noticias
**Objetivo:** El briefing matutino habla en voz alta en español.

### Tools nuevos
- `src/tools/weather.ts` — Open-Meteo (gratis, sin API key)
- `src/tools/news.ts` — RSS feeds (El País, Hacker News, etc.)
- `src/tools/tts.ts` — edge-tts (motor de voz de Microsoft Edge, español excelente)

### Agente actualizado
- `MorningBriefingAgent` incluye clima y noticias en el contexto
- Al terminar, genera un archivo `.mp3` y lo reproduce automáticamente

### Entregable
```
Pulsas un botón → el agente recoge datos → Ollama genera el texto → 
una voz lo lee en voz alta: tiempo, noticias, proyectos
```

---

## Fase 3 — Telegram como panel de control móvil
**Objetivo:** Controlar el agente desde el móvil con comandos de texto.

### Tool nuevo
- `src/tools/telegram.ts` — Telegram Bot API (gratis)

### Comandos del bot
| Comando | Acción |
|---|---|
| `/briefing` | Dispara el Morning Briefing completo |
| `/tiempo` | Solo el clima del día |
| `/proyectos` | Estado de repos GitHub |
| `/tareas` | Lista de tareas pendientes |
| `/email` | Resumen de correos sin leer |

### Entregable
```
Escribes "/briefing" en Telegram → recibes el resumen del día en tu móvil
```

---

## Fase 4 — Calendario y Tareas
**Objetivo:** El briefing incluye tu agenda y lista de pendientes.

### Tools nuevos
- `src/tools/calendar.ts` — Google Calendar API (gratis con OAuth2)
- `src/tools/tasks.ts` — Notion API o Todoist API (ambas con tier gratis)

### Datos añadidos al briefing
- Eventos del día y de mañana
- Tareas con fecha límite próxima
- Reuniones y deadlines

---

## Fase 5 — Email inteligente
**Objetivo:** El agente lee, resume y responde correos.

### Tool nuevo
- `src/tools/gmail.ts` — Gmail API (gratis con OAuth2)

### Capacidades
- Resumen de correos sin leer priorizados por importancia
- Borrador de respuesta generado por el LLM
- Filtrado: ignora newsletters, prioriza clientes y proyectos
- Comando Telegram: `/email` → lista resumida en el móvil

---

## Fase 6 — Redes Sociales
**Objetivo:** Publicar contenido desde el agente, generado o pre-cargado.

### Tool nuevo
- `src/tools/social.ts` — Twitter/X API + LinkedIn API

### Flujo de publicación
1. Cargas ideas de posts en una colección MongoDB (`Post`)
2. El agente genera el texto final con el LLM
3. Le dices "/publicar" por Telegram → revisa el borrador → confirmas → publica
4. O modo automático: publica según un calendario editorial definido

---

## Fase 7 — Portfolio Integration (IA pública)
**Objetivo:** Tu portfolio personal tiene una IA integrada que habla de ti,
tus proyectos y habilidades. Tú también la usas como asistente privado.

### Dos modos de acceso

**Modo público** (visitantes del portfolio)
- Widget de chat en tu web
- La IA conoce tus proyectos, stack, experiencia y formas de contacto
- Responde preguntas: "¿Qué tecnologías dominas?", "¿Tienes experiencia en React?"
- Base de conocimiento: `src/knowledge/profile.json` (tú lo rellenas una vez)

**Modo privado** (tú, autenticado)
- Acceso completo al asistente: briefing, email, tareas, proyectos
- Interfaz chat en el propio portfolio, protegida por token

### Nuevos componentes
- `src/knowledge/profile.json` — tu perfil, proyectos, stack, bio
- `src/agents/PortfolioAgent.ts` — responde sobre ti usando el perfil
- `src/middleware/auth.ts` — distingue visitante vs tú
- `frontend/` — interfaz React mínima (chat widget embebible)

### Entregable
```
Visitante llega al portfolio → abre el chat → pregunta sobre ti →
la IA responde con tus proyectos reales y tu stack real
```

---

## Fase 8 — Wake Word (activación por voz)
**Objetivo:** Dices el nombre de tu IA y empieza a hablar.

### Tecnología
- **OpenWakeWord** — open source, corre en CPU, sin internet
- Proceso en background escuchando el micrófono
- Al detectar la palabra, hace POST al backend y reproduce el briefing

### Palabras activadoras sugeridas
- "Bako" / "Bako, buenos días" / "Hey Bako"

### Entregable
```
Dices "Bako" → el sistema lo detecta → el agente corre → 
una voz te da el briefing sin tocar nada
```

---

## Fase 9 — Agentes autónomos avanzados
**Objetivo:** El agente toma iniciativa y te avisa sin que lo pidas.

### Capacidades
- **Alertas proactivas**: "Tienes una PR sin revisar desde hace 3 días"
- **Resumen semanal**: cada viernes, recapitulación de la semana en proyectos
- **Decisiones asistidas**: el agente analiza una situación y te propone opciones por Telegram, tú respondes con un número
- **Memoria larga**: el agente recuerda contexto de conversaciones anteriores

### Tecnología
- Windows Task Scheduler para crons (briefing a las 8:00, resumen viernes)
- Colección MongoDB `Memory` para contexto persistente entre sesiones

---

## Visión final

```
[Dices "Bako"] ──► [Wake Word detecta]
                         │
                         ▼
              [Agente recoge datos]
              ├── Tiempo (Open-Meteo)
              ├── Noticias (RSS)
              ├── GitHub (proyectos)
              ├── Google Calendar (agenda)
              ├── Gmail (emails importantes)
              └── Tareas (Notion)
                         │
                         ▼
              [Ollama genera briefing]
                         │
                    ┌────┴────┐
                    ▼         ▼
              [Voz en        [Telegram:
               altavoz]       resumen]
                    
Bajo demanda (Telegram o portfolio):
  /email      → resume y borra correos
  /publicar   → genera y publica en redes
  /proyecto   → estado + próximos pasos
  chat libre  → cualquier consulta
```

---

## Stack completo objetivo

| Capa | Tecnología |
|---|---|
| Backend | Express + TypeScript |
| Base de datos | MongoDB |
| LLM | Ollama local (qwen2.5-coder:7b) |
| Voz | edge-tts (español nativo) |
| Clima | Open-Meteo |
| Noticias | RSS |
| Móvil | Telegram Bot |
| Calendario | Google Calendar API |
| Tareas | Notion API |
| Email | Gmail API |
| Redes | Twitter/X API + LinkedIn |
| Wake word | OpenWakeWord |
| Frontend | React (chat widget) |

**Coste total de infraestructura: $0/mes**
