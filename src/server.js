/**
 * ProjectPilot AI - Node.js HTTP Server & MCP Streamable HTTP Gateway
 * Production-hardened with authentication, origin controls, request validation,
 * rate limiting, path traversal defenses, and information disclosure protection.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto, { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProjectStore, createStore } from './db/store.js';
import { UpstashRedisStore } from './db/upstashStore.js';
import { createProjectPilotMcpServer, MUTATING_TOOL_NAMES } from './mcp/server.js';
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
 * Constant-time comparison of two secret tokens using fixed-length SHA-256 digests.
 * Eliminates unequal-buffer-length timing leak side channels.
 *
 * @param {string} candidate - Supplied candidate token
 * @param {string} expected - Configured expected secret token
 * @returns {boolean} True if both tokens are non-empty strings and match exactly
 */
export function secureCompareTokens(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') {
    return false;
  }
  if (!candidate || !expected) {
    return false;
  }

  const candidateDigest = crypto.createHash('sha256').update(Buffer.from(candidate, 'utf8')).digest();
  const expectedDigest = crypto.createHash('sha256').update(Buffer.from(expected, 'utf8')).digest();

  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}

/**
 * Creates and configures the ProjectPilot HTTP Server.
 * @param {Object} options
 * @param {string} options.storePath - Optional path for JSON store
 * @param {string} options.apiKey - Optional API key for authenticating MCP requests
 * @param {string[]} options.allowedOrigins - Optional array of allowed CORS origins
 * @param {Object} options.rateLimit - Optional rate limiting options { windowMs, maxRequests, enabled }
 */
export async function createServer(options = {}) {
  const isProduction = options.isProduction !== undefined
    ? options.isProduction
    : (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL));

  const defaultStorePath = process.env.VERCEL
    ? path.join(os.tmpdir(), 'projectpilot-store.json')
    : path.resolve(__dirname, '..', 'data', 'store.json');
  const storePath = options.storePath || defaultStorePath;

  let store;
  if (options.store) {
    store = options.store;
  } else {
    // On serverless environments (e.g. Vercel) using local file fallback, copy seed data if needed
    if (process.env.VERCEL && !fs.existsSync(storePath) && !process.env.UPSTASH_REDIS_REST_URL && !options.url && !options.upstashUrl) {
      const seedPath = path.resolve(__dirname, '..', 'data', 'store.json');
      if (fs.existsSync(seedPath)) {
        try {
          fs.copyFileSync(seedPath, storePath);
        } catch {
          // Fallback: store.init() will initialize if missing
        }
      }
    }

    store = await createStore({
      ...options,
      storePath,
      isProduction
    });
  }

  const isDurable = Boolean(
    options.isDurable === true ||
    (store && store.constructor && store.constructor.name === 'UpstashRedisStore') ||
    (store && typeof store._command === 'function')
  );

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

    // Default development policy: allow localhost, 127.0.0.1, project-specific Vercel deployments, and same-host
    try {
      const parsedOrigin = new URL(origin);
      const host = parsedOrigin.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return origin;
      }
      if (
        host === 'project-pilot-ai-rho-blue.vercel.app' ||
        (host.startsWith('project-pilot-ai-') && host.endsWith('.vercel.app'))
      ) {
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
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    if (apiKey) {
      if (!token) {
        return {
          authenticated: false,
          status: 401,
          message: 'Authentication required: missing Bearer token or x-api-key header'
        };
      }

      if (!secureCompareTokens(token, apiKey)) {
        return {
          authenticated: false,
          status: 401,
          message: 'Authentication failed: invalid API key'
        };
      }

      return { authenticated: true };
    }

    if (isProduction) {
      return {
        authenticated: false,
        noKeyInProduction: true,
        status: 401,
        message: 'Authentication required: MCP_API_KEY must be configured in production for mutating operations.'
      };
    }

    return { authenticated: true };
  }

  const httpServer = http.createServer(async (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.socket?.remoteAddress || '127.0.0.1';

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
    const routeParam = parsedUrl.searchParams.get('route');
    const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'];
    const pathname = routeParam || (matchedPath ? new URL(matchedPath, 'http://localhost').pathname : parsedUrl.pathname);

    // 3. MCP Streamable HTTP Endpoint
    if (pathname === '/mcp') {
      // Synchronize freshest state from remote storage before processing request
      if (typeof store.sync === 'function') {
        await store.sync().catch(() => {});
      }

      // A. Authentication Verification
      const auth = authenticateRequest(req);
      if (apiKey && !auth.authenticated) {
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

        // Read and parse payload to check authorization and mutations
        let parsedBody = req.body;
        if (!parsedBody) {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const rawText = Buffer.concat(chunks).toString('utf8');
          try {
            parsedBody = JSON.parse(rawText);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32700, message: 'Parse error: Invalid JSON' },
              id: null
            }));
            return;
          }
        }

        const isToolCall = parsedBody?.method === 'tools/call';
        const toolName = parsedBody?.params?.name;
        const isMutating = isToolCall && MUTATING_TOOL_NAMES.has(toolName);

        // Security Guard 1: In production without durable persistence, refuse mutating operations
        if (isProduction && !isDurable && isMutating) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: `Service Unavailable: Durable persistence is not configured in this production environment. Mutating operation '${toolName}' is disabled to prevent data loss.`
            },
            id: parsedBody?.id || null
          }));
          return;
        }

        // Security Guard 2: In production without configured key, refuse mutating operations
        if (isProduction && !apiKey && isMutating) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="ProjectPilot MCP Gateway"'
          });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: `Authentication required: Mutating operation '${toolName}' is forbidden in production when MCP_API_KEY is not configured.`
            },
            id: parsedBody?.id || null
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
          const mcpServer = createProjectPilotMcpServer(store, {
            enableExtended: options.enableExtended !== undefined
              ? options.enableExtended
              : (process.env.PROJECTPILOT_EXTENDED_TOOLS === 'true'),
            isProduction,
            isDurable,
            authenticated: auth.authenticated,
            apiKey
          });
          await mcpServer.connect(transport);

          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
            }
          };
        }

        try {
          await transport.handleRequest(req, res, parsedBody);
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
    if (pathname === '/api/info' || pathname === '/api' || pathname === '/api/') {
      if (typeof store.sync === 'function') {
        await store.sync().catch(() => {});
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        product: 'ProjectPilot AI',
        status: 'operational',
        version: '1.0.0',
        protocol: 'Model Context Protocol (MCP) Streamable HTTP (2025-11-25)',
        authConfigured: Boolean(apiKey),
        storageBackend: isDurable ? 'upstash_redis' : 'local_json',
        isDurable,
        isProduction,
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

let defaultServerInstance = null;
let defaultServerPromise = null;

/**
 * Serverless request handler for environments like Vercel.
 * Lazily initializes and caches a single HTTP server instance.
 */
export default async function handler(req, res) {
  if (!defaultServerInstance) {
    if (!defaultServerPromise) {
      defaultServerPromise = createServer();
    }
    defaultServerInstance = await defaultServerPromise;
  }
  defaultServerInstance.server.emit('request', req, res);
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
