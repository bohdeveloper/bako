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
