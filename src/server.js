/**
 * ProjectPilot AI - Node.js HTTP Server & MCP Streamable HTTP Gateway
 * Production-hardened with authentication, origin controls, request validation,
 * rate limiting, path traversal defenses, and information disclosure protection.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto, { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProjectStore } from './db/store.js';
import { createProjectPilotMcpServer } from './mcp/server.js';
import { RateLimiter } from './security/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB

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
 * @param {string} options.apiKey - Optional API key for authenticating MCP requests
 * @param {string[]} options.allowedOrigins - Optional array of allowed CORS origins
 * @param {Object} options.rateLimit - Optional rate limiting options { windowMs, maxRequests, enabled }
 */
export async function createServer(options = {}) {
  const storePath = options.storePath || path.resolve(__dirname, '..', 'data', 'store.json');
  const store = new ProjectStore(storePath);
  await store.init();

  // Authentication: configured via options.apiKey or MCP_API_KEY environment variable
  const apiKey = options.apiKey !== undefined
    ? options.apiKey
    : (process.env.MCP_API_KEY ? String(process.env.MCP_API_KEY).trim() : null);

  // CORS origins: configured via options.allowedOrigins or ALLOWED_ORIGINS environment variable
  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const configuredOrigins = options.allowedOrigins || envOrigins;

  // Rate Limiting
  const rateLimiter = new RateLimiter({
    windowMs: options.rateLimit?.windowMs || 60 * 1000,
    maxRequests: options.rateLimit?.maxRequests || parseInt(process.env.RATE_LIMIT_MAX_PER_MINUTE, 10) || 120,
    enabled: options.rateLimit?.enabled !== false
  });

  // Map of active MCP sessions: sessionId -> { transport, server }
  const sessions = new Map();

  /**
   * Determine allowed CORS origin based on request headers and configuration.
   */
  function getAllowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return null; // Same-origin or non-browser request

    // If explicit wildcard or origin list configured
    if (Array.isArray(configuredOrigins) && configuredOrigins.length > 0) {
      if (configuredOrigins.includes('*')) return '*';
      if (configuredOrigins.includes(origin)) return origin;
      return false; // Origin not allowed
    }

    // Default development policy: allow localhost, 127.0.0.1, and same-host
    try {
      const parsedOrigin = new URL(origin);
      const host = parsedOrigin.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return origin;
      }
      const reqHost = req.headers.host ? req.headers.host.split(':')[0] : null;
      if (reqHost && host === reqHost) {
        return origin;
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Set security headers and CORS headers on the response.
   */
  function applySecurityHeaders(req, res, allowedOrigin) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;"
    );

    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, x-api-key, mcp-session-id, mcp-protocol-version, last-event-id'
      );
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
      res.setHeader('Vary', 'Origin');
    }
  }

  /**
   * Validate authentication credentials against expected API key (constant-time).
   */
  function authenticateRequest(req) {
    if (!apiKey) {
      // Open / local development mode
      return { authenticated: true };
    }

    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    if (!token) {
      return {
        authenticated: false,
        message: 'Authentication required: missing Bearer token or x-api-key header'
      };
    }

    const tokenBuf = Buffer.from(token, 'utf8');
    const expectedBuf = Buffer.from(apiKey, 'utf8');

    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      return {
        authenticated: false,
        message: 'Authentication failed: invalid API key'
      };
    }

    return { authenticated: true };
  }

  const httpServer = http.createServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';

    // 1. Rate Limiting Check
    const rateCheck = rateLimiter.isAllowed(clientIp);
    if (!rateCheck.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(rateCheck.retryAfter || 60)
      });
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.'
      }));
      return;
    }

    const allowedOrigin = getAllowedOrigin(req);
    applySecurityHeaders(req, res, allowedOrigin);

    // 2. CORS Preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
      if (req.headers.origin && allowedOrigin === false) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Origin not allowed by CORS policy' }));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // Origin Check for cross-origin browser requests
    if (req.headers.origin && allowedOrigin === false) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: Cross-origin request rejected' }));
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 3. MCP Streamable HTTP Endpoint
    if (pathname === '/mcp') {
      // A. Authentication Verification
      const auth = authenticateRequest(req);
      if (!auth.authenticated) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="ProjectPilot MCP Gateway"'
        });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: auth.message }
        }));
        return;
      }

      // B. Session ID Format Validation
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId && (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid mcp-session-id format' }
        }));
        return;
      }

      // C. POST: Handle JSON-RPC tool calls, notifications, initialization
      if (req.method === 'POST') {
        // Content-Type validation
        const contentType = req.headers['content-type'] || '';
        if (!contentType.toLowerCase().includes('application/json')) {
          res.writeHead(415, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Unsupported Media Type: Content-Type must be application/json' }
          }));
          return;
        }

        // Payload size validation (Content-Length header check)
        const contentLength = req.headers['content-length'];
        if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: `Payload Too Large: Exceeds ${MAX_PAYLOAD_BYTES} bytes limit` }
          }));
          return;
        }

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

          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
            }
          };
        }

        try {
          await transport.handleRequest(req, res);
          if (transport.sessionId && !sessions.has(transport.sessionId)) {
            sessions.set(transport.sessionId, { transport, createdAt: Date.now() });
          }
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal MCP processing error' }
            }));
          }
        }
        return;
      }

      // D. GET: SSE stream
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

      // E. DELETE: Clean session termination
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

    // 4. Diagnostic & Health Endpoint (Discloses operational stats, no secrets)
    if (pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        product: 'ProjectPilot AI',
        status: 'operational',
        version: '1.0.0',
        protocol: 'Model Context Protocol (MCP) Streamable HTTP (2025-11-25)',
        authConfigured: Boolean(apiKey),
        activeMcpSessions: sessions.size,
        dataStats: {
          projects: store.listProjects().length,
          tasks: store.listTasks().length,
          blockers: store.listBlockers().length
        }
      }, null, 2));
      return;
    }

    // 5. Static File Server with Hardened Path Traversal Protection
    if (req.method === 'GET' || req.method === 'HEAD') {
      // Null-byte poison check (both encoded and raw)
      if (req.url.includes('%00') || pathname.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: Null bytes not permitted');
        return;
      }

      // Explicit directory traversal checks on raw URL and normalized path
      if (req.url.includes('..') || req.url.toLowerCase().includes('%2e%2e')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Path traversal detected');
        return;
      }

      let relativePath = pathname === '/' ? 'index.html' : pathname;
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }

      // Disallow hidden files (dotfiles like .env, .git)
      const pathParts = relativePath.split(/[\\/]/);
      if (pathParts.some(p => p.startsWith('.') && p !== '.' && p !== '..')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      const safePath = path.resolve(PUBLIC_DIR, relativePath);
      const relativeToPublic = path.relative(PUBLIC_DIR, safePath);

      // Strict containment check: relative path must not escape PUBLIC_DIR
      if (
        relativeToPublic.startsWith('..') ||
        path.isAbsolute(relativeToPublic) ||
        (!safePath.startsWith(PUBLIC_DIR + path.sep) && safePath !== PUBLIC_DIR)
      ) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Path traversal detected');
        return;
      }

      try {
        const stat = await fs.promises.stat(safePath);
        if (stat.isDirectory()) {
          const indexFile = path.join(safePath, 'index.html');
          const indexStat = await fs.promises.stat(indexFile);
          if (indexStat.isFile()) {
            const ext = path.extname(indexFile);
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(indexFile).pipe(res);
            return;
          }
        } else if (stat.isFile()) {
          const ext = path.extname(safePath);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Content-Length': stat.size
          });
          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(safePath).pipe(res);
          return;
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 - Not Found</h1><p>The requested file does not exist.</p>');
          return;
        }
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
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
    rateLimiter,
    start: (port = 3000) => {
      return new Promise((resolve, reject) => {
        httpServer.listen(port, () => {
          const address = httpServer.address();
          resolve(address);
        }).on('error', reject);
      });
    },
    stop: () => {
      rateLimiter.destroy();
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
