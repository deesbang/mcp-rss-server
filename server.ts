// server.ts (updated snippet)
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';

// server.ts (imports section)
import { registerFetchMemes } from './tools/fetchMemes.js';
import { registerFetchStories } from './tools/fetchStories.js';  // 👈 Fixed: Added .js
import { registerFetchDDG } from './tools/fetchDDG.js';  // 👈 MUST have .js for ESM resolution
import { registerGeneratePostsFromRss } from './tools/generatePostsFromRss.js';  // 👈 .js for ESM

// Create MCP Server
const server = new McpServer({
  name: 'rss-mcp-server',
  version: '1.0.0'
});
// Register tools
registerFetchMemes(server);
registerFetchStories(server);  // 👈 New registration
registerFetchDDG(server);  // New, safe
registerGeneratePostsFromRss(server);  // 👈 New

// ... rest of the file unchanged

// Express Setup
const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id'],
  exposedHeaders: ['Mcp-Session-Id']
}));
app.use(express.json({ limit: '10mb' }));

// MCP Endpoint
app.post('/mcp', async (req: express.Request, res: express.Response) => {
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

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`MCP RSS Server (Modular) running at http://localhost:${PORT}`);
  console.log(`Test: Invoke-RestMethod -Uri http://localhost:${PORT}/mcp -Method Post -Body '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fetch_memes","arguments":{"count":1}},"id":2}' -ContentType "application/json" -Headers @{'Accept'='application/json, text/event-stream'}`);
}).on('error', (error: Error) => {
  console.error('Server error:', error);
  process.exit(1);
});