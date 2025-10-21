import express from 'express';
import cors from 'cors';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Top-level imports (outside try—TS rule)
import { registerFetchMemes } from './tools/fetchMemes.js';
import { registerFetchStories } from './tools/fetchStories.js';
import { registerFetchDDG } from './tools/fetchDDG.js';
import { registerGeneratePostsFromRss } from './tools/generatePostsFromRss.js';

// Global error handlers: log only (don’t exit)
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION', r));
process.on('uncaughtException', (e) => { console.error('UNCAUGHT EXCEPTION', e); process.exit(1); });

// Create MCP Server
const server = new McpServer({
  name: 'rss-mcp-server',
  version: '1.0.0'
});

// Register tools (try/catch for calls only—imports at top)
try {
  registerFetchMemes(server);
  console.log('Memes tool registered');
  registerFetchStories(server);
  console.log('Stories tool registered');
  registerFetchDDG(server);
  console.log('DDG tool registered');
  registerGeneratePostsFromRss(server);
  console.log('Posts tool registered');
} catch (regError) {
  console.error('Tool registration error:', regError);
}

// Express Setup
const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id'],
  exposedHeaders: ['Mcp-Session-Id']
}));
app.use(express.json({ limit: '10mb' }));

// Health endpoints (for Render)
app.get('/', (_req, res) => res.send('mcp-rss-server OK'));
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

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
console.log(`Starting server on PORT: ${PORT}`);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP RSS Server (Modular) running at http://0.0.0.0:${PORT}`);
  console.log(`Test: curl -X POST http://localhost:${PORT}/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`);
}).on('error', (error: Error) => {
  console.error('Server error:', error);
  process.exit(1);
});

console.log('Server startup complete');  // Final log if all good