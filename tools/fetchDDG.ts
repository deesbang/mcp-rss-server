// tools/fetchDDG.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Parser from 'rss-parser';  // 👈 Reuse RSS parser (already in deps)

export function registerFetchDDG(server: McpServer) {
  server.tool('fetch_ddg_search', {
    title: 'Search Tool (Bing RSS)',
    description: 'Fetch web search results from Bing RSS (free, no key) with image enhancement.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          default: 'AI breakthroughs 2025',
          description: 'Search query'
        },
        count: {
          type: 'number',
          default: 10,
          description: 'Max results'
        }
      },
      required: []
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              link: { type: 'string' },
              pubDate: { type: 'string', nullable: true },
              _source: { type: 'string', enum: ['Bing'] },
              thumbnail: { type: 'string', nullable: true }
            },
            required: ['title', 'description', 'link', '_source']
          }
        }
      },
      required: ['results']
    }
  }, async (args) => {
    const { query = 'AI breakthroughs 2025', count = 10 } = args;
    const parser = new Parser();  // Reuse RSS parser
    let results: any[] = [];
    try {
      const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}&format=rss`;
      console.log(`Bing RSS URL: ${bingUrl}`);  // Debug
      const feed = await parser.parseURL(bingUrl);
      const items = (feed.items || []).slice(0, count);
      results = items.map((item: any) => ({
        title: item.title || 'Search Result',
        description: item.contentSnippet || item.description || '',
        link: item.link || '#',
        pubDate: item.pubDate || '',
        _source: 'Bing',
        thumbnail: null  // Enhance below
      }));
      console.log(`Bing Search: ${results.length} results for "${query}"`);  // Debug
      // Enhance top result with image (DDG images fallback if needed)
      if (results.length > 0 && !results[0].thumbnail) {
        const imgUrl = `https://api.duckduckgo.com/?q=images+${encodeURIComponent(query)}&format=json&no_html=1`;
        try {
          const imgResponse = await fetch(imgUrl);
          const imgData = await imgResponse.json();
          if (imgData.RelatedTopics && imgData.RelatedTopics[0] && imgData.RelatedTopics[0].Icon) {
            results[0].thumbnail = imgData.RelatedTopics[0].Icon.URL;
            console.log('Enhanced top thumb:', results[0].thumbnail);
          } else {
            results[0].thumbnail = `https://via.placeholder.com/320x180/4A90E2/FFFFFF?text=${encodeURIComponent(query.slice(0, 20))}`;
            console.log('Used placeholder thumb');
          }
        } catch (imgE) {
          console.warn('Image enhancement failed:', imgE);
          results[0].thumbnail = `https://via.placeholder.com/320x180/4A90E2/FFFFFF?text=${encodeURIComponent(query.slice(0, 20))}`;
        }
      }
    } catch (e) {
      console.warn(`Bing search failed:`, e);
      results = [];
    }
    const output = { results: results.slice(0, count) };

    return {
      content: results.slice(0, count).map((result: any) => ({
        type: 'text',
        text: `${result.title}\n${result.description.substring(0, 200)}...\n${result.link}`
      })),
      structuredContent: output
    };
  });
}