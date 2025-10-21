// tools/fetchStories.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Parser from 'rss-parser';

export function registerFetchStories(server: McpServer) {
  server.tool('fetch_stories', {
    title: 'Story Fetch Tool',
    description: 'Fetch micro-stories from Fiction on the Web RSS feed, optionally filtered by genre.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          default: 40,
          description: 'Number of stories to fetch'
        },
        genre: {
          type: 'string',
          description: 'Optional genre filter (e.g., "sci-fi", "horror"); case-insensitive partial match on title/description'
        }
      },
      required: []
    },
    outputSchema: {
      type: 'object',
      properties: {
        stories: {
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
      required: ['stories']
    }
  }, async (args) => {
    const { count = 40, genre = '' } = args;
    const genreLower = genre.toLowerCase();
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
          console.log('Extracted thumb for story:', thumbnail);
        }
      } catch (e) {
        console.warn('Thumbnail extract failed:', e);
        thumbnail = null;
      }
      return thumbnail;
    }

    try {
      const feedUrl = 'https://www.fictionontheweb.co.uk/feeds/posts/default?alt=rss';
      const feed = await parser.parseURL(feedUrl);
      let items: any[] = (feed.items || []).slice(0, count * 2);

      if (genreLower) {
        const originalLen = items.length;
        items = items.filter((item: any) => {
          const title = (item.title || '').toLowerCase();
          const desc = (item.contentSnippet || item.description || '').toLowerCase();
          return title.includes(genreLower) || desc.includes(genreLower);
        });
        console.log(`Genre filter "${genreLower}": ${originalLen} -> ${items.length} items`);
      }

      interface StoryItem {
        title: string;
        description: string;
        link: string;
        pubDate?: string;
        _source: string;
        thumbnail?: string | null;
      }

      const stories: StoryItem[] = items.slice(0, count).map((item: any) => ({
        title: item.title || 'Untitled Story',
        description: item.contentSnippet || item.description || '',
        link: item.link || '#',
        pubDate: item.pubDate || '',
        _source: 'Fiction on the Web',
        thumbnail: extractThumbnail(item)
      }));

      const output = { stories };

      console.log(`Fetched ${stories.length} story(ies) ${genre ? `for genre "${genre}"` : ''}...`);

      return {
        content: stories.map((story) => ({
          type: 'text',
          text: `${story.title}\n${story.description.substring(0, 200)}...\n${story.link}`
        })),
        structuredContent: output
      };
    } catch (error) {
      console.error('Error fetching stories:', error);
      return {
        content: [{ type: 'text', text: `Error fetching stories: ${error}` }],
        isError: true
      };
    }
  });
}