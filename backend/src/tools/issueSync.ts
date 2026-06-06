import { createGitHubIssue, closeGitHubIssue, findGitHubIssueByTitle } from './github';
import { createNotionTask, findNotionTaskByName, updateNotionTaskStatus } from './notion';

export const PROJECT_REPO_MAP: Record<string, string> = {
  bako:      'ai-personal-os',
  unyona:    'unyona',
  diamadmin: 'diamadmin',
};

export function normalizeProject(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('bako') || lower.includes('ai-personal') || lower.includes('personal-os')) return 'bako';
  if (lower.includes('unyona')) return 'unyona';
  if (lower.includes('diamadmin') || lower.includes('diam')) return 'diamadmin';
  return null;
}

export function projectDisplayName(key: string): string {
  const map: Record<string, string> = { bako: 'BAKO', unyona: 'Unyona', diamadmin: 'Diamadmin' };
  return map[key] ?? key;
}

export async function createIssueSync(
  title: string,
  project: string,
  opts: { priority?: string; notes?: string } = {}
): Promise<{ notionId: string | null; ghNumber: number | null; ghUrl: string | null; repo: string | null }> {
  const projectKey  = normalizeProject(project);
  const repo        = projectKey ? PROJECT_REPO_MAP[projectKey] : null;
  const projectName = projectKey ? projectDisplayName(projectKey) : project;

  const [notionResult, ghResult] = await Promise.allSettled([
    createNotionTask(title, { prioridad: opts.priority ?? 'Media', proyecto: projectName }),
    repo
      ? createGitHubIssue(repo, title, opts.notes ?? `Issue creado desde BAKO.\n\n**Proyecto:** ${projectName}\n**Prioridad:** ${opts.priority ?? 'Media'}`)
      : Promise.resolve(null),
  ]);

  return {
    notionId:  notionResult.status === 'fulfilled' ? notionResult.value?.id ?? null : null,
    ghNumber:  ghResult.status === 'fulfilled' && ghResult.value ? (ghResult.value as any).number : null,
    ghUrl:     ghResult.status === 'fulfilled' && ghResult.value ? (ghResult.value as any).url : null,
    repo,
  };
}

export async function closeIssueSync(
  titleOrId: string,
  project?: string
): Promise<{ notionClosed: boolean; ghClosed: boolean; repo: string | null }> {
  const projectKey = project ? normalizeProject(project) : null;
  const repo       = projectKey ? PROJECT_REPO_MAP[projectKey] : null;

  const notionTask = await findNotionTaskByName(titleOrId).catch(() => null);
  const notionClosed = !!(notionTask);
  if (notionTask) {
    await updateNotionTaskStatus(notionTask.id, 'Completada').catch(() => {});
  }

  let ghClosed = false;
  if (repo) {
    const issueNumber = await findGitHubIssueByTitle(repo, titleOrId).catch(() => null);
    if (issueNumber) {
      await closeGitHubIssue(repo, issueNumber).catch(() => {});
      ghClosed = true;
    }
  }

  return { notionClosed, ghClosed, repo };
}
