// tools/generatePostsFromRss.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Parser from 'rss-parser';

export function registerGeneratePostsFromRss(server: McpServer) {
  server.tool('generate_posts_from_rss', {
    title: 'RSS to Social Posts Generator',
    description: 'Fetch latest from RSS feed and generate unique tweet/X-style posts (280-char summaries w/ emojis/CTAs). Varied phrasing each call.',
    inputSchema: {
      type: 'object',
      properties: {
        rssUrl: {
          type: 'string',
          default: 'https://memebase.cheezburger.com/rss',
          description: 'RSS feed URL (e.g., memes, stories, or any)'
        },
        count: {
          type: 'number',
          default: 5,
          description: 'Number of posts to generate (1-10)'
        },
        style: {
          type: 'string',
          enum: ['tweet', 'reddit'],
          default: 'tweet',
          description: 'Post style (tweet: 280-char w/ emojis; reddit: title + body)'
        }
      },
      required: []
    },
    outputSchema: {
      type: 'object',
      properties: {
        posts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              postText: { type: 'string' },
              title: { type: 'string' },
              link: { type: 'string' },
              pubDate: { type: 'string', nullable: true },
              _source: { type: 'string' },
              thumbnail: { type: 'string', nullable: true }
            },
            required: ['postText', 'title', 'link', '_source']
          }
        }
      },
      required: ['posts']
    }
  }, async (args) => {
    const { rssUrl = 'https://memebase.cheezburger.com/rss', count = 5, style = 'tweet' } = args;
    const parser = new Parser({
      customFields: {
        item: [
          ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
          ['media:content', 'mediaContent', { keepArray: true }]
        ]
      }
    });

    function extractThumbnail(item: any): string | null {
      // Shared extractor (same as memes/stories)
      let thumbnail: string | null = null;
      try {
        if (item.enclosure?.url) {
          thumbnail = item.enclosure.url;
        } else if (item.mediaThumbnail) {
          const thumbs = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [item.mediaThumbnail];
          if (thumbs.length > 0) {
            const sortedThumbs = thumbs.sort((a: any, b: any) => parseInt(b?.$?.width || '0') - parseInt(a?.$?.width || '0'));
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
          thumbnail = typeof item.thumbnail === 'string' ? item.thumbnail : (item.thumbnail?.$?.url || item.thumbnail?.url || null);
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
          console.log('Extracted thumb for post:', thumbnail);
        }
      } catch (e) {
        console.warn('Thumbnail extract failed:', e);
        thumbnail = null;
      }
      return thumbnail;
    }

    function generatePostText(item: any, style: string): string {
      const seed = Date.now() + Math.random();  // Varied phrasing
      const rand = Math.floor(seed % 10);
      const emojis = ['🔥', '😂', '🤯', '👀', '💥'][rand % 5];
      const cta = style === 'reddit' ? 'Discuss below!' : 'What do you think? Reply!';

      if (style === 'tweet') {
        const hook = item.title.substring(0, 100) + '...';
        return `${emojis} ${hook} ${cta} #Memes #DailyLaugh ${item.link}`;
      } else {  // reddit
        return `**${item.title}**\n\n${item.description.substring(0, 500)}...\n\nSource: ${item.link}\n\n${cta}`;
      }
    }

    try {
      const feed = await parser.parseURL(rssUrl);
      let items = (feed.items || []).slice(0, count * 2);  // Extra for variance
      const posts: any[] = items.slice(0, count).map((item: any) => {
        const source = new URL(rssUrl).hostname.replace('www.', '');
        return {
          postText: generatePostText(item, style),
          title: item.title || 'Generated Post',
          link: item.link || '#',
          pubDate: item.pubDate || new Date().toISOString(),
          _source: source,
          thumbnail: extractThumbnail(item)
        };
      });

      const output = { posts };

      console.log('Generated Posts Output:', output);

      return {
        content: posts.map((post: any) => ({
          type: 'text',
          text: post.postText.substring(0, 300) + '...'
        })),
        structuredContent: output
      };
    } catch (error) {
      console.error('Error generating posts from RSS:', error);
      return {
        content: [{ type: 'text', text: `Error generating posts: ${error}` }],
        isError: true
      };
    }
  });
}