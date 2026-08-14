# plan.md — BAKO

> Plan de trabajo vivo (Spec-Driven Development). Contexto, arquitectura y metodología en [spec.md](spec.md).
> Reglas: nada se implementa sin su punto aquí · al terminar se marca `[x]` con fecha ·
> las tareas grandes se desglosan en fases antes de empezar.
> Fusiona el antiguo `ROADMAP.md` (eliminado el 14/08/2026; su detalle punto por punto vive en el
> historial de git).

---

## Estado actual (14/08/2026)

| Horizonte / fase | Estado |
|---|---|
| **Horizonte 0** — los 5 gaps del mayordomo (memoria, ejecución, proactividad, acceso, conocimiento vivo) | ✅ Cerrado |
| Fase 5 — Email inteligente (Gmail) | ✅ |
| Fase 6 — Redes sociales | ⛔ Diferida (APIs de pago) |
| Fase 7 — Panel de administración | ✅ |
| Fase 7b — Memoria cognitiva (A/B/C/D) | ✅ |
| Fase 7c — Rate limits de Groq | ⏳ 3 de 4 pasos |
| Fase 8 — Automatización sin n8n | ✅ |
| Fase 9 — Wake word y modo conversación | ⏳ PWA escritorio sí; móvil y Desktop pendientes |
| **Seguridad** — hardening y retirada de secretos | ⏳ Falta rotar y purgar credenciales |
| **Tooling** — Spec-Driven + grafo `codebase-memory-mcp` | ✅ 14/08/2026 |
| Horizonte 2 — BAKO inteligente (patrones, multi-agente, fine-tuning) | ❌ No empezado |
| Horizonte 3 — Identidad propia (visión, dispositivos, casa) | ❌ No empezado |
| Horizonte 4 — Presencia física (robótica) | ❌ No empezado |

### Pendiente inmediato

- [ ] **Rotar las credenciales filtradas** — la URI de MongoDB Atlas con contraseña y el
  `GOOGLE_CLIENT_SECRET` estuvieron en el árbol de trabajo de un repositorio público y **siguen en el
  historial de git**. Retirarlas del working tree (hecho el 10/08/2026) no basta.
  - [ ] Rotar la contraseña del usuario de MongoDB Atlas y actualizar `MONGODB_URI` en Render y en las dos máquinas
  - [ ] Regenerar el client secret de OAuth en Google Cloud Console y re-autorizar (`auth-google.ts`)
  - [ ] Decidir con **git-master** si se purga el historial (`git filter-repo`) o se asume, dado que el repo es público y ya fue clonable
- [ ] Verificar que el hook pre-commit de `scripts/check-secrets.js` está instalado en **las dos**
  máquinas (`node scripts/check-secrets.js --install`)
- [ ] Verificar en producción la capa de Notion adaptada a "Centro de Mando" (commit `fa05fb4`):
  crear y cerrar una tarea de prueba desde Telegram y comprobar prioridad P1..P4 y "Fecha objetivo"

---

## Fase 7c — Rate limits de Groq ⏳

- [x] Paso 1 — routing por complejidad con regex determinista (07/06/2026)
- [x] Paso 2 — fallback multi-proveedor Groq → OpenRouter → re-throw del 429 (07/06/2026)
- [x] Paso 3 — prompt siempre compact en los endpoints desktop + captura del 413 (08/06/2026)
- [ ] Paso 4 — **cache de respuestas frecuentes** (opcional): briefing y agenda cacheados 5 min en
  MongoDB, ~20 % menos tokens. Implementar solo si vuelven a aparecer 429 en uso normal
- [ ] Revisar periódicamente la cadena de OpenRouter: los modelos gratuitos cambian y devuelven 404;
  consultar `/api/v1/models` cuando ocurra

## Fase 9 — Wake word y modo conversación ⏳

- [x] PWA escritorio — botón 👂, `SpeechRecognition(continuous:true)` detecta "bako", modo
  conversación con VAD nativa del navegador, timeout de 20 s (09/06/2026)
- [x] Desktop — OpenWakeWord opt-in (`BAKO_WAKE_WORD=1`), modelo `hey_jarvis` como placeholder
  fonético (08/06/2026)
