import Parser from 'rss-parser';
import { AutoConfig } from '../memory/AutoConfig';

const parser = new Parser();

export interface NewsItem {
  title:       string;
  source:      string;
  publishedAt: string;
}

// Todos los feeds disponibles — ninguno de política general
export const PRESET_FEEDS: Record<string, { url: string; name: string }> = {
  hacker_news:     { url: 'https://news.ycombinator.com/rss',                         name: 'Hacker News' },
  xataka:          { url: 'https://feeds.xataka.com/xataka/portada',                  name: 'Xataka' },
  tldr_tech:       { url: 'https://tldr.tech/api/rss/tech',                           name: 'TLDR Tech' },
  bbc_tech:        { url: 'http://feeds.bbci.co.uk/news/technology/rss.xml',          name: 'BBC Tech' },
  mit_tech:        { url: 'https://www.technologyreview.com/feed/',                    name: 'MIT Tech Review' },
  the_verge:       { url: 'https://www.theverge.com/rss/index.xml',                   name: 'The Verge' },
  meneame:         { url: 'https://www.meneame.net/rss',                              name: 'Menéame' },
  // Actualidad española
  el_confidencial: { url: 'https://rss.elconfidencial.com/espana/',                   name: 'El Confidencial' },
  veinte_minutos:  { url: 'https://www.20minutos.es/rss/',                            name: '20minutos' },
  la_vanguardia:   { url: 'https://www.lavanguardia.com/mvc/feed/rss/home',           name: 'La Vanguardia' },
};

const DEFAULT_FEED_KEYS = ['hacker_news', 'xataka'];

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
      } catch { /* feed no disponible esta semana — ignorar */ }
    })
  );

  return results
    .filter(i => i.title.length > 10)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 30);
}

async function getActiveFeeds(): Promise<Array<{ url: string; name: string }>> {
  try {
    const cfg = await AutoConfig.findOne({ key: 'news_feeds' });
    if (cfg?.value) {
      const items: Array<{ key?: string; url?: string; name?: string }> = JSON.parse(cfg.value);
      const feeds = items
        .map(item => {
          if (item.key && PRESET_FEEDS[item.key]) return PRESET_FEEDS[item.key];
          if (item.url && item.name) return { url: item.url, name: item.name };
          return null;
        })
        .filter(Boolean) as Array<{ url: string; name: string }>;
      if (feeds.length > 0) return feeds;
    }
  } catch { /* usar defaults */ }
  return DEFAULT_FEED_KEYS.map(k => PRESET_FEEDS[k]);
}

export async function getNews(maxItems = 5): Promise<NewsItem[]> {
  const feeds = await getActiveFeeds();
  const results: NewsItem[] = [];

  await Promise.all(
    feeds.map(async ({ url, name }) => {
      try {
        const feed = await parser.parseURL(url);
        feed.items.slice(0, 3).forEach(item => {
          results.push({
            title:       item.title ?? 'Sin título',
            source:      name,
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
