import axios from 'axios';

// Cliente creado en la primera llamada real, no al importar el módulo.
// Así dotenv ya ha cargado las variables cuando se lee GITHUB_TOKEN.
let _client: ReturnType<typeof axios.create> | null = null;

function getClient() {
  if (!_client) {
    _client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }
  return _client;
}

export interface RepoSummary {
  name: string;
  fullName: string;
  description: string | null;
  lastPushed: string;
  openIssuesCount: number;
  isPrivate: boolean;
}

export interface CommitSummary {
  repo: string;
  message: string;
  author: string;
  date: string;
}

export interface PullRequest {
  repo: string;
  title: string;
  number: number;
  author: string;
  updatedAt: string;
  url: string;
}

export interface GitHubIssue {
  repo: string;
  number: number;
  title: string;
}

export interface GitHubData {
  repos: RepoSummary[];
  recentCommits: CommitSummary[];
  openPRs: PullRequest[];
  issues: GitHubIssue[];
  fetchedAt: string;
}

export async function getUserRepos(): Promise<RepoSummary[]> {
  const { data } = await getClient().get('/user/repos', {
    params: {
      sort: 'pushed',
      direction: 'desc',
      per_page: 20,
      affiliation: 'owner',
    },
  });

  return data.map((repo: any) => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    lastPushed: repo.pushed_at,
    openIssuesCount: repo.open_issues_count,
    isPrivate: repo.private,
  }));
}

async function getRecentCommits(
  owner: string,
  repo: string,
  since: Date
): Promise<CommitSummary[]> {
  try {
    const { data } = await getClient().get(`/repos/${owner}/${repo}/commits`, {
      params: { since: since.toISOString(), per_page: 10 },
    });

    return data.map((c: any) => ({
      repo,
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name ?? 'Unknown',
      date: c.commit.author?.date ?? '',
    }));
  } catch (err) {
    console.warn(`⚠️  No se pudieron obtener commits de ${repo}:`, (err as Error).message);
    return [];
  }
}

async function getOpenPRs(owner: string, repo: string): Promise<PullRequest[]> {
  try {
    const { data } = await getClient().get(`/repos/${owner}/${repo}/pulls`, {
      params: { state: 'open', per_page: 10 },
    });

    return data.map((pr: any) => ({
      repo,
      title: pr.title,
      number: pr.number,
      author: pr.user?.login ?? 'Unknown',
      updatedAt: pr.updated_at,
      url: pr.html_url,
    }));
  } catch (err) {
    console.warn(`⚠️  No se pudieron obtener PRs de ${repo}:`, (err as Error).message);
    return [];
  }
}

async function getIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
  try {
    const { data } = await getClient().get(`/repos/${owner}/${repo}/issues`, {
      params: { state: 'open', per_page: 10, assignee: owner },
    });
    return data
      .filter((i: any) => !i.pull_request)
      .map((i: any) => ({ repo, number: i.number, title: i.title }));
  } catch (err) {
    console.warn(`⚠️  No se pudieron obtener issues de ${repo}:`, (err as Error).message);
    return [];
  }
}

export async function createGitHubIssue(
  repo: string,
  title: string,
  body?: string
): Promise<{ number: number; url: string; title: string }> {
  const username = process.env.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME no está definido en .env');

  const { data } = await getClient().post(`/repos/${username}/${repo}/issues`, {
    title,
    body: body ?? '',
  });

  return { number: data.number, url: data.html_url, title: data.title };
}

export interface PRFile {
  filename:  string;
  status:    string;
  additions: number;
  deletions: number;
  patch?:    string;
}

export async function getPRFiles(repo: string, prNumber: number): Promise<PRFile[]> {
  const username = process.env.GITHUB_USERNAME;
  if (!username) return [];
  try {
    const { data } = await getClient().get(`/repos/${username}/${repo}/pulls/${prNumber}/files`, {
      params: { per_page: 30 },
    });
    return data.map((f: any) => ({
      filename:  f.filename,
      status:    f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch:     f.patch,
    }));
  } catch {
    return [];
  }
}

export async function getPRDetails(repo: string, prNumber: number): Promise<{
  title: string; body: string; commits: number; additions: number; deletions: number;
} | null> {
  const username = process.env.GITHUB_USERNAME;
  if (!username) return null;
  try {
    const { data } = await getClient().get(`/repos/${username}/${repo}/pulls/${prNumber}`);
    return {
      title:     data.title,
      body:      data.body ?? '',
      commits:   data.commits,
      additions: data.additions,
      deletions: data.deletions,
    };
  } catch {
    return null;
  }
}

export async function fetchGitHubData(): Promise<GitHubData> {
  const username = process.env.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME no está definido en .env');

  const since = new Date();
  since.setHours(since.getHours() - 24);

  const repos = await getUserRepos();

  const [commitsArrays, prsArrays, issuesArrays] = await Promise.all([
    Promise.all(repos.map(r => getRecentCommits(username, r.name, since))),
    Promise.all(repos.map(r => getOpenPRs(username, r.name))),
    Promise.all(repos.map(r => getIssues(username, r.name))),
  ]);

  return {
    repos,
    recentCommits: commitsArrays.flat(),
    openPRs: prsArrays.flat(),
    issues: issuesArrays.flat(),
    fetchedAt: new Date().toISOString(),
  };
}