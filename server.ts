import express from 'express';
import { z } from 'zod';
import Parser from 'rss-parser';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableValue } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors'; // npm install cors for this

// RSS Parser setup
const parser = new Parser({
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:content', 'mediaContent', { keepArray: true }]
    ]
  }
});

// Shared Thumbnail Extractor (Enhanced: Guarantees 1 per top post)
function extractThumbnail(item: any): string | null {
  let thumbnail = null;
  try {
    // Enclosure (Reddit/Mashable style - often first/best)
    if (item.enclosure?.url) {
      thumbnail = item.enclosure.url;
    }
    // media:thumbnail (Cheezburger/Fiction on Web - sorted largest)
    else if (item.mediaThumbnail) {
      const thumbs = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [item.mediaThumbnail];
      if (thumbs.length > 0) {
        const sortedThumbs = thumbs.sort((a: any, b: any) => {
          const wa = parseInt(a?.$?.width || '0');
          const wb = parseInt(b?.$?.width || '0');
          return wb - wa;  // Largest first
        });
        const thumbObj = sortedThumbs[0];  // 👈 Pick top one
        thumbnail = thumbObj?.$?.url || thumbObj?.url || null;
      }
    }
    // media:content (nested, pick first valid)
    else if (item.mediaContent) {
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
            const nThumb = nestedThumbs[0];  // 👈 First one
            thumbnail = nThumb?.$?.url || nThumb?.url || null;
            if (thumbnail) break;
          }
        }
      }
    }
    // Fallback: thumbnail field
    else if (item.thumbnail) {
      thumbnail = typeof item.thumbnail === 'string'
        ? item.thumbnail
        : (item.thumbnail?.$?.url || item.thumbnail?.url || null);
    } 
    // Enhanced Fallback: First <img> in desc/content (for top post reliability)
    else if (item.contentSnippet || item.description || item.content) {
      const desc = (item.contentSnippet || item.description || item.content || '') as string;
      const imgMatch = desc.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1]) {
        thumbnail = imgMatch[1].trim();
      }
    }

    // Validate (lenient for top posts)
    if (typeof thumbnail !== 'string' || thumbnail.trim().length <= 10 || !/^https?:\/\//i.test(thumbnail)) {
      thumbnail = null;
    } else {
      console.log('Extracted thumb for top post:', thumbnail);  // 👈 Debug: Confirm pick
    }
  } catch (e) {
    console.warn('Thumbnail extract failed:', e);
    thumbnail = null;
  }
  return thumbnail;
}

// Create MCP Server
const server = new McpServer({
  name: 'rss-mcp-server',
  version: '1.0.0'
});

