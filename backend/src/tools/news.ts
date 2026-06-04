import Parser from 'rss-parser';

const parser = new Parser();

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
}

const DEFAULT_FEEDS = [
  { url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', name: 'El País' },
  { url: 'https://news.ycombinator.com/rss', name: 'Hacker News' },
];

const TECH_FEEDS = [
  { url: 'https://javascriptweekly.com/rss',       name: 'JS Weekly' },
  { url: 'https://nodeweekly.com/rss',              name: 'Node Weekly' },
  { url: 'https://react.statuscode.com/rss',        name: 'React Status' },
  { url: 'https://news.ycombinator.com/rss',        name: 'Hacker News' },
  { url: 'https://tldr.tech/api/rss/ai',            name: 'TLDR AI' },
];

export interface TechRadarItem {
  title:  string;
  source: string;
  link:   string;
  date:   string;
}

export async function getTechRadarItems(maxPerFeed = 5): Promise<TechRadarItem[]> {
  const results: TechRadarItem[] = [];

  await Promise.all(
    TECH_FEEDS.map(async ({ url, name }) => {
      try {
        const feed = await parser.parseURL(url);
        feed.items.slice(0, maxPerFeed).forEach(item => {
          results.push({
            title:  item.title ?? 'Sin título',
            source: name,
            link:   item.link ?? '',
            date:   item.pubDate ?? '',
          });
        });
      } catch {
        // feed no disponible esta semana — ignorar
      }
    })
  );

  // Más recientes primero
  return results
    .filter(i => i.title.length > 10)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 30); // máximo 30 para el LLM
}

export async function getNews(maxItems = 5): Promise<NewsItem[]> {
  const results: NewsItem[] = [];

  await Promise.all(
    DEFAULT_FEEDS.map(async ({ url, name }) => {
      try {
        const feed = await parser.parseURL(url);
        feed.items.slice(0, 3).forEach(item => {
          results.push({
            title: item.title ?? 'Sin título',
            source: name,
            publishedAt: item.pubDate ?? '',
          });
        });
      } catch (err) {
        console.warn(`⚠️  Feed ${name} no disponible:`, (err as Error).message);
      }
    })
  );

  return results
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, maxItems);
}
