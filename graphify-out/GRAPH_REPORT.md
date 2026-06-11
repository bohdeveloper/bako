# Graph Report - ai-personal-os  (2026-06-10)

## Corpus Check
- 64 files · ~78,848 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 755 nodes · 1319 edges · 45 communities (40 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e1455baf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Auto-Config & Job Scheduler|Auto-Config & Job Scheduler]]
- [[_COMMUNITY_LLM Orchestration Layer|LLM Orchestration Layer]]
- [[_COMMUNITY_Desktop Client (PythonTkinter)|Desktop Client (Python/Tkinter)]]
- [[_COMMUNITY_Morning Briefing Agent|Morning Briefing Agent]]
- [[_COMMUNITY_Backend Dependencies & Config|Backend Dependencies & Config]]
- [[_COMMUNITY_User Profile — Life Context|User Profile — Life Context]]
- [[_COMMUNITY_Projects & Developer Profile|Projects & Developer Profile]]
- [[_COMMUNITY_Memory Model & Import|Memory Model & Import]]
- [[_COMMUNITY_Telegram Bot Interface|Telegram Bot Interface]]
- [[_COMMUNITY_Desktop API Routes|Desktop API Routes]]
- [[_COMMUNITY_Text-to-Speech Pipeline|Text-to-Speech Pipeline]]
- [[_COMMUNITY_Knowledge Base Docs|Knowledge Base Docs]]
- [[_COMMUNITY_Knowledge Entry Model|Knowledge Entry Model]]
- [[_COMMUNITY_Client Interfaces|Client Interfaces]]
- [[_COMMUNITY_Infrastructure & Integrations Docs|Infrastructure & Integrations Docs]]
- [[_COMMUNITY_LLM & Agent Docs|LLM & Agent Docs]]
- [[_COMMUNITY_Dynamic Profile System|Dynamic Profile System]]
- [[_COMMUNITY_TypeScript Build Config|TypeScript Build Config]]
- [[_COMMUNITY_Auth & User Session|Auth & User Session]]
- [[_COMMUNITY_PWA Manifest Config|PWA Manifest Config]]
- [[_COMMUNITY_Project Tracking Model|Project Tracking Model]]
- [[_COMMUNITY_Push Notification Service|Push Notification Service]]
- [[_COMMUNITY_Gmail Integration|Gmail Integration]]
- [[_COMMUNITY_People  Contacts Model|People / Contacts Model]]
- [[_COMMUNITY_Roadmap Horizon 1|Roadmap Horizon 1]]
- [[_COMMUNITY_Notification Model|Notification Model]]
- [[_COMMUNITY_Auth Middleware & JWT|Auth Middleware & JWT]]
- [[_COMMUNITY_Google OAuth Setup|Google OAuth Setup]]
- [[_COMMUNITY_Notion Database Setup|Notion Database Setup]]
- [[_COMMUNITY_PWA Icon 192px|PWA Icon 192px]]
- [[_COMMUNITY_PWA Icon 512px|PWA Icon 512px]]
- [[_COMMUNITY_Future Multi-Agent|Future: Multi-Agent]]
- [[_COMMUNITY_Graphify Config|Graphify Config]]
- [[_COMMUNITY_Roadmap Horizon 3|Roadmap Horizon 3]]
- [[_COMMUNITY_Roadmap Horizon 4|Roadmap Horizon 4]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]

## God Nodes (most connected - your core abstractions)
1. `BakoDesktopApp` - 52 edges
2. `handleCommand()` - 28 edges
3. `runMorningBriefing()` - 25 edges
4. `askClaude()` - 24 edges
5. `nowInSpain()` - 18 edges
6. `BAKO — Borja's Autonomous Knowledge Operator` - 17 edges
7. `getCalendarEvents()` - 15 edges
8. `sendSystemMessage()` - 13 edges
9. `BAKO — Roadmap completo` - 13 edges
10. `getTrackerSummary()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Admin Panel — PWA Integrated (JWT, Memories, People, Projects, Knowledge)` --references--> `PWA Web Client v4`  [EXTRACTED]
  ROADMAP.md → CLIENTS.md
