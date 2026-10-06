/**
 * Fase 11 — Agentes especializados. Cada uno es un rol y un puñado de herramientas de SOLO
 * LECTURA sobre integraciones que ya existen; ninguno escribe (ver react.ts).
 *
 * Diferidos (plan.md, Fase 11): Research e Ideas (no hay buscador web gratuito y fiable), Ops
 * (APIs de despliegue sin configurar), Content y Learning (no tienen herramientas propias).
 */

import { AgentDef } from './react';
import { getNotionTasks, getNotionProjects } from '../tools/notion';
import { getUserRepos, getRecentCommits, getOpenPRs, getPRDetails, getPRFiles, fetchGitHubData } from '../tools/github';
import { rachaActual, DIAS_RACHA } from '../tools/patrones';

const sinFiltro = (s: unknown) => String(s ?? '').trim().toLowerCase();

// El LLM elige estos valores y algunas observaciones traen texto ajeno (cuerpos de PR, commits):
// sin validar, una inyección podría desviar la petición autenticada a otra ruta de la API
const repoValido = (s: unknown) => typeof s === 'string' && /^[\w.-]{1,100}$/.test(s) && !s.includes('..');
const numeroValido = (n: unknown) => Number.isInteger(Number(n)) && Number(n) > 0;

const pmAgent: AgentDef = {
  id: 'pm',
  nombre: 'PM Agent',
  descripcion: 'Gestión de proyectos: estado de tareas y proyectos en Notion, prioridades, qué está parado, qué hacer después.',
  rol: 'Eres el PM Agent de BAKO: jefe de proyecto. Miras tareas, proyectos y actividad para decir qué va bien, qué está parado y qué conviene priorizar.',
  tools: [
    {
      name: 'ver_tareas_abiertas',
      description: 'Tareas abiertas en Notion con su estado, prioridad, proyecto y fecha. Filtro opcional por proyecto.',
      parameters: { type: 'object', properties: { proyecto: { type: ['string', 'null'], description: 'Solo si el señor nombra un proyecto concreto: parte de su nombre. Si no, omítelo' } } },
      run: async (args) => {
        const filtro = sinFiltro(args.proyecto);
        const tareas = (await getNotionTasks()).filter(t => !filtro || t.proyecto.toLowerCase().includes(filtro));
        if (!tareas.length) return filtro ? `No hay tareas abiertas en proyectos que contengan "${args.proyecto}".` : 'No hay tareas abiertas.';
        // El recuento va primero: la observación se recorta y, con 50 tareas, la lista sola no cabe
        const porProyecto = new Map<string, number>();
        for (const t of tareas) porProyecto.set(t.proyecto || 'General', (porProyecto.get(t.proyecto || 'General') ?? 0) + 1);
        const recuento = [...porProyecto].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}: ${n}`).join(' · ');
        return `${tareas.length} tareas abiertas. Por proyecto: ${recuento}\nPrimeras por prioridad:\n` + tareas.slice(0, 12)
          .map(t => `- ${t.nombre} · ${t.estado || 'sin estado'} · ${t.prioridad || 'sin prioridad'} · ${t.proyecto || 'General'}${t.fechaLimite ? ` · fecha ${t.fechaLimite}` : ''}`)
          .join('\n');
      },
    },
    {
      name: 'ver_proyectos',
      description: 'Proyectos de Notion que no están cerrados, con estado y siguiente acción.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const proyectos = await getNotionProjects();
        if (!proyectos.length) return 'No hay proyectos abiertos.';
        return proyectos.map(p => `- ${p.nombre} · ${p.estado}${p.siguiente_accion ? ` · siguiente: ${p.siguiente_accion}` : ''}`).join('\n');
      },
    },
    {
      name: 'ver_proyecto_parado',
      description: 'El proyecto con tareas abiertas que más días lleva sin commits (patrones de la Fase 10).',
      parameters: { type: 'object', properties: {} },
      run: async () => (await rachaActual()) ?? `Ningún proyecto vigilado lleva ${DIAS_RACHA} días o más sin commits con tareas abiertas.`,
    },
    {
      name: 'ver_actividad_github',
      description: 'Actividad de las últimas 24 horas en GitHub: commits y pull requests abiertos.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const gh = await fetchGitHubData();
        const commits = gh.recentCommits.map(c => `- ${c.repo}: ${c.message}`).slice(0, 15).join('\n') || '- ninguno';
        const prs = gh.openPRs.map(p => `- ${p.repo} #${p.number}: ${p.title}`).join('\n') || '- ninguno';
        return `Commits en 24 h:\n${commits}\nPRs abiertos:\n${prs}`;
      },
    },
  ],
};