- [ ] **Desktop — VAD por amplitud** en `_record_loop` (Python) para auto-stop tras silencio; hoy
  sigue en push-to-talk después de la palabra de activación
- [ ] **Móvil — wake word sin clics (WebAudio VAD).** `SpeechRecognition(continuous:true)` provoca un
  clic del sistema en cada reinicio (~5 s), así que está desactivado por detección de UA
  1. `getUserMedia` abre el micro una sola vez (un único clic de activación)
  2. `AudioContext` + `AnalyserNode` monitorizan el volumen sin `SpeechRecognition`
  3. Al superar el umbral de amplitud, lanzar `SpeechRecognition` una vez para capturar la frase
  4. Si aparece "bako" → modo conversación; si no → volver a escuchar volumen
  - Trade-off: falsos positivos en entornos ruidosos. La detección exacta exigiría un modelo ONNX en
    JS (TensorFlow.js + openwakeword), alta complejidad
  - Con la pantalla bloqueada es imposible en una PWA (el SO congela el JS): requeriría app nativa
- [ ] Modelo de wake word propio: ~30 grabaciones de "Bako" → ONNX, sustituye a `hey_jarvis`

## Fase 6 — Redes sociales ⛔ Diferida

- [ ] Twitter/X + LinkedIn — **bloqueada**: ambas APIs requieren plan de pago y el invariante es
  $0/mes. Reevaluar solo si aparece una vía gratuita
- [ ] Cola de posts en MongoDB, BAKO genera y publica con confirmación
- [ ] Modo automático con calendario editorial

## Pendientes sueltos de fases cerradas

- [ ] Confirmación explícita antes de ejecutar acciones irreversibles distintas del email (hoy se
  confía en la interpretación del LLM) — Gap 2
- [ ] Perfil dinámico v2: hoy `ProfileOverride` solo cubre edad, ubicación, empleador, situación
  laboral y oficina. Proyectos y rutina siguen en `profile.ts` — mover al panel admin — Gap 5
- [ ] Widget de chat público en bohdeveloper.com (diferido desde la Fase 7)
- [ ] Edición de perfil ampliada en el panel admin (más campos que `ProfileOverride`)

---

## Horizonte 1 — Cerrar BAKO como asistente completo

Lo que queda del horizonte son los pendientes de arriba (7c paso 4, Fase 9 móvil/Desktop, Fase 6
diferida). Cuando esos se cierren, el horizonte está completo.

## Horizonte 2 — BAKO inteligente (~1-2 años)

