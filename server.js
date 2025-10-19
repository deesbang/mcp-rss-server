import express from 'express';
import { z } from 'zod';
import Parser from 'rss-parser';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
// Shared Thumbnail Extractor (for all tools)
function extractThumbnail(item) {
    let thumbnail = null;
    try {
        // Enclosure (Reddit/Mashable style)
        if (item.enclosure?.url) {
            thumbnail = item.enclosure.url;
        }
        // media:thumbnail (Cheezburger/Fiction on Web)
        else if (item.mediaThumbnail) {
            const thumbs = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [item.mediaThumbnail];
            if (thumbs.length > 0) {
                const sortedThumbs = thumbs.sort((a, b) => {
                    const wa = parseInt(a?.$?.width || '0');
                    const wb = parseInt(b?.$?.width || '0');
                    return wb - wa; // Largest first
                });
                const thumbObj = sortedThumbs[0];
                thumbnail = thumbObj?.$?.url || thumbObj?.url || null;
            }
        }
        // media:content (nested, if any)
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
                        const nThumb = nestedThumbs[0];
                        thumbnail = nThumb?.$?.url || nThumb?.url || null;
                        if (thumbnail)
                            break;
                    }
                }
            }
        }
        // Fallback: thumbnail field or <img> in desc
        else if (item.thumbnail) {
            thumbnail = typeof item.thumbnail === 'string'
                ? item.thumbnail
                : (item.thumbnail?.$?.url || item.thumbnail?.url || null);
        }
        else if (item.contentSnippet || item.description) {
            const desc = item.contentSnippet || item.description || '';
            const imgMatch = desc.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
            if (imgMatch && imgMatch[1]) {
                thumbnail = imgMatch[1].trim();
            }
        }
        // Validate
        if (typeof thumbnail !== 'string' || thumbnail.trim().length <= 10 || !/^https?:\/\//i.test(thumbnail)) {
            thumbnail = null;
        }
    }
    catch (e) {
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
server.registerTool('fetch_memes', {
    title: 'Meme Fetch Tool',
    description: 'Fetch recent memes from fun RSS feeds (e.g., Cheezburger or Reddit).',
    inputSchema: {
        count: z.number().optional().default(5).describe('Max memes')
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
}, async (input) => {
    const { count = 5 } = input;
    const memeFeeds = [
        'https://memebase.cheezburger.com/rss', // Active, thumbs galore (Oct 11, 2025)
        'https://www.reddit.com/r/memes/.rss' // Active, enclosures (Oct 11, 2025)
    ];
    let allMemes = [];
    for (const url of memeFeeds) {
        try {
            const feed = await parser.parseURL(url);
            const memes = (feed.items || []).slice(0, count).map(item => ({
                title: item.title || 'Untitled Meme',
                description: item.contentSnippet || item.description || '',
                link: item.link || '#',
                pubDate: item.pubDate || '',
                _source: (() => {
                    try {
                        return new URL(url).hostname.replace('www.', '');
                    }
                    catch {
                        return 'Unknown';
                    }
                })(),
                thumbnail: extractThumbnail(item) // 👈 Shared magic
            }));
            allMemes = allMemes.concat(memes);
        }
        catch (e) {
            console.warn(`Meme feed failed: ${url}`, e);
        }
    }
    // Dedupe by title (simple, case-insensitive)
    const uniqueMemes = allMemes.filter((meme, idx, self) => idx === self.findIndex(t => t.title.toLowerCase() === meme.title.toLowerCase()));
    const output = { memes: uniqueMemes.slice(0, count) };
    console.log('MCP Memes Output:', output);
    return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output
    };
});
// Tool 2: Fetch Stories
server.registerTool('fetch_stories', {
    title: 'Story Fetch Tool',
    description: 'Fetch short stories or fiction from creative RSS feeds.',
    inputSchema: {
        genre: z.enum(['micro', 'literary']).optional().default('micro').describe('micro for bite-sized, literary for deeper reads'),
        count: z.number().optional().default(5).describe('Max stories')
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
}, async (input) => {
    const { genre = 'micro', count = 5 } = input;
    const storyFeeds = genre === 'micro'
        ? ['https://www.fictionontheweb.co.uk/feeds/posts/default?alt=rss'] // Active micro-fiction, thumbs (Oct 10, 2025)
        : ['https://americanshortfiction.org/feed/']; // Literary, img in desc (Sep 2025, but solid)
    let allStories = [];
    for (const url of storyFeeds) {
        try {
            const feed = await parser.parseURL(url);
            const stories = (feed.items || []).slice(0, count).map(item => ({
                title: item.title || 'Untitled Story',
                description: item.contentSnippet || item.description || '',
                link: item.link || '#',
                pubDate: item.pubDate || '',
                _source: (() => {
                    try {
                        return new URL(url).hostname.replace('www.', '');
                    }
                    catch {
                        return 'Unknown';
                    }
                })(),
                thumbnail: extractThumbnail(item)
            }));
            allStories = allStories.concat(stories);
        }
        catch (e) {
            console.warn(`Story feed failed: ${url}`, e);
        }
    }
    const uniqueStories = allStories.filter((story, idx, self) => idx === self.findIndex(t => t.title.toLowerCase() === story.title.toLowerCase()));
    const output = { stories: uniqueStories.slice(0, count) };
    console.log('MCP Stories Output:', output);
    return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output
    };
});
// Tool 3: Fetch Viral Posts
server.registerTool('fetch_viral_posts', {
    title: 'Viral Posts Tool',
    description: 'Fetch interesting or viral content from engaging RSS feeds.',
    inputSchema: {
        type: z.enum(['buzz', 'tech']).optional().default('buzz').describe('buzz for trending, tech for gadgets'),
        count: z.number().optional().default(5).describe('Max posts')
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
}, async (input) => {
    const { type = 'buzz', count = 5 } = input;
    const viralFeeds = type === 'buzz'
        ? ['http://feeds.mashable.com/Mashable'] // Active viral/tech buzz, enclosures (Oct 11, 2025)
        : ['https://gizmodo.com/rss']; // Gadget virals, thumbs
    let allPosts = [];
    for (const url of viralFeeds) {
        try {
            const feed = await parser.parseURL(url);
            const posts = (feed.items || []).slice(0, count).map(item => ({
                title: item.title || 'Viral Post',
                description: item.contentSnippet || item.description || '',
                link: item.link || '#',
                pubDate: item.pubDate || '',
                _source: (() => {
                    try {
                        return new URL(url).hostname.replace('www.', '');
                    }
                    catch {
                        return 'Unknown';
                    }
                })(),
                thumbnail: extractThumbnail(item)
            }));
            allPosts = allPosts.concat(posts);
        }
        catch (e) {
            console.warn(`Viral feed failed: ${url}`, e);
        }
    }
    const uniquePosts = allPosts.filter((post, idx, self) => idx === self.findIndex(t => t.title.toLowerCase() === post.title.toLowerCase()));
    const output = { posts: uniquePosts.slice(0, count) };
    console.log('MCP Viral Output:', output);
    return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output
    };
});
// Express Setup
const app = express();
app.use(cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'mcp-session-id', 'Accept']
}));
app.use(express.json({ limit: '10mb' }));
// MCP Endpoint
app.post('/mcp', async (req, res) => {
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
    }
    catch (error) {
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
}).on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});