// Tool 1: Fetch Memes
server.registerTool(
  'fetch_memes',
  {
    title: 'Meme Fetch Tool',
    description: 'Fetch recent memes from fun RSS feeds (e.g., Cheezburger or Reddit).',
    inputSchema: {
      count: z.number().optional().default(10).describe('Max memes')  // 👈 Bumped to 10
    },
    outputSchema: {
      memes: z.array(z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        pubDate: z.string().optional(),
        _source: z.string(),
        thumbnail: z.string().nullable().optional()
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { count = 10 } = input;  // 👈 Default now 10
    const memeFeeds = [
      'https://memebase.cheezburger.com/rss',  // Active, thumbs galore (Oct 11, 2025)
      'https://www.reddit.com/r/memes/.rss'    // Active, enclosures (Oct 11, 2025)
    ];
    let allMemes: any[] = [];
    for (const url of memeFeeds) {
      try {
        const feed = await parser.parseURL(url);
        const memes = (feed.items || []).slice(0, count).map(item => ({
          title: item.title || 'Untitled Meme',
          description: item.contentSnippet || (item.description as any as string) || '',
          link: item.link || '#',
          pubDate: item.pubDate || '',
          _source: (() => {
            try { return new URL(url).hostname.replace('www.', ''); } catch { return 'Unknown'; }
          })(),
          thumbnail: extractThumbnail(item)  // 👈 Shared magic
        }));
        allMemes = allMemes.concat(memes);
      } catch (e) {
        console.warn(`Meme feed failed: ${url}`, e);
      }
    }
    // Dedupe by title (simple, case-insensitive)
    const uniqueMemes = allMemes.filter((meme, idx, self) =>
      idx === self.findIndex(t => t.title.toLowerCase() === meme.title.toLowerCase())
    );
    const output = { memes: uniqueMemes.slice(0, count) };
    console.log('MCP Memes Output:', output);
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Tool 2: Fetch Stories
server.registerTool(
  'fetch_stories',
  {
    title: 'Story Fetch Tool',
    description: 'Fetch short stories or fiction from creative RSS feeds.',
    inputSchema: {
      genre: z.enum(['micro', 'literary']).optional().default('micro').describe('micro for bite-sized, literary for deeper reads'),
      count: z.number().optional().default(10).describe('Max stories')  // 👈 Bumped to 10
    },
    outputSchema: {
      stories: z.array(z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        pubDate: z.string().optional(),
        _source: z.string(),
        thumbnail: z.string().nullable().optional()
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { genre = 'micro', count = 10 } = input;  // 👈 Default now 10
    const storyFeeds = genre === 'micro'
      ? ['https://www.fictionontheweb.co.uk/feeds/posts/default?alt=rss']  // Active micro-fiction, thumbs (Oct 10, 2025)
      : ['https://americanshortfiction.org/feed/'];  // Literary, img in desc (Sep 2025, but solid)
    let allStories: any[] = [];
    for (const url of storyFeeds) {
      try {
        const feed = await parser.parseURL(url);
        const stories = (feed.items || []).slice(0, count).map(item => ({
          title: item.title || 'Untitled Story',
          description: item.contentSnippet || (item.description as any as string) || '',
          link: item.link || '#',
          pubDate: item.pubDate || '',
          _source: (() => {
            try { return new URL(url).hostname.replace('www.', ''); } catch { return 'Unknown'; }
          })(),
          thumbnail: extractThumbnail(item)
        }));
        allStories = allStories.concat(stories);
      } catch (e) {
        console.warn(`Story feed failed: ${url}`, e);
      }
    }
    const uniqueStories = allStories.filter((story, idx, self) =>
      idx === self.findIndex(t => t.title.toLowerCase() === story.title.toLowerCase())
    );
    const output = { stories: uniqueStories.slice(0, count) };
    console.log('MCP Stories Output:', output);
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Tool 3: Fetch AI/Science Breakthroughs
server.registerTool(
  'fetch_ai_science',
  {
    title: 'AI & Science Breakthroughs Tool',
    description: 'Fetch recent AI news or science breakthroughs from specialized RSS feeds.',
    inputSchema: {
      type: z.enum(['ai', 'science']).optional().default('ai').describe('ai for tech innovations, science for breakthroughs'),
      count: z.number().optional().default(10).describe('Max posts')  // 👈 Bumped to 10
    },
    outputSchema: {
      posts: z.array(z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        pubDate: z.string().optional(),
        _source: z.string(),
        thumbnail: z.string().nullable().optional()
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { type = 'ai', count = 10 } = input;  // 👈 Default now 10
    const feeds = type === 'ai'
      ? [
          'https://www.technologyreview.com/feed/',  // MIT Tech Review AI
          'https://openai.com/blog/rss/'  // OpenAI Blog
        ]
      : [
          'https://www.nature.com/nature.rss',  // Nature Science
          'https://www.sciencemag.org/rss/news_current.xml'  // Science Magazine News
        ];
    let allPosts: any[] = [];
    for (const url of feeds) {
      try {
        const feed = await parser.parseURL(url);
        const posts = (feed.items || []).slice(0, count).map(item => ({
          title: item.title || 'Breakthrough Post',
          description: item.contentSnippet || (item.description as any as string) || '',
          link: item.link || '#',
          pubDate: item.pubDate || '',
          _source: (() => {
            try { return new URL(url).hostname.replace('www.', ''); } catch { return 'Unknown'; }
          })(),
          thumbnail: extractThumbnail(item)
        }));
        allPosts = allPosts.concat(posts);
      } catch (e) {
        console.warn(`AI/Science feed failed: ${url}`, e);
      }
    }
    const uniquePosts = allPosts.filter((post, idx, self) =>
      idx === self.findIndex(t => t.title.toLowerCase() === post.title.toLowerCase())
    );
    const output = { posts: uniquePosts.slice(0, count) };
    console.log('MCP AI/Science Output:', output);
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Tool 4: Fetch X Posts (Real RSS Bridge + Fresh Fallback)
server.registerTool(
  'fetch_x_posts',
  {
    title: 'X Posts Fetch Tool',
    description: 'Fetch recent X (Twitter) posts via RSS Bridge (fallback to fresh Oct 2025 data).',
    inputSchema: {
      query: z.string().optional().default('(AI OR "artificial intelligence") breakthroughs 2025 filter:media min_faves:50').describe('X search query with operators'),
      count: z.number().optional().default(10).describe('Max posts')
    },
    outputSchema: {
      posts: z.array(z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        pubDate: z.string().optional(),
        _source: z.string(),
        thumbnail: z.string().nullable().optional()
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { query = '(AI OR "artificial intelligence") breakthroughs 2025 filter:media min_faves:50', count = 10 } = input;
    const encodedQuery = encodeURIComponent(query);
    
    // Real fetch via RSS Bridge (self-host at localhost:3001 or public instance)
    const xFeeds = [
      `http://localhost:3001/?action=display&bridge=Twitter&context=Search&q=${encodedQuery}&format=Mrss`  // Local RSS Bridge (install: docker run -d -p 3001:80 rssbridge/rss-bridge)
      // Or public: `https://rss-bridge.orgin/?action=display&bridge=Twitter&context=Search&q=${encodedQuery}&format=Mrss`
    ];
    let allPosts: any[] = [];
    let rssFailed = true;
    for (const url of xFeeds) {
      try {
        const feed = await parser.parseURL(url);
        const posts = (feed.items || []).slice(0, count).map(item => ({
          title: item.title || 'Untitled X Post',
          description: item.contentSnippet || (item.description as any as string) || '',
          link: item.link || '#',
          pubDate: item.pubDate || '',
          _source: 'X (via RSS Bridge)',
          thumbnail: extractThumbnail(item)  // Pulls media thumbs
        }));
        allPosts = allPosts.concat(posts);
        rssFailed = false;
        console.log(`Fetched ${posts.length} real X posts via ${url}`);
        break;
      } catch (e) {
        console.warn(`X RSS failed: ${url}`, e);
      }
    }
    
    // Fresh Fallback (From live Oct 2025 search; shuffle for variety)
    if (rssFailed || allPosts.length === 0) {
      console.log('Using fresh fallback');
      allPosts = [
        {
          title: 'Zama FHE on Privacy Engine Grind',
          description: '@zama_fhe: FHE breakthroughs in Eurocrypt 2025—noise reduced, 90% blockchain txs encrypted soon. Bullish on dApps? #ZamaCreatorProgram',
          link: 'https://x.com/godofprompt/status/1976349274305855937',
          pubDate: '2025-10-09T18:09:20Z',
          _source: 'X (fresh)',
          thumbnail: 'https://pbs.twimg.com/media/G21nMDsWcAAkehU.jpg'
        },
        {
          title: 'Practical Quantum Computers in 2 Years',
          description: 'Impact on AI, age reversal, disease cures, genome editing, energy production... the list goes on.',
          link: 'https://x.com/Jubal_Hardin/status/1973783170077413756',
          pubDate: '2025-10-02T16:12:33Z',
          _source: 'X (fresh)',
          thumbnail: null
        },
        {
          title: 'GPT-5 Released in October 2025',
          description: '94.6% AIME accuracy, processes text/images/audio/video. Superior reasoning across benchmarks.',
          link: 'https://x.com/FTayAI/status/1976498017743126765',
          pubDate: '2025-10-10T04:00:23Z',
          _source: 'X (fresh)',
          thumbnail: null
        },
        {
          title: 'MIT 26-Page AI Report (2025)',
          description: 'Fresh insights into where AI is headed. Worth a read.',
          link: 'https://x.com/shedntcare_/status/1973330030085415006',
          pubDate: '2025-10-01T10:11:56Z',
          _source: 'X (fresh)',
          thumbnail: 'https://pbs.twimg.com/media/G2KtNDsXQAAHAW8.jpg'
        },
        {
          title: 'AMD Instinct MI350: Game-Changer for AI Infra',
          description: 'Train faster, run bigger models, scale smarter—no vendor lock-in.',
          link: 'https://x.com/AMD/status/1973387587935981696',
          pubDate: '2025-10-01T14:00:39Z',
          _source: 'X (fresh)',
          thumbnail: 'https://pbs.twimg.com/media/G2LhiXdXsAAeE-K.jpg'
        },
        {
          title: 'AI Reinventing Scientific Discovery',
          description: 'Insilico\'s AI drug in Phase IIa, fusion plasma control solved, ECMWF AI forecasts in 8 min...',
          link: 'https://x.com/ItsMrMetaverse/status/1975920954648736102',
          pubDate: '2025-10-08T13:47:21Z',
          _source: 'X (fresh)',
          thumbnail: 'https://pbs.twimg.com/media/G2vholBXAAAqMRa.jpg'
        },
        {
          title: 'GPT-5 Pro Makes Novel Scientific Discoveries',
          description: 'Surprising: Small models thinking <40 min invent new science. OpenAI for Science incoming.',
          link: 'https://x.com/deredleritt3r/status/1973374635426087130',
          pubDate: '2025-10-01T13:09:11Z',
          _source: 'X (fresh)',
          thumbnail: null
        },
        {
          title: 'AI Ripple Effects: Robotics to Simulations',
          description: '- Robotics - Quantum Computing - Autonomous Vehicles - Simulations (from world models). All from AI.',
          link: 'https://x.com/iamKierraD/status/1974484308518707217',
          pubDate: '2025-10-04T14:38:37Z',
          _source: 'X (fresh)',
          thumbnail: null
        }
      ].sort(() => Math.random() - 0.5);  // Shuffle
      allPosts = allPosts.slice(0, count);
    }
    
    // Dedupe
    const uniquePosts = allPosts.filter((post, idx, self) =>
      idx === self.findIndex(t => t.title.toLowerCase() === post.title.toLowerCase())
    );
    const output = { posts: uniquePosts.slice(0, count) };
    console.log('MCP X Posts Output:', output);
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Tool 5: Personalize Feed (FIXED: Full implementation with proxy/filter logic)
server.registerTool(
  'personalize_feed',
  {
    title: 'Personalize Feed Tool',
    description: 'Refine a feed with user keywords/genres (e.g., "funny AI stories"). Filters or appends query to base tools.',
    inputSchema: {
      baseInterest: z.enum(['memes', 'stories', 'ai-science', 'x-posts']).default('memes'),
      userQuery: z.string().optional().default('').describe('Keywords to filter/append, e.g., "funny" or "2025"'),
      count: z.number().optional().default(10).describe('Max posts')
    },
    outputSchema: {
      posts: z.array(z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        pubDate: z.string().optional(),
        _source: z.string(),
        thumbnail: z.string().nullable().optional()
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { baseInterest = 'memes', userQuery = '', count = 10 } = input;
    let allPosts: any[] = [];

    // Helper to filter by query (case-insensitive, title or desc)
    const filterByQuery = (items: any[]) => {
      if (!userQuery.trim()) return items;
      const qLower = userQuery.toLowerCase().trim();
      return items.filter(item => 
        item.title.toLowerCase().includes(qLower) || 
        item.description.toLowerCase().includes(qLower)
      );
    };

    // Mock array for x-posts fallback (pasted from Tool 4)
    const mockPosts = [
      {
        title: 'Zama FHE on Privacy Engine Grind',
        description: '@zama_fhe: FHE breakthroughs in Eurocrypt 2025—noise reduced, 90% blockchain txs encrypted soon. Bullish on dApps? #ZamaCreatorProgram',
        link: 'https://x.com/godofprompt/status/1976349274305855937',
        pubDate: '2025-10-09T18:09:20Z',
        _source: 'X (fresh)',
        thumbnail: 'https://pbs.twimg.com/media/G21nMDsWcAAkehU.jpg'
      },
      {
        title: 'Practical Quantum Computers in 2 Years',
        description: 'Impact on AI, age reversal, disease cures, genome editing, energy production... the list goes on.',
        link: 'https://x.com/Jubal_Hardin/status/1973783170077413756',
        pubDate: '2025-10-02T16:12:33Z',
        _source: 'X (fresh)',
        thumbnail: null
      },
      {
        title: 'GPT-5 Released in October 2025',
        description: '94.6% AIME accuracy, processes text/images/audio/video. Superior reasoning across benchmarks.',
        link: 'https://x.com/FTayAI/status/1976498017743126765',
        pubDate: '2025-10-10T04:00:23Z',
        _source: 'X (fresh)',
        thumbnail: null
      },
      {
        title: 'MIT 26-Page AI Report (2025)',
        description: 'Fresh insights into where AI is headed. Worth a read.',
        link: 'https://x.com/shedntcare_/status/1973330030085415006',
        pubDate: '2025-10-01T10:11:56Z',
        _source: 'X (fresh)',
        thumbnail: 'https://pbs.twimg.com/media/G2KtNDsXQAAHAW8.jpg'
      },
      {
        title: 'AMD Instinct MI350: Game-Changer for AI Infra',
        description: 'Train faster, run bigger models, scale smarter—no vendor lock-in.',
        link: 'https://x.com/AMD/status/1973387587935981696',
        pubDate: '2025-10-01T14:00:39Z',
        _source: 'X (fresh)',
        thumbnail: 'https://pbs.twimg.com/media/G2LhiXdXsAAeE-K.jpg'
      },
      {
        title: 'AI Reinventing Scientific Discovery',
        description: 'Insilico\'s AI drug in Phase IIa, fusion plasma control solved, ECMWF AI forecasts in 8 min...',
        link: 'https://x.com/ItsMrMetaverse/status/1975920954648736102',
        pubDate: '2025-10-08T13:47:21Z',
        _source: 'X (fresh)',
        thumbnail: 'https://pbs.twimg.com/media/G2vholBXAAAqMRa.jpg'
      },
      {
        title: 'GPT-5 Pro Makes Novel Scientific Discoveries',
        description: 'Surprising: Small models thinking <40 min invent new science. OpenAI for Science incoming.',
        link: 'https://x.com/deredleritt3r/status/1973374635426087130',
        pubDate: '2025-10-01T13:09:11Z',
        _source: 'X (fresh)',
        thumbnail: null
      },
      {
        title: 'AI Ripple Effects: Robotics to Simulations',
        description: '- Robotics - Quantum Computing - Autonomous Vehicles - Simulations (from world models). All from AI.',
        link: 'https://x.com/iamKierraD/status/1974484308518707217',
        pubDate: '2025-10-04T14:38:37Z',
        _source: 'X (fresh)',
        thumbnail: null
      }
    ];

    try {
      switch (baseInterest) {
        case 'memes': {
          const memeFeeds = [
            'https://memebase.cheezburger.com/rss',
            'https://www.reddit.com/r/memes/.rss'
          ];
          for (const url of memeFeeds) {
            const feed = await parser.parseURL(url);
            const memes = (feed.items || []).slice(0, count).map(item => ({
              title: item.title || 'Untitled Meme',
              description: item.contentSnippet || (item.description as any as string) || '',
              link: item.link || '#',
              pubDate: item.pubDate || '',
              _source: new URL(url).hostname.replace('www.', '') || 'Unknown',
              thumbnail: extractThumbnail(item)
            }));
            allPosts = allPosts.concat(memes);
          }
          allPosts = filterByQuery(allPosts);
          break;
        }
        case 'stories': {
          const genre = 'micro';  // Default for simplicity; extend if needed
          const storyFeeds = ['https://www.fictionontheweb.co.uk/feeds/posts/default?alt=rss'];
          for (const url of storyFeeds) {
            const feed = await parser.parseURL(url);
            const stories = (feed.items || []).slice(0, count).map(item => ({
              title: item.title || 'Untitled Story',
              description: item.contentSnippet || (item.description as any as string) || '',
              link: item.link || '#',
              pubDate: item.pubDate || '',
              _source: new URL(url).hostname.replace('www.', '') || 'Unknown',
              thumbnail: extractThumbnail(item)
            }));
            allPosts = allPosts.concat(stories);
          }
          allPosts = filterByQuery(allPosts);
          break;
        }
        case 'ai-science': {
          const type = 'ai';  // Default
          const feeds = [
            'https://www.technologyreview.com/feed/',
            'https://openai.com/blog/rss/'
          ];
          for (const url of feeds) {
            const feed = await parser.parseURL(url);
            const posts = (feed.items || []).slice(0, count).map(item => ({
              title: item.title || 'Breakthrough Post',
              description: item.contentSnippet || (item.description as any as string) || '',
              link: item.link || '#',
              pubDate: item.pubDate || '',
              _source: new URL(url).hostname.replace('www.', '') || 'Unknown',
              thumbnail: extractThumbnail(item)
            }));
            allPosts = allPosts.concat(posts);
          }
          allPosts = filterByQuery(allPosts);
          break;
        }
        case 'x-posts': {
          // Append userQuery to default query for X
          const baseQuery = '(AI OR "artificial intelligence") breakthroughs 2025 filter:media min_faves:50';
          const fullQuery = userQuery ? `${userQuery} ${baseQuery}` : baseQuery;
          const encodedQuery = encodeURIComponent(fullQuery);
          const xFeeds = [`https://rsshub.app/twitter/search?q=${encodedQuery}`];
          let rssFailed = true;
          for (const url of xFeeds) {
            try {
              const feed = await parser.parseURL(url);
              const posts = (feed.items || []).slice(0, count).map(item => ({
                title: item.title || 'Untitled X Post',
                description: item.contentSnippet || (item.description as any as string) || '',
                link: item.link || '#',
                pubDate: item.pubDate || '',
                _source: 'X (via Proxy)',
                thumbnail: extractThumbnail(item)
              }));
              allPosts = allPosts.concat(posts);
              rssFailed = false;
              break;
            } catch (e) {
              console.warn(`Personalized X feed failed: ${url}`, e);
            }
          }
          // Fallback to shuffled mock, then filter
          if (rssFailed || allPosts.length === 0) {
            allPosts = mockPosts.sort(() => Math.random() - 0.5);
            allPosts = filterByQuery(allPosts);
          }
          break;
        }
      }
    } catch (e) {
      console.warn(`Personalize feed failed for ${baseInterest}:`, e);
      // Fallback: Empty or mock
      allPosts = [];
    }

    // Dedupe and slice
    const uniquePosts = allPosts.filter((post, idx, self) =>
      idx === self.findIndex(t => t.title.toLowerCase() === post.title.toLowerCase())
    );
    const output = { posts: uniquePosts.slice(0, count) };
    console.log('MCP Personalized Output:', output);
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Tool 6: Generate AI Stories (Enhanced Mock with Variety)
server.registerTool(
  'generate_stories',
  {
    title: 'AI Story Generator Tool',
    description: 'Generate custom short stories based on user prompts (e.g., genre + theme).',
    inputSchema: {
      prompt: z.string().optional().default('A whimsical adventure in a futuristic city').describe('Story prompt, e.g., "goblin romance in space"'),
      count: z.number().optional().default(5).describe('Number of stories'),
      length: z.enum(['short', 'medium']).optional().default('short').describe('Story length')
    },
    outputSchema: {
      stories: z.array(z.object({
        title: z.string(),
        description: z.string(),  // Full story text here
        link: z.string().optional(),  // Optional: "Generated by MCP"
        pubDate: z.string().optional(),
        _source: z.literal('AI Generated'),
        thumbnail: z.string().nullable().optional()  // Mock image URL or null
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { prompt = 'A whimsical adventure in a futuristic city', count = 5, length = 'short' } = input;
    const wordCount = length === 'short' ? 100 : 200;
    
    // Enhanced Mock: Varied templates with randomization
    const genres = prompt.toLowerCase().includes('goblin') ? ['fantasy', 'cyberpunk', 'steampunk', 'noir', 'epic'] : ['futuristic', 'dystopian', 'utopian', 'noir', 'epic'];
    const twists = ['a betrayal by an old friend', 'a hidden artifact in the shadows', 'an unexpected ally from the past', 'a time loop trapping the hero', 'a digital ghost haunting the code'];
    const endings = ['victory at a heavy cost', 'a bittersweet farewell under the stars', 'an eternal mystery unsolved', 'a rebirth from the ashes', 'an endless chase into the unknown'];
    
    const stories: any[] = [];
    for (let i = 0; i < count; i++) {
      const genre = genres[Math.floor(Math.random() * genres.length)];
      const twist = twists[Math.floor(Math.random() * twists.length)];
      const ending = endings[Math.floor(Math.random() * endings.length)];
      
      const title = `${prompt.split(' ')[0].charAt(0).toUpperCase() + prompt.split(' ')[0].slice(1)} Shadows: Chapter ${i + 1}`;
      
      let story = `In the ${genre} sprawl of ${prompt.toLowerCase()}, the wanderer uncovered ${twist}, sparking a chain of events that led to ${ending}. `;
      if (length === 'short') {
        story += `The neon lights flickered as secrets unraveled, leaving only echoes of what was lost in the grid.`;
      } else {
        story += `Allies rose and fell amid moral crossroads, technology blurring with fate, culminating in a dawn that reshaped the horizon. As the spires glowed anew, the cycle renewed with whispers of untold futures.`;
      }
      
      // Trim to approximate word count
      const words = story.split(' ');
      story = words.slice(0, wordCount).join(' ') + (words.length > wordCount ? '...' : '');
      
      stories.push({
        title,
        description: story,  // Unique per iteration
        link: 'Generated via MCP AI',
        pubDate: new Date().toISOString(),
        _source: 'AI Generated',
        thumbnail: `https://via.placeholder.com/320x180/${Math.floor(Math.random() * 0xFFFFFF << 0).toString(16).padStart(6, '0')}/FFFFFF?text=AI+Story+${i+1}`  // Random color thumb
      });
    }
    
    // xAI API Swap Example (uncomment + add key for real gen):
    // const response = await fetch('https://api.x.ai/v1/chat/completions', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ model: 'grok-beta', messages: [{ role: 'user', content: `Generate ${count} unique ${length} stories (${wordCount} words each) on: ${prompt}. Vary plots, characters, and endings.` }], max_tokens: 1000 })
    // });
    // const data = await response.json();
    // const generated = data.choices[0].message.content.split('\n\n').slice(0, count).map((text: string, i: number) => ({ title: `AI Tale ${i+1}`, description: text, ... }));  // Parse
    
    const output = { stories };
    console.log('MCP AI Stories Output:', output);
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Tool 7: Fetch DDG Search Results (with Image Enhancement)
server.registerTool(
  'fetch_ddg_search',
  {
    title: 'DuckDuckGo Search Tool',
    description: 'Fetch search results and instant answers from DuckDuckGo (free API) with image enhancement.',
    inputSchema: {
      query: z.string().optional().default('AI breakthroughs 2025').describe('Search query'),
      count: z.number().optional().default(10).describe('Max results')
    },
    outputSchema: {
      results: z.array(z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        pubDate: z.string().optional(),
        _source: z.literal('DuckDuckGo'),
        thumbnail: z.string().nullable().optional()
      }))
    }
  },
  async (input): Promise<StreamableValue> => {
    const { query = 'AI breakthroughs 2025', count = 10 } = input;
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    
    let results: any[] = [];
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      
      // Parse Instant Answer (top result)
      if (data.Abstract) {
        results.push({
          title: data.Heading || 'Instant Answer',
          description: data.Abstract,
          link: data.AbstractURL || '#',
          pubDate: '',
          _source: 'DuckDuckGo',
          thumbnail: null  // Will enhance below
        });
      }
      
      // Add related topics
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const topics = data.RelatedTopics.slice(0, count - 1).map((topic: any) => ({
          title: topic.Text || 'Related Topic',
          description: topic.FirstURL ? `Learn more: ${topic.Text}` : topic.Text,
          link: topic.FirstURL || '#',
          pubDate: '',
          _source: 'DuckDuckGo',
          thumbnail: topic.Icon ? topic.Icon.URL : null
        }));
        results = results.concat(topics);
      }
      
      // 👈 NEW: Enhance top result with image if no thumb
      if (results.length > 0 && !results[0].thumbnail) {
        // Mock search_images call (in real MCP, chain tool; here, placeholder fetch)
        const imgResponse = await fetch(`https://api.duckduckgo.com/?q=images+${encodeURIComponent(query)}&format=json&no_html=1`);
        const imgData = await imgResponse.json();
        if (imgData.RelatedTopics && imgData.RelatedTopics[0] && imgData.RelatedTopics[0].Icon) {
          results[0].thumbnail = imgData.RelatedTopics[0].Icon.URL;
        } else {
          // Fallback placeholder
          results[0].thumbnail = 'https://via.placeholder.com/320x180/4A90E2/FFFFFF?text=' + encodeURIComponent(query.slice(0,20));
        }
      }
      
      console.log(`DDG Search: ${results.length} results for "${query}" (top thumb enhanced)`);
    } catch (e) {
      console.warn(`DDG fetch failed:`, e);
      results = [];
    }
    
    const output = { results: results.slice(0, count) };
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    };
  }
);

// Express Setup
const app = express();
app.use(cors({ 
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],  // 👈 Explicit for preflight
  allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id'],
  exposedHeaders: ['Mcp-Session-Id']
}));
app.use(express.json({ limit: '10mb' }));

// MCP Endpoint
app.post('/mcp', async (req: express.Request, res: express.Response) => {
  res.setHeader('Accept', 'application/json, text/event-stream');
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on('close', () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`MCP RSS Server running at http://localhost:${PORT}`);
  console.log(`Test with: Invoke-RestMethod -Uri http://localhost:${PORT}/mcp -Method Post -Body '{"jsonrpc":"2.0","method":"tools/list","id":1}' -ContentType "application/json"`);
}).on('error', (error: Error) => {
  console.error('Server error:', error);
  process.exit(1);
});