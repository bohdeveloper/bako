# GRAPH_REPORT.md — BAKO

> Grafo de conocimiento estructural del repositorio, generado con
> [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp) (skill `grafo-designer`).
> Indexado local, sin LLM y sin coste de tokens. Reemplaza al grafo `graphify` retirado el 14/08/2026.

**Proyecto en el grafo:** `C-aplic-bako` · **Indexado:** 14/08/2026 · **962 nodos · 2.649 aristas**

---

## Cómo consultarlo

El servidor está declarado en [.mcp.json](.mcp.json). Desde Claude Code las tools están disponibles
directamente; desde terminal, vía CLI:

```bash
codebase-memory-mcp cli get_graph_schema  '{"project":"C-aplic-bako"}'
codebase-memory-mcp cli get_architecture  '{"project":"C-aplic-bako","aspects":["all"]}'
codebase-memory-mcp cli search_graph      '{"project":"C-aplic-bako","label":"Function","name_pattern":".*Memory.*"}'
codebase-memory-mcp cli trace_path        '{"project":"C-aplic-bako","function_name":"askClaude","direction":"both"}'
codebase-memory-mcp cli get_code_snippet  '{"project":"C-aplic-bako","qualified_name":"C-aplic-bako.backend.src.llm.claude.askClaude"}'
codebase-memory-mcp cli detect_changes    '{"project":"C-aplic-bako"}'
codebase-memory-mcp cli index_repository  '{"repo_path":"C:/aplic/bako"}'   # reindexar
```

> Requisito en una máquina nueva: `pip install codebase-memory-mcp` (el binario queda en el PATH).

---

## Resumen de arquitectura

| Dimensión | Valor |
|---|---|
| Lenguajes | TypeScript (53 ficheros) · JavaScript (2) · HTML (2) · YAML (1) · Python (1) |
| Etiquetas de nodo | 16 — Variable 239 · Function 231 · Section 88 · Route 77 · File 72 · Module 72 · Method 59 · EnvVar 41 · Interface 36 |
| Tipos de arista | 19 — DEFINES · USAGE · CALLS · IMPORTS · CONFIGURES · HTTP_CALLS · HANDLES |
| Rutas HTTP detectadas | 20 (montaje Express + llamadas salientes a Groq, ip-api, Notion) |
| Variables de entorno referenciadas | 41 nodos `EnvVar` |

### Capas y fronteras

- `backend/src` es el núcleo (fan-in alto): todo converge en `llm/claude.ts`, `tools/` y `memory/`.
- `bako-desktop/bako_desktop.py` es un **entry point puro** (solo llamadas salientes): cliente
  independiente que consume la API por HTTP, sin acoplamiento de código con el backend.
- `backend/scripts/` es interno (fan-in 1, fan-out 7): utilidades de setup y seed que dependen de `src`.

### Clusters principales (cohesión)

| Cluster | Miembros | Cohesión | Nodos representativos |
|---|---|---|---|
| Telegram + system prompt | 47 | 0,71 | `startTelegramBot` · `getFullSystemPrompt` · `getAmbientContext` · `buildSystemPrompt` |
| Cliente desktop (Python) | 42 | 0,91 | `_send_and_display` · `_set_status` · `_transcribe` · `_cooling_down` |
| Briefing + Gmail + Notion | 29 | 0,55 | `handleCommand` · `runMorningBriefing` · `getUnreadEmails` · `normalizePrioridad` |
| Acciones sobre Notion | 29 | 0,65 | `getNotionTasks` · `tryExecuteAction` · `findNotionTaskByName` · `createNotionTask` |
| Tiempo + crons + calendario | 27 | 0,59 | `nowInSpain` · `getCalendarEvents` · `isJobEnabled` · `buildWeeklySummary` |
| Memoria cognitiva | 16 | 0,53 | `askClaude` · `generateEmbedding` · `deduplicateAndSave` · `cosineSimilarity` |
| GitHub + issue sync | 16 | 0,55 | `fetchGitHubData` · `getClient` · `buildPRReviews` · `closeIssueSync` |
| Voz y recordatorios | 14 | 0,74 | `sendVoiceReply` · `scheduleReminder` · `generateVoiceBuffer` · `safeVoiceBuffer` |
| Sync Notion → Mongo | 5 | 0,86 | `syncNotionProjectsToMongo` · `applyNotionFields` · `mapEstado` · `mapPrioridad` |
| Seguridad (validación) | 4 | 1,00 | `sanitizeString` · `validateMessage` · `validatePrompt` · `sanitizeTags` |

---

## God nodes / hotspots

| # | Nodo | Fichero | Fan-in | Por qué importa |
|---|---|---|---|---|
| 1 | `askClaude` | [backend/src/llm/claude.ts:211](backend/src/llm/claude.ts#L211) | **15** | Único punto de entrada al LLM. Toda la cadena Ollama→Groq→OpenRouter pasa por aquí; cualquier cambio afecta a Telegram, PWA, Desktop, briefing y crons. |
| 2 | `getClient` (GitHub) | [backend/src/tools/github.ts](backend/src/tools/github.ts) | 9 | Cliente HTTP compartido por repos, commits, PRs, issues y PR Review. |
| 3 | `nowInSpain` | [backend/src/tools/time.ts](backend/src/tools/time.ts) | 9 | Toda la lógica horaria (contexto ambiental, crons, tracker, calendar) depende de esta función. |

Otros con fan-in ≥ 7: `getNotionTasks`, `isJobEnabled`, `getCalendarEvents`.
En el cliente Python: `_set_status` (11) y `_cooling_down` (7).

**Funciones más complejas por fan-out** (candidatas a refactor): `applyNotionFields` (10 salidas),
`buildSystemPrompt` (9), `closeIssueSync` (8), `buildTechRadar` (8).

---

## Preguntas sugeridas para explorar el grafo

- `trace_path` sobre `askClaude` → qué rompe si se cambia la cadena de fallback de LLM.
- `search_graph` con `label:"EnvVar"` → las 41 variables de entorno realmente usadas frente a las
  documentadas en `backend/.env.example` y `render.yaml`.
- `search_graph` con `label:"Route"` → inventario de endpoints antes de tocar auth o rate limiting.
- `trace_path` sobre `getFullSystemPrompt` → qué alimenta el system prompt y dónde se recorta el
  presupuesto de caracteres.
- `detect_changes` antes de cerrar cualquier refactor → blast radius real del diff sin commitear.

---

## Coste

| | graphify (antes) | codebase-memory-mcp (ahora) |
|---|---|---|
| Motor | Python + NetworkX + LLM para clustering/etiquetado | C + tree-sitter, sin LLM |
| Coste de indexado | Tokens de API en cada rebuild con etiquetado | $0 |
| Artefactos en git | `graphify-out/` ~1,3 MB versionados | Ninguno (SQLite fuera del repo) |
| Reindexado | `graphify update .` en cada hook | `index_repository` incremental bajo demanda |