- `Embeddings — nomic-embed-text (Ollama) + bge-small (CF Workers AI)` --references--> `Cloudflare D1 — Tracker & Blog Data`  [INFERRED]
  ROADMAP.md → README.md
- `Render.com Service Config (bako-ai)` --references--> `msedge-tts — Neural Voice TTS`  [EXTRACTED]
  render.yaml → README.md
- `BAKO Roadmap — All Horizons` --references--> `BAKO — Borja's Autonomous Knowledge Operator`  [EXTRACTED]
  ROADMAP.md → README.md
- `PWA Web Client v4` --references--> `PWA Client UI (index.html)`  [INFERRED]
  CLIENTS.md → backend/public/bako-client/index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **BAKO LLM Fallback Chain: Ollama → Groq → OpenRouter** — readme_md_ollama_local, readme_md_groq_cloud, roadmap_md_openrouter_fallback, readme_md_llm_orchestrator, roadmap_md_classify_query_complexity [EXTRACTED 1.00]
- **BAKO Structured Knowledge Collections (MongoDB Atlas)** — knowledge_md_people_collection, knowledge_md_projects_collection, knowledge_md_knowledge_entry, knowledge_md_memory_collection, knowledge_md_profile_override [EXTRACTED 1.00]
- **BAKO Three Client Interfaces** — clients_md_telegram_bot, clients_md_pwa_client, clients_md_desktop_client [EXTRACTED 1.00]

## Communities (45 total, 5 thin omitted)

### Community 0 - "Auto-Config & Job Scheduler"
Cohesion: 0.08
Nodes (38): AutoConfig, AutoConfigSchema, IAutoConfig, isJobEnabled(), JOB_DEFS, JobDef, setJobEnabled(), toggleJob() (+30 more)

### Community 1 - "LLM Orchestration Layer"
Cohesion: 0.06
Nodes (57): askClaude(), AskClaudeOptions, askGroq(), askOllama(), askOpenRouter(), classifyQueryComplexity(), isGroqRateLimit(), Message (+49 more)

### Community 2 - "Desktop Client (Python/Tkinter)"
Cohesion: 0.08
Nodes (5): BakoDesktopApp, main(), Muestra/oculta el botón admin según el rol., Cancela la petición en curso o detiene el audio., Tk

### Community 3 - "Morning Briefing Agent"
Cohesion: 0.09
Nodes (49): buildNewsText(), buildProjectsText(), buildTasksText(), buildWeatherText(), runMorningBriefing(), run(), buildSmartAlerts(), buildWeeklySummary() (+41 more)

### Community 4 - "Backend Dependencies & Config"
Cohesion: 0.05
Nodes (42): author, dependencies, axios, bcryptjs, cors, dotenv, express, form-data (+34 more)

### Community 5 - "User Profile — Life Context"
Cohesion: 0.05
Nodes (39): estado, requisitos, zona_objetivo, zonas_candidatas, arte_marcial, lugar, running, identidad (+31 more)

### Community 6 - "Projects & Developer Profile"
Cohesion: 0.06
Nodes (32): descripcion, estado, nombre, estado, nombre, stack, tipo, estado (+24 more)

### Community 7 - "Memory Model & Import"
Cohesion: 0.10
Nodes (21): IMemory, Memory, MemoryImportance, MemorySchema, MemorySource, MemoryType, MEMORIES, MEMORIES (+13 more)

### Community 8 - "Telegram Bot Interface"
Cohesion: 0.07
Nodes (23): formatMemoriesForPrompt(), getMemories(), activeReminders, extractReminderMessage(), fixTranscription(), getMemoriesSection(), LlmMode, llmModeLabel() (+15 more)

### Community 9 - "Desktop API Routes"
Cohesion: 0.15
Nodes (18): isOllamaAvailable(), formatKnowledgeForContext(), getCachedOllamaStatus(), getEmailContext(), getFullSystemPrompt(), getMinimalSystemPrompt(), ollamaCache, router (+10 more)

### Community 10 - "Text-to-Speech Pipeline"
Cohesion: 0.17
Nodes (14): safeVoiceBuffer(), sendVoiceReply(), AUDIO_FILE, cleanForVoice(), generateAudio(), generateVoiceBuffer(), getCurrentVoiceKey(), getTTS() (+6 more)