const devAgent: AgentDef = {
  id: 'dev',
  nombre: 'Dev Agent',
  descripcion: 'Desarrollo: repositorios, commits recientes, pull requests abiertos y revisión del código de un PR.',
  rol: 'Eres el Dev Agent de BAKO: desarrollador senior. Revisas repos, commits y pull requests, y señalas riesgos o fallos con criterio técnico.',
  tools: [
    {
      name: 'ver_repos',
      description: 'Repositorios del señor ordenados por último push.',
      parameters: { type: 'object', properties: {} },
      run: async () => (await getUserRepos())
        .map(r => `- ${r.name}${r.isPrivate ? ' (privado)' : ''} · último push ${r.lastPushed.slice(0, 10)} · ${r.openIssuesCount} issues${r.description ? ` · ${r.description}` : ''}`)
        .join('\n') || 'Sin repositorios.',
    },
    {
      name: 'ver_commits',
      description: 'Commits recientes de un repositorio.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Nombre del repositorio' },
          dias: { type: ['number', 'null'], description: 'Días hacia atrás (1-30, por defecto 7)' },
        },
        required: ['repo'],
      },
      run: async (args) => {
        const owner = process.env.GITHUB_USERNAME;
        if (!owner) return 'GitHub no está configurado.';
        if (!repoValido(args.repo)) return 'Nombre de repositorio no válido.';
        const dias = Math.min(Math.max(Number(args.dias) || 7, 1), 30);
        const commits = await getRecentCommits(owner, String(args.repo), new Date(Date.now() - dias * 864e5));
        return commits.length
          ? commits.map(c => `- ${c.date.slice(0, 10)} ${c.message}`).join('\n')
          : `Sin commits en ${args.repo} en los últimos ${dias} días (o el repo no existe).`;
      },
    },
    {
      name: 'ver_prs_abiertos',
      description: 'Pull requests abiertos en todos los repositorios.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        // Solo PRs: fetchGitHubData pediría también commits e issues de cada repo
        const owner = process.env.GITHUB_USERNAME;
        if (!owner) return 'GitHub no está configurado.';
        const repos = await getUserRepos();
        const prs = (await Promise.all(repos.map(r => getOpenPRs(owner, r.name)))).flat();
        return prs.map(p => `- ${p.repo} #${p.number}: ${p.title} (actualizado ${p.updatedAt.slice(0, 10)})`).join('\n') || 'No hay PRs abiertos.';
      },
    },
    {
      name: 'ver_pr',
      description: 'Detalle y diff resumido de un pull request concreto, para revisarlo.',
      parameters: {
        type: 'object',
        properties: { repo: { type: 'string' }, numero: { type: 'number', description: 'Número del PR' } },
        required: ['repo', 'numero'],
      },
      run: async (args) => {
        if (!repoValido(args.repo) || !numeroValido(args.numero)) return 'Repositorio o número de PR no válidos.';
        const repo = String(args.repo);
        const n = Number(args.numero);
        const [det, files] = await Promise.all([getPRDetails(repo, n), getPRFiles(repo, n)]);
        if (!det) return `No encuentro el PR #${n} en ${repo}.`;
        const diff = files.slice(0, 6).map(f => `### ${f.filename} (+${f.additions} -${f.deletions})\n${(f.patch ?? '').slice(0, 300)}`).join('\n');
        return `PR #${n}: ${det.title} · ${det.commits} commits · +${det.additions} -${det.deletions}\n${det.body.slice(0, 200)}\n${diff}`;
      },
    },
  ],
};

export const AGENTES: AgentDef[] = [pmAgent, devAgent];
