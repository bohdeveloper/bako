# BAKO — Base de Conocimiento

> Todo lo que BAKO sabe sobre su señor. Fuentes, categorías, estado.

---

## Arquitectura del conocimiento

```
profile.ts          → datos estáticos base (identidad, rutina, trabajo)
ProfileOverride     → actualizaciones dinámicas sobre profile.ts (MongoDB)
People              → personas en la vida de Borja (MongoDB)
Projects            → proyectos activos y pausados (MongoDB)
KnowledgeEntry      → conocimiento profundo categorizado (MongoDB)
Memory              → hechos dinámicos extraídos de conversaciones (MongoDB)
```

**Regla:** `ProfileOverride` tiene prioridad sobre `profile.ts`. Las colecciones estructuradas (People/Projects/KnowledgeEntry) cubren todo el conocimiento estable. `Memory` solo contiene hechos extraídos de conversaciones (`source: 'extracted'`).

---

## Conocimiento Personal Profundo

| Categoría | Fuente | Estado |
|---|---|---|
| Datos básicos (edad, cumpleaños, ubicación) | profile.ts | ✅ |
| Situación laboral actual | profile.ts (LAE corregido 03/06/2026) | ✅ |
| Proyectos personales vs profesional | profile.ts + `Projects` | ✅ |
| Rutina diaria y entrenamiento | profile.ts | ✅ |
| Familia y relaciones personales | `People` (pareja, padres, hermana, cuñada, abuelos, amigos, suegros) | ✅ |
| Gustos y preferencias (comida, música, ocio) | `KnowledgeEntry` (categoría hobbies/otro) | ✅ |
| Historia personal y momentos clave | `KnowledgeEntry` (categoría historia) | ✅ |
| Miedos, motivaciones y valores | `KnowledgeEntry` (categorías valores, carácter) | ✅ |
| Salud y bienestar | `KnowledgeEntry` (categoría salud — digestión, sueño, suplementos, dieta) | ✅ |
| Objetivos vitales más allá de BAKO | `KnowledgeEntry` (categoría objetivos) + `Projects` (Operación Galego) | ✅ |
| Finanzas y situación económica | `KnowledgeEntry` (categoría finanzas) | ✅ |
| Carácter: cómo se describe Borja a sí mismo | `KnowledgeEntry` (categoría carácter) | ✅ |

**Cómo ampliar:** Abrir Claude Code y decir "quiero que BAKO me conozca mejor — hazme preguntas personales". Claude hace las preguntas, se importan como memorias o entradas en KnowledgeEntry.

---

## Asimilación de XMLs de contexto

Proceso para importar XMLs de roles, proyectos e información personal.

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

> Progreso: 10/10 completados ✅ (reimportados el 03/06/2026)

**Cómo continuar si hay nuevos XMLs:** Abrir Claude Code, decir "vamos a continuar con los XMLs" y pegar el contenido. Claude tiene el contexto completo del proceso.

---

## Gestión desde el panel admin

- **Pestaña Personas** — CRUD completo, drag & drop para reordenar
- **Pestaña Proyectos** — CRUD completo, drag & drop, campo "Siguiente acción"
- **Pestaña Conocimiento** — CRUD de KnowledgeEntry por categoría e importancia
- **Pestaña Memorias** — listar, buscar, filtrar, editar, crear, eliminar memorias dinámicas
- **Botón "Generar embeddings"** — backfill de embeddings para memorias sin vector
- **Botón "Limpiar memorias manuales"** — elimina `source: 'manual'` (ya cubiertas por colecciones)

---

## Comandos de memoria desde Telegram/PWA

```
"Bako, recuerda que X"           → guarda en Memory (source: manual)
"Bako, olvida X"                  → elimina memoria relacionada
"/memorias"                        → lista las últimas memorias activas
"/memorias [tema]"                 → busca memorias por tema
```