### Community 11 - "Knowledge Base Docs"
Cohesion: 0.17
Nodes (17): BAKO Knowledge Base, KnowledgeEntry Collection (MongoDB), Memory Collection (MongoDB) — Extracted Facts, People Collection (MongoDB), ProfileOverride — Dynamic Profile Overrides, profile.ts — Static Base Profile, Projects Collection (MongoDB), XML Context Import Process (+9 more)

### Community 12 - "Knowledge Entry Model"
Cohesion: 0.16
Nodes (11): CATEGORY_LABELS, IKnowledgeEntry, KnowledgeCategory, KnowledgeEntry, KnowledgeSchema, KNOWLEDGE_FIELDS, router, KNOWLEDGE (+3 more)

### Community 13 - "Client Interfaces"
Cohesion: 0.19
Nodes (14): PWA Client UI (index.html), Desktop Python Client Dependencies, BAKO Client Access Channels, Desktop Python Client, JWT Authentication, PWA Web Client v4, React Native App (Pending — Horizonte 1), Telegram Bot Client (+6 more)

### Community 14 - "Infrastructure & Integrations Docs"
Cohesion: 0.18
Nodes (14): BAKO Backend — Express + TypeScript, Cloudflare D1 — Tracker & Blog Data, Cloudflare Tunnel — Render to Local Ollama, GitHub Tool (repos, commits, PRs, issues), Google Calendar OAuth2 Integration, MongoDB Atlas — Conversation History & Collections, News RSS Tool (El País, Hacker News), Notion Tool (Tasks & Projects) (+6 more)

### Community 15 - "LLM & Agent Docs"
Cohesion: 0.24
Nodes (12): Groq Cloud LLM (Llama 3.3 70B + Whisper STT), Groq Whisper — Speech-to-Text, isOllamaAvailable() — LLM Routing Check, LLM Orchestrator (src/llm/claude.ts), msedge-tts — Neural Voice TTS, Ollama Local LLM (qwen2.5-coder:7b / llama3.2:3b), Privacy System — Local/Cloud Routing by Sensitivity, Telegram Handler (src/tools/telegram.ts) (+4 more)

### Community 16 - "Dynamic Profile System"
Cohesion: 0.19
Nodes (11): BAKO_PROFILE, IProfileOverride, ProfileOverride, ProfileOverrideSchema, buildDynamicProfileContext(), checkStaleFields(), detectProfileUpdate(), getNestedValue() (+3 more)

### Community 17 - "TypeScript Build Config"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, module, outDir, rootDir, skipLibCheck, strict, target (+4 more)

### Community 18 - "Auth & User Session"
Cohesion: 0.22
Nodes (6): IUser, User, UserSchema, router, app, startTelegramBot()

### Community 19 - "PWA Manifest Config"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 20 - "Project Tracking Model"
Cohesion: 0.22
Nodes (8): formatProjectForContext(), IProject, Project, ProjectPriority, ProjectSchema, ProjectState, PROJECT_FIELDS, router

### Community 21 - "Push Notification Service"
Cohesion: 0.29
Nodes (7): IPushSubscription, PushSubscription, PushSubscriptionSchema, router, ensureVapid(), sendPushToAll(), toBase64url()

### Community 22 - "Gmail Integration"
Cohesion: 0.31
Nodes (7): createDraft(), getAuth(), getEmailBody(), GmailMessage, markAsRead(), sendDraft(), sendEmail()

### Community 23 - "People / Contacts Model"
Cohesion: 0.33
Nodes (5): formatPersonForContext(), IPerson, Person, PersonRelation, PersonSchema

### Community 24 - "Roadmap Horizon 1"
Cohesion: 0.33
Nodes (7): Admin Panel — PWA Integrated (JWT, Memories, People, Projects, Knowledge), Gmail Integration — Read, Draft, Send, Horizonte 1 — BAKO Complete as Assistant, PR Review Automation (LLM as Senior Dev), ProactivityService — Cron Jobs & Automation, Tech Radar Weekly Automation, Wake Word — OpenWakeWord (Phase 9, Pending)

