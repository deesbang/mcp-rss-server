// tools/fetchMemes.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Parser from 'rss-parser';

export function registerFetchMemes(server: McpServer) {
  server.tool('fetch_memes', {
    title: 'Meme Fetch Tool',
    description: 'Fetch recent memes from fun RSS feeds (e.g., Cheezburger or Reddit).',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          default: 10,
          description: 'Max memes'
        }
      },
      required: []
    },
    outputSchema: {
      type: 'object',
      properties: {
        memes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              link: { type: 'string' },
              pubDate: { type: 'string', nullable: true },
              _source: { type: 'string' },
              thumbnail: { type: 'string', nullable: true }
            },
            required: ['title', 'description', 'link', '_source']
          }
        }
      },
      required: ['memes']
    }
  }, async (args) => {
    const { count = 10 } = args;
    const parser = new Parser({
      customFields: {
        item: [
          ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
          ['media:content', 'mediaContent', { keepArray: true }]
        ]
      }
    });

    function extractThumbnail(item: any): string | null {
      let thumbnail: string | null = null;
      try {
        if (item.enclosure?.url) {
          thumbnail = item.enclosure.url;
        } else if (item.mediaThumbnail) {
          const thumbs = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [item.mediaThumbnail];
          if (thumbs.length > 0) {
            const sortedThumbs = thumbs.sort((a: any, b: any) => {
              const wa = parseInt(a?.$?.width || '0');
              const wb = parseInt(b?.$?.width || '0');
              return wb - wa;
            });
            const thumbObj = sortedThumbs[0];
            thumbnail = thumbObj?.$?.url || thumbObj?.url || null;
          }
        } else if (item.mediaContent) {
          const contents = Array.isArray(item.mediaContent) ? item.mediaContent : [item.mediaContent];
          for (const content of contents) {
            if (content?.$?.url) {
              thumbnail = content.$.url;
              break;
            }
            const nested = content['media:thumbnail'] || content.mediaThumbnail;
            if (nested) {
              const nestedThumbs = Array.isArray(nested) ? nested : [nested];
              if (nestedThumbs.length > 0) {
                const nThumb = nestedThumbs[0];
                thumbnail = nThumb?.$?.url || nThumb?.url || null;
                if (thumbnail) break;
              }
            }
          }
        } else if (item.thumbnail) {
          thumbnail = typeof item.thumbnail === 'string'
            ? item.thumbnail
            : (item.thumbnail?.$?.url || item.thumbnail?.url || null);
        } else if (item.contentSnippet || item.description || item.content) {
          const desc = (item.contentSnippet || item.description || item.content || '') as string;
          const imgMatch = desc.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
          if (imgMatch && imgMatch[1]) {
            thumbnail = imgMatch[1].trim();
          }
        }
        if (typeof thumbnail !== 'string' || thumbnail.trim().length <= 10 || !/^https?:\/\//i.test(thumbnail)) {
          thumbnail = null;
        } else {
          console.log('Extracted thumb for top post:', thumbnail);
        }
      } catch (e) {
        console.warn('Thumbnail extract failed:', e);
        thumbnail = null;
      }
      return thumbnail;
    }

    interface MemeItem {
      title: string;
      description: string;
      link: string;
      pubDate?: string;
      _source: string;
      thumbnail?: string | null;
    }

    const memeFeeds = [
      'https://memebase.cheezburger.com/rss',
      'https://www.reddit.com/r/memes/.rss'
    ];
    let allMemes: MemeItem[] = [];
    for (const url of memeFeeds) {
      try {
        const feed = await parser.parseURL(url);
        const memes: MemeItem[] = (feed.items || []).slice(0, count).map((item: any) => ({
          title: item.title || 'Untitled Meme',
          description: item.contentSnippet || item.description || '',
          link: item.link || '#',
          pubDate: item.pubDate || '',
          _source: (() => {
            try {
              return new URL(url).hostname.replace('www.', '');
            } catch {
              return 'Unknown';
            }
          })(),
          thumbnail: extractThumbnail(item)
        }));
        allMemes = allMemes.concat(memes);
      } catch (e) {
        console.warn(`Meme feed failed: ${url}`, e);
      }
    }
    const uniqueMemes = allMemes.filter((meme, idx, self) => 
      idx === self.findIndex(t => t.title.toLowerCase() === meme.title.toLowerCase())
    );
    const output = { memes: uniqueMemes.slice(0, count) };

    console.log('MCP Memes Output:', output);

    return {
      content: uniqueMemes.map((meme) => ({
        type: 'text',
        text: `${meme.title}\n${meme.description.substring(0, 200)}...\n${meme.link}`
      })),
      structuredContent: output
    };
  });
}