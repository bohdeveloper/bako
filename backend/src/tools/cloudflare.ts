import axios from 'axios';

const BASE = 'https://api.cloudflare.com/client/v4';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function getDbId(): string {
  const id = process.env.CLOUDFLARE_D1_DB_ID;
  if (!id) throw new Error('CLOUDFLARE_D1_DB_ID no definido en .env');
  return id;
}

function getAccountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error('CLOUDFLARE_ACCOUNT_ID no definido en .env');
  return id;
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { data } = await axios.post(
    `${BASE}/accounts/${getAccountId()}/d1/database/${getDbId()}/query`,
    { sql, params },
    { headers: getHeaders() }
  );
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? 'D1 query failed');
  return data.result[0].results as T[];
}

// ─── Timezone ─────────────────────────────────────────────────────────────────

export function nowInSpain(): Date {
  // Use formatToParts to avoid toLocaleString parsing ambiguity on UTC servers
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  const h = parseInt(p.hour);
  return new Date(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    h === 24 ? 0 : h, parseInt(p.minute), parseInt(p.second));
}

export function todayStringSpain(): string {
  const d = nowInSpain();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Blog comments ────────────────────────────────────────────────────────────

export interface BlogComment {
  id: number;
  alias: string;
  body: string;
  created_at: string;
  approved: number;
  post_title: string;
  post_slug: string;
}

export async function getBlogComments(onlyNew = false): Promise<BlogComment[]> {
  const since = onlyNew ? (() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })() : '2000-01-01';

  return query<BlogComment>(
    `SELECT bc.id, bc.alias, bc.body, bc.created_at, bc.approved,
            bp.title AS post_title, bp.slug AS post_slug
     FROM blog_comments bc
     JOIN blog_posts bp ON bc.post_id = bp.id
     WHERE bc.created_at >= ? AND bc.approved = 1
     ORDER BY bc.created_at DESC
     LIMIT 10`,
    [since]
  );
}

export function formatCommentsForSpeech(comments: BlogComment[]): string {
  if (comments.length === 0) return 'No hay comentarios nuevos en el blog.';

  const byPost = new Map<string, BlogComment[]>();
  for (const c of comments) {
    const key = c.post_title;
    if (!byPost.has(key)) byPost.set(key, []);
    byPost.get(key)!.push(c);
  }

  const parts: string[] = [`Tiene ${comments.length} comentario${comments.length > 1 ? 's' : ''} en el blog.`];

  for (const [title, cms] of byPost.entries()) {
    const shortTitle = title.length > 50 ? title.slice(0, 47) + '...' : title;
    parts.push(`En "${shortTitle}": ${cms.map(c => `${c.alias} dice: ${c.body}`).join('. Además, ')}.`);
  }

  return parts.join(' ');
}