### Community 25 - "Notification Model"
Cohesion: 0.40
Nodes (4): INotification, Notification, NotificationSchema, router

### Community 26 - "Auth Middleware & JWT"
Cohesion: 0.24
Nodes (8): AuthPayload, Request, requireAuth(), requireSuperAdmin(), signToken(), router, router, router

### Community 27 - "Google OAuth Setup"
Cohesion: 0.40
Nodes (3): CREDENTIALS_PATH, SCOPES, TOKEN_PATH

### Community 28 - "Notion Database Setup"
Cohesion: 0.60
Nodes (4): api, createDatabase(), createPage(), main()

### Community 29 - "PWA Icon 192px"
Cohesion: 0.67
Nodes (3): Bako PWA App Icon (192px), Bako Brand Identity, PWA Web App Manifest

### Community 30 - "PWA Icon 512px"
Cohesion: 1.00
Nodes (3): Bako App Icon 512px, BAKO Brand Name Typography, Teal/Cyan Background Color Scheme

### Community 37 - "Community 37"
Cohesion: 0.04
Nodes (48): Arquitectura objetivo (todo en servicios gratuitos existentes), BAKO — Roadmap completo, Borja's Autonomous Knowledge Operator, El problema actual, Estado actual — MVP en producción, Estado de implementación, Fase 10 — Aprendizaje de patrones, Fase 11 — Orquestación multi-agente (+40 more)

### Community 38 - "Community 38"
Cohesion: 0.13
Nodes (14): Activar Web Push (primera vez en cada dispositivo), App React Native (pendiente — Horizonte 1), Arranque automático con Windows, BAKO — Clientes de acceso, Características, Características, Configuración (variables de entorno opcionales), Instalación en Android (Chrome) (+6 more)

### Community 39 - "Community 39"
Cohesion: 0.14
Nodes (13): 1. Clonar y preparar el proyecto, 2. Configurar el .env, 3. Configuración específica por máquina, 4. Verificación final, 5. Credenciales en Render (producción), BAKO — Guía de instalación en máquina nueva, Estado configuración PC de casa, Google Calendar Token (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (11): Arquitectura del sistema, BAKO — Borja's Autonomous Knowledge Operator, Comandos de Telegram, Estructura del proyecto, Flujo completo de una conversación, La filosofía, Lo que viene — próximos pasos, MorningBriefingAgent (+3 more)

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (6): PrivacyError, ITask, Task, TaskSchema, TaskStatus, router

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (6): Arquitectura del conocimiento, Asimilación de XMLs de contexto, BAKO — Base de Conocimiento, Comandos de memoria desde Telegram/PWA, Conocimiento Personal Profundo, Gestión desde el panel admin

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (6): Configurar autostart en Windows + Cloudflare Tunnel, Configurar Google Calendar (una sola vez), Instalación y puesta en marcha, Local, Producción (Render.com), Requisitos

## Knowledge Gaps
- **326 isolated node(s):** `name`, `version`, `main`, `dev`, `build` (+321 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `sendSystemMessage()` connect `Auto-Config & Job Scheduler` to `Telegram Bot Interface`, `Notification Model`, `Text-to-Speech Pipeline`, `Push Notification Service`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `handleCommand()` connect `Morning Briefing Agent` to `Auto-Config & Job Scheduler`, `LLM Orchestration Layer`, `Memory Model & Import`, `Telegram Bot Interface`, `Desktop API Routes`, `Text-to-Speech Pipeline`, `Dynamic Profile System`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `askClaude()` connect `LLM Orchestration Layer` to `Auto-Config & Job Scheduler`, `Morning Briefing Agent`, `Memory Model & Import`, `Telegram Bot Interface`, `Community 41`, `Desktop API Routes`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `version`, `main` to the rest of the system?**
  _328 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Auto-Config & Job Scheduler` be split into smaller, more focused modules?**
  _Cohesion score 0.08084163898117387 - nodes in this community are weakly interconnected._
- **Should `LLM Orchestration Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.06293706293706294 - nodes in this community are weakly interconnected._
- **Should `Desktop Client (Python/Tkinter)` be split into smaller, more focused modules?**
  _Cohesion score 0.07792207792207792 - nodes in this community are weakly interconnected._