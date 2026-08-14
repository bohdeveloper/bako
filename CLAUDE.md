# CLAUDE.md — Reglas de trabajo en BAKO

> Este archivo se carga en cada sesión de Claude Code. Contiene **cómo se trabaja**, no qué es el
> proyecto: el conocimiento vive en [spec.md](spec.md) y el trabajo pendiente en [plan.md](plan.md).
> Trabaja siempre en **español**.

---

## Spec-Driven Development (OBLIGATORIO)

1. **Al empezar**, lee [spec.md](spec.md) §3 (invariantes) y §6 (metodología), y [plan.md](plan.md).
2. **Nada se implementa sin su punto en `plan.md`.** Si la tarea no está, añádela antes de tocar
   código. Las tareas grandes se desglosan en fases primero.
3. **Contrasta con los invariantes de §3** antes de proponer nada y avisa si la petición choca con
   alguno (coste $0, repo público sin secretos, Notion como fuente de verdad, privacidad local…).
4. **Al terminar**, registra: marca el punto en `plan.md` con la fecha · las decisiones nuevas de
   producto o arquitectura van a `spec.md` §3 · los cambios de alcance o de stack, a `README.md`.
5. Antes de cerrar cualquier feature: `npm run build` en `backend/`, **`/code-review` sobre el diff**
   y `/security-review` si se ha tocado auth, privacidad, secretos o endpoints.

---

## Grafo de código — codebase-memory-mcp

El repositorio está indexado como proyecto **`C-aplic-bako`** (servidor declarado en
[.mcp.json](.mcp.json); reporte en [GRAPH_REPORT.md](GRAPH_REPORT.md)).

- Ejecuta `get_graph_schema` **antes de la primera consulta** de cada sesión.
- Para arquitectura, dependencias o "quién llama a qué", usa `get_architecture`, `search_graph`,
  `trace_path`, `query_graph` y `get_code_snippet` **en vez de releer ficheros enteros** o barrer con
  Grep. Lee el código en crudo para modificar o depurar algo concreto, o cuando el grafo no tenga el
  detalle.
- **Nunca inventes una relación**: si `search_graph` no la encuentra, dilo en lugar de asumirla.
- Usa `detect_changes` antes de dar por bueno un refactor grande — muestra el blast radius real.
- Reindexa tras cambios grandes:
  `codebase-memory-mcp cli index_repository '{"repo_path":"C:/aplic/bako"}'`.
  El hook `Stop` de `.claude/settings.json` ya lo hace de forma incremental al final de cada sesión.

---

## Subagentes y skills

Delega en el subagente cuando la tarea sea su especialidad — están en `.claude/agents/` y versionados:

| Agente | Para qué |
|---|---|
| **git-master** | Git no trivial: conflictos, rebase, divergencias con el remoto, estrategia de ramas, reflog, limpieza de historia (incluida la purga de secretos filtrados). No para un commit rutinario |
| **ux-ui-designer** | Todo lo visual: PWA, panel admin, GUI del Desktop, sistema de diseño, responsive, accesibilidad. **Invócalo antes de maquetar UI nueva** |
| **seo-master** | Indexabilidad y posicionamiento: metadatos, Open Graph, manifest, datos estructurados, Core Web Vitals |

Skills más usadas: `/code-review` (obligatoria antes de cerrar), `/security-review` y
`/security-master` (seguridad), `/grafo-designer` (grafo), `/spec-driven` (sincronizar spec y plan),
`/claude-api` (antes de tocar integraciones con modelos), `/simplify` (cierre de fase).
La tabla completa está en [spec.md](spec.md) §6.

---

## Entorno y particularidades

- **Repositorio público.** Ningún secreto entra en git jamás. El hook `scripts/check-secrets.js`
  aborta el commit si detecta credenciales; si salta, **no lo esquives** — arregla el origen.
- **Nunca levantes el backend local mientras Render está sirviendo**: dos instancias del bot de
  Telegram duplican mensajes. Si arrancas algo para verificar, ciérralo al terminar.
- **Commits solo cuando el usuario los pida** (él revisa el diff). Estilo del `git log`:
  `tipo: descripción en español`, con cuerpo que explique el porqué, no el qué.
- Dos máquinas: el PC del trabajo va sin Ollama (usa Groq); el de casa lo expone por el túnel
  Cloudflare. No asumas que Ollama está disponible.