### Fase 10 — Aprendizaje de patrones
- [ ] Analizar commits, tareas y rutinas para detectar patrones ("llevas 3 días sin avanzar en
  Diamadmin — ¿bloqueado?")
- [ ] Adaptar el briefing a la energía histórica por día de la semana

### Fase 11 — Orquestación multi-agente
Patrón ReAct propio, sin CrewAI ni dependencias externas. Un orquestador reparte y un verificador
valida las salidas antes de ejecutar.

| Agente | Rol | Herramientas clave |
|---|---|---|
| Dev Agent | Analiza código, genera componentes, revisa PRs, detecta bugs, genera tests | github_read/write, code_analyzer, code_generator |
| PM Agent | Gestiona sprints de Diamadmin y Unyona, prioriza, detecta deuda técnica | github_read, notion_read/write |
| Research Agent | Investiga tecnologías, compara librerías, sintetiza docs y papers | web_search, web_fetch, scraper, rss_reader |
| Learning Agent | Tutor de IA/ML, guía las fases del proyecto JARVIS | web_search, web_fetch, code_analyzer |
| Content Agent | Posts para bohdeveloper, copy, READMEs, SEO | web_search, file_read/write |
| Ops Agent | Monitoriza deploys Cloudflare/Vercel, analiza logs, audita seguridad | cloudflare_api, vercel_api |
| Ideas Agent | Valida micro-SaaS, analiza competencia, estima esfuerzo | web_search, scraper |

### Fase 12 — Fine-tuning con datos propios
- [ ] Entrenar Llama 3.2 3B o Mistral 7B con conversaciones, estilo de código y forma de comunicar

## Horizonte 3 — IA con identidad propia (~2-3 años)

- **Fase 13 — Visión:** OpenCV · YOLOv8 fine-tuneado · MediaPipe + FaceNet · ORB-SLAM2 · fusión de
  sensores con filtro de Kalman
- **Fase 14 — Multi-dispositivo:** app React Native · extensión de navegador · integración VS Code
- **Fase 15 — Casa inteligente:** Raspberry Pi como hub · luces/temperatura/música por voz ·
  "modo trabajo" · alertas físicas por LED

## Horizonte 4 — Presencia física / JARVIS (~3-5 años)

- **Fase 16 — Plataforma robótica:** Pi 4/5 8 GB + Arduino · chasis con encoders · CAD e impresión 3D
- **Fase 17 — Percepción:** cámara estéreo · micrófono de campo amplio · ultrasónico, IMU, LiDAR
- **Fase 18 — Autonomía:** ROS2 + nav2 · Gazebo (sim-to-real) · Stable-Baselines3 · Jetson Nano/Orin
- Presupuesto incremental: 1.500-3.000 €

## Ruta de aprendizaje IA/ML (prerequisito de los Horizontes 2+)

Punto de partida: nivel cero en IA/ML sobre una base fullstack sólida.

| Fase | Contenido | Duración | Recursos |
|---|---|---|---|
| A — Fundamentos | Álgebra lineal, cálculo, probabilidad + NumPy/Pandas/Matplotlib | Meses 1-3 | 3Blue1Brown, Andrew Ng (audit), StatQuest, Kaggle |
| B — ML clásico + NN | scikit-learn, regresión/clasificación, primera red Keras (MNIST) | Meses 3-6 | ML Specialization, Hands-On ML caps. 1-4 |
| C — Deep Learning + NLP | CNN, Transformers, fine-tune BERT, chatbot en Pi | Meses 6-18 | FastAI, Hugging Face NLP Course, CS224N |
| D — Visión + robótica | OpenCV, YOLOv8, SLAM, ROS2, sim-to-real con Gazebo | Meses 18-48 | Ultralytics, CS231N, ROS2 docs |

Hitos: mes 6 primera red neuronal · mes 14 chatbot en Raspberry Pi · mes 24 YOLOv8 custom +
reconocimiento facial · mes 36 navegación autónoma · mes 48+ sistema JARVIS integrado.
Presupuesto: 0-150 € (GPU cloud para entrenamientos pesados).

---

## Histórico de fases completadas

<details>
<summary><b>Tooling — Spec-Driven Development y migración del grafo (14/08/2026)</b></summary>

- `spec.md` y `plan.md` creados; `ROADMAP.md` fusionado aquí y eliminado
- `README.md` reescrito contra el estado real; `CLAUDE.md` unificado en la raíz
- **Grafo de código migrado de `graphify` a `codebase-memory-mcp`**: motor en C con tree-sitter, sin
  LLM y sin coste de tokens. `graphify-out/` (~1,3 MB versionados) eliminado del repo, `.mcp.json`
  declarado, `GRAPH_REPORT.md` regenerado en la raíz, hooks de `.claude/settings.json` reescritos
- Subagentes `git-master`, `ux-ui-designer` y `seo-master` instalados en `.claude/agents/` y
  versionados para que viajen entre las dos máquinas
</details>

<details>
<summary><b>Seguridad — hardening y retirada de secretos (junio y agosto 2026)</b></summary>

- Hardening completo: `helmet` con CSP, CORS con allowlist, rate limiters por familia de endpoint,
  validación y sanitización centralizadas, límite de 256 KB por request, error handler global que
  oculta stack traces en producción (commit `c302eb4`)
- Secretos retirados del árbol de trabajo: `import-borja-context-v2.ts` tenía la URI de Atlas con
  usuario y contraseña; `.env.example` tenía un `GOOGLE_CLIENT_SECRET` real (commit `fa05fb4`)
- `scripts/check-secrets.js`: escanea el índice antes de cada commit y aborta si encuentra
  credenciales de Mongo, Google, GitHub, Groq, Notion, Telegram, Anthropic/OpenAI o claves PEM;
  `.gitignore` reforzado (commit `99c0c80`)
- Notion adaptado al esquema "Centro de Mando": nombres de propiedad en constantes, relación de
  proyecto, `normalizePrioridad` → P1..P4, `normalizeEstadoTarea` → "Hecho", consultas paginadas
</details>

<details>
<summary><b>Horizonte 0 — Los cinco gaps del mayordomo</b></summary>

**Gap 1 — Memoria.** Colección `Memory` con tipo/importancia/fuente/tags · extracción automática
asíncrona tras cada conversación · carga por tiers con presupuesto de caracteres · comandos naturales
("recuerda que…", "olvida…", `/memorias`) · sin extracción en mensajes sensibles · saneada eliminando
`source: 'manual'` una vez las colecciones estructuradas cubrieron ese conocimiento.

**Gap 2 — Ejecución.** Crear tareas y cambiar estados en Notion · crear eventos en Google Calendar ·
sincronización bidireccional de issues GitHub+Notion · marcar el Tracker por voz ("completé el
Kronoshin", "no pude ir a BIZIKI porque llovía") · recordatorios internos con `setTimeout` y aviso
por voz.

**Gap 3 — Proactividad.** Briefing 05:45 (L-V) · resumen semanal viernes 18:00 · alerta de Tracker
vacío 22:00 · alertas inteligentes 08:30 (días sin commits, PRs sin actividad, reuniones) · motor de
reglas configurables evaluadas por LLM (`/regla`, `/reglas`, `/borrarregla`).

**Gap 4 — Acceso sin fricción.** Lenguaje natural sin comandos, con remap semántico de intenciones
(tareas→Tracker, eventos→Calendar, proyectos→Notion) · personalidad de 10 parámetros con 3 presets ·
estado de ánimo dinámico en 6 estados · 6 voces TTS vía `/voz` · correcciones fonéticas de Whisper
(Paco→BAKO) · respuestas por debajo de 2 s.

**Gap 5 — Conocimiento vivo.** `ProfileOverride` en MongoDB con prioridad sobre `profile.ts` ·
`buildDynamicProfileContext()` · actualización por lenguaje natural ("ya no trabajo en Inetum") ·
`/perfil` para ver y editar · historial de cambios con `prevValue` · alerta los lunes a las 09:00 si
un campo lleva 90+ días sin tocarse.
</details>

<details>
<summary><b>Fase 7b — Memoria cognitiva (junio 2026)</b></summary>

Convertir 103 memorias planas en un sistema cognitivo estructurado, semántico y auto-actualizable,
manteniendo el coste en $0.

- **7b-A — Colecciones estructuradas:** `People`, `Projects` y `KnowledgeEntry` en MongoDB con API
  REST completa y panel admin (5 columnas, drag & drop con `PATCH /reorder`) · formateo a prosa
  natural en el system prompt · deduplicación algorítmica en 3 pasadas sin LLM · migración desde
  `profile.ts` sin LLM (familia, 9 proyectos incluida Operación Galego, 19 entradas de conocimiento)
  · limpieza de memorias `source: 'manual'` · system prompt optimizado eliminando el JSON de
  `BAKO_PROFILE` (~3.000 chars redundantes)
- **7b-B — Embeddings:** `nomic-embed-text` (768d) en background al guardar, con fallback a
  Cloudflare Workers AI `bge-small-en-v1.5` (384d) · campos `embedding`/`embeddingDim`/`embeddingModel`
  · endpoint de backfill y botón en el panel
- **7b-C — Búsqueda semántica:** `getMemories(query)` con similitud coseno en Node.js, top-15, con
  caída a tiers si el embedding falla o hay pocos candidatos
- **7b-D — Modificación activa:** `deduplicateAndSave()` busca similares ≥ 0,85 excluyendo
  `source: 'manual'` y un prompt mínimo decide ACTUALIZAR o CREAR — "ya no voy a BIZIKI" actualiza en
  vez de duplicar

Resultado: ~20 registros ricos (~800 chars) sustituyen a 33 fragmentos planos (~1.800 chars).
</details>

<details>
<summary><b>Fases 5, 7 y 8 — Email, panel admin y automatización (junio 2026)</b></summary>

- **Fase 5 — Gmail:** `/email` lista los correos sin leer por voz y texto · redacción por voz con
  preview y botones inline [Enviar] [Borrador] [Cancelar] · envío vía `drafts.send`, nunca sin
  confirmación · presencia en el briefing matutino
- **Fase 7 — Panel admin** integrado en la PWA: auth JWT con roles superadmin/user y gestión de
  usuarios · pestaña Memorias con badges de tier e importancia, búsqueda en tiempo real, filtros,
  edición inline sobre Atlas, creación y borrado
- **Fase 8 — Automatización sin n8n**, dentro de `ProactivityService`: Tech Radar los lunes a las
  09:30 (5 feeds filtrados por LLM) · PR Review automático L-V 08:30 (diff de GitHub analizado como
  senior dev) · `/automaticos` con 7 crons conmutables persistidos en `AutoConfig`
</details>

<details>
<summary><b>Clientes — PWA, Desktop y Web Push (junio 2026)</b></summary>

- **PWA v1→v4:** chat con burbujas e historial · input de texto · revisión de transcripción con
  countdown (`REVIEW_TIMEOUT` 5 s → 10 s) · modo claro/oscuro · pull-to-refresh · mic inline ·
  interrupción de BAKO con `AbortController` e icono stop rojo · 63 presets en 11 categorías ·
  badge de LLM en la navbar con refresco cada 60 s · limpiar chat pulsando en "BAKO"
- **Desktop v1→v4:** GUI tkinter con el mismo lenguaje visual · hotkey global `Ctrl+Alt+B` ·
  auth JWT compartida · `llama3.2:3b` con prompt compacto y `num_ctx` 2048
- **Web Push:** `sw.js` + `PushSubscription` en MongoDB + `/api/push` — notificaciones nativas con la
  app cerrada · voz al tocar la notificación vía `postMessage` (evita la restricción de autoplay)
- **Endpoints desktop:** `/api/desktop/voice`, `/text`, `/transcribe`, `/stream`
</details>

<details>
<summary><b>Contexto, LLM y correcciones (junio 2026)</b></summary>

- Groq `llama-3.3-70b-versatile` tras la retirada de `gemma2-9b-it` · cadena OpenRouter de 5 modelos
  con skip en 404 y re-throw del 429
- Geolocalización por IP (`ip-api.com`, caché 30 min): clima y previsión siguen a la ubicación real
- Ubicación por rutina: Inetum L-V 7-15 h, Errentería el resto, con override manual "estoy en X"
- Weather con semántica temporal en 5 ramas (pasado, ahora, mañana, esta semana, defecto) y caché de
  10 min; Errentería→Donostia por cobertura de datos
- Tracker siempre con datos frescos de D1 cuando se menciona, con respuesta explícita
  "completada" / "no completada: motivo" / "pendiente"
- Calendar en tiempo real distinguiendo eventos pasados y futuros, sin extraer eventos a memoria
- Temperatura 0,4 y `max_tokens` 400 para respuestas precisas · "No le entiendo, señor" ante
  mensajes ininteligibles · instrucción anti-alucinación con los emails en contexto
- Fix del clasificador: `\b` en JavaScript no reconoce vocales acentuadas — "¿Lloverá mañana?" se
  clasificaba como compleja y agotaba el TPD de Groq en ~21 peticiones (commit `f2f7dba`)
- Noticias en español con feeds de actualidad (El Confidencial, 20minutos, La Vanguardia) y resumen
  traducido por LLM
- 101 memorias importadas desde 10/10 XMLs de contexto (ver [KNOWLEDGE.md](KNOWLEDGE.md))
</details>

---

## Hitos personales vinculados

| Meta | Parte de BAKO que la sostiene |
|---|---|
| Diamadmin en producción con usuarios | PM Agent + Dev Agent + ejecución de acciones |
| Unyona validada con leads reales | Content Agent + Ideas Agent |
| Portfolio que consigue clientes | Blog comments + IA pública (Fase 7) |
| Aprender IA/ML en profundidad | Learning Agent guía la ruta de aprendizaje |
| Vivir en Galicia trabajando en remoto | BAKO viaja contigo: misma experiencia en cualquier sitio |
| JARVIS físico funcional | Horizontes 3 y 4 |
