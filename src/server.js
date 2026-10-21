/**
 * ProjectPilot AI - Node.js HTTP Server & MCP Streamable HTTP Gateway
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProjectStore } from './db/store.js';
import { createProjectPilotMcpServer } from './mcp/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Creates and configures the ProjectPilot HTTP Server.
 * @param {Object} options
 * @param {string} options.storePath - Optional path for JSON store
 * @param {number} options.port - Port to listen on
 */
export async function createServer(options = {}) {
  const storePath = options.storePath || path.resolve(__dirname, '..', 'data', 'store.json');
  const store = new ProjectStore(storePath);
  await store.init();

  // Map of active MCP sessions: sessionId -> { transport, server }
  const sessions = new Map();

  function setCorsHeaders(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, mcp-session-id, mcp-protocol-version, last-event-id'
    );
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
  }

  const httpServer = http.createServer(async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. MCP Streamable HTTP Endpoint
    if (pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'];

      if (req.method === 'POST') {
        let transport;
        if (sessionId) {
          const session = sessions.get(sessionId);
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: `Session "${sessionId}" not found or expired.` }
            }));
            return;
          }
          transport = session.transport;
        } else {
          // Initialize a new stateful MCP transport session
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true
          });
          const mcpServer = createProjectPilotMcpServer(store);
          await mcpServer.connect(transport);

          const sessionEntry = { transport, server: mcpServer, createdAt: Date.now() };
          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
            }
          };
        }

        try {
          await transport.handleRequest(req, res);
          // If a new session was created and given an ID, save to map
          if (transport.sessionId && !sessions.has(transport.sessionId)) {
            sessions.set(transport.sessionId, { transport, createdAt: Date.now() });
          }
        } catch (err) {
          console.error('[MCP Transport Error]', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: `Internal MCP error: ${err.message}` }
            }));
          }
        }
        return;
      }

      if (req.method === 'GET') {
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing or invalid mcp-session-id header for SSE stream' }));
          return;
        }
        const session = sessions.get(sessionId);
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'DELETE') {
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          await session.transport.close();
          sessions.delete(sessionId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'session_terminated', sessionId }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
        }
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    // 2. Diagnostic & Health Endpoint
    if (pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        product: 'ProjectPilot AI',
        status: 'operational',
        version: '1.0.0',
        protocol: 'Model Context Protocol (MCP) Streamable HTTP (2025-11-25)',
        activeMcpSessions: sessions.size,
        dataStats: {
          projects: store.listProjects().length,
          tasks: store.listTasks().length,
          blockers: store.listBlockers().length
        }
      }, null, 2));
      return;
    }

    // 3. Static File Server with Path Traversal Protection
    if (req.method === 'GET' || req.method === 'HEAD') {
      let relativePath = pathname === '/' ? 'index.html' : pathname;
      // Strip leading slash
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }

      const filePath = path.resolve(PUBLIC_DIR, relativePath);

      // Verify path stays strictly within PUBLIC_DIR
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Path traversal detected');
        return;
      }

      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
          const indexFile = path.join(filePath, 'index.html');
          const indexStat = await fs.promises.stat(indexFile);
          if (indexStat.isFile()) {
            const ext = path.extname(indexFile);
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(indexFile).pipe(res);
            return;
          }
        } else if (stat.isFile()) {
          const ext = path.extname(filePath);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Content-Length': stat.size
          });
          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 - Not Found</h1><p>The requested file does not exist.</p>');
          return;
        }
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${err.message}`);
        return;
      }
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  });

  return {
    server: httpServer,
    store,
    sessions,
    start: (port = 3000) => {
      return new Promise((resolve, reject) => {
        httpServer.listen(port, () => {
          const address = httpServer.address();
          resolve(address);
        }).on('error', reject);
      });
    },
    stop: () => {
      return new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  };
}

// Standalone execution entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  createServer().then(({ start }) => {
    start(PORT).then((addr) => {
      console.log(`======================================================`);
      console.log(` ProjectPilot AI - Operations Assistant for Developers `);
      console.log(`======================================================`);
      console.log(` Server running on http://localhost:${addr.port}`);
      console.log(` MCP Streamable HTTP: http://localhost:${addr.port}/mcp`);
      console.log(` Diagnostics:         http://localhost:${addr.port}/api/info`);
      console.log(` Ready for hackathon evaluation.\n`);
    });
  }).catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
