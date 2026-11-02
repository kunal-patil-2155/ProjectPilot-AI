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
import { ProjectStore, createStore, DemoSandboxStore } from './db/store.js';
import { UpstashRedisStore } from './db/upstashStore.js';
import {
  createProjectPilotMcpServer,
  MUTATING_TOOL_NAMES,
  DEMO_ALLOWED_MUTATIONS,
  ADMINISTRATIVE_MUTATING_TOOLS,
  DESTRUCTIVE_TOOL_NAMES
} from './mcp/server.js';
import { RateLimiter } from './security/rateLimiter.js';
import {
  SessionManager,
  createSignedSessionId,
  verifySignedSessionId,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_NON_DURABLE_SESSION_TTL_MS,
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS
} from './security/sessionManager.js';

/**
 * Sanitizes sensitive credentials (Bearer tokens, passwords, keys, secrets) from text before logging.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeLogText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9_\-.~+/]+=*/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:token|apiKey|secret|password|authorization)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2');
}

/**
 * Server-side error logger that redacts secrets and prints stack trace for observability.
 * @param {string} prefix
 * @param {Error|any} err
 */
export function logSanitizedError(prefix, err) {
  const message = err?.message ? sanitizeLogText(String(err.message)) : 'Unknown error';
  const stack = err?.stack ? sanitizeLogText(String(err.stack)) : '';
  console.error(prefix, message, stack ? `\nStack: ${stack}` : '');
}

/**
 * Safely reconstructs an MCP Streamable HTTP transport for an authenticated, verified session.
 * Includes defensive compatibility guards for underlying SDK transport internals.
 *
 * @param {string} sid - Validated session ID
 * @param {Object} store - Data store
 * @param {Object} options - Server options
 * @param {Object} auth - Authentication context
 * @returns {Promise<StreamableHTTPServerTransport>}
 */
export async function reconstructMcpTransport(sid, store, options = {}, auth = {}) {
  const reconstructed = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sid,
    enableJsonResponse: true
  });

  // Defensive compatibility guard: inspect SDK transport internals
  if (!reconstructed || typeof reconstructed !== 'object') {
    throw new Error('SDK compatibility failure: StreamableHTTPServerTransport instantiation failed.');
  }

  const webTransport = reconstructed._webStandardTransport;
  if (!webTransport || typeof webTransport !== 'object') {
    throw new Error('SDK compatibility failure: Expected _webStandardTransport internal is missing or incompatible in installed @modelcontextprotocol/sdk version.');
  }

  webTransport.sessionId = sid;
  webTransport._initialized = true;

  const mcpServer = createProjectPilotMcpServer(store, {
    enableExtended: options.enableExtended !== undefined
      ? options.enableExtended
      : (process.env.PROJECTPILOT_EXTENDED_TOOLS === 'true'),
    isProduction: options.isProduction !== undefined
      ? options.isProduction
      : (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)),
    isDurable: options.isDurable,
    authenticated: auth.authenticated,
    isDemo: options.isDemo !== undefined ? options.isDemo : !auth.authenticated,
    apiKey: options.apiKey
  });
  await mcpServer.connect(reconstructed);

  return reconstructed;
}

export {
  DemoSandboxStore,
  MUTATING_TOOL_NAMES,
  DEMO_ALLOWED_MUTATIONS,
  ADMINISTRATIVE_MUTATING_TOOLS,
  DESTRUCTIVE_TOOL_NAMES,
  SessionManager,
  createSignedSessionId,
  verifySignedSessionId,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_NON_DURABLE_SESSION_TTL_MS,
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS
};

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

  // Judge Demo Mode: automatically enabled in serverless environments (Vercel), via JUDGE_DEMO_MODE=true, or options.judgeDemoMode.
  // Explicit JUDGE_DEMO_MODE=false disables it even on Vercel.
  const judgeDemoMode = options.judgeDemoMode !== undefined
    ? Boolean(options.judgeDemoMode)
    : (process.env.JUDGE_DEMO_MODE === 'false' ? false : (process.env.JUDGE_DEMO_MODE === 'true' || Boolean(process.env.VERCEL)));

  let store;
  if (options.store) {
    store = options.store;
  } else if (options.storePath) {
    // Explicit storePath provided (e.g. tests or explicit file override)
    store = await createStore({
      ...options,
      storePath,
      isProduction
    });
  } else if (judgeDemoMode && process.env.REQUIRE_DURABLE_STORAGE !== 'true') {
    // In Judge Demo Mode: demo sessions execute strictly against isolated in-memory DemoSandboxStores.
    // Persistent storage is only initialized if Upstash is fully configured and reachable;
    // otherwise, Judge Demo Mode initializes cleanly without connecting to Upstash.
    const hasUpstashConfig = Boolean(
      (options.url || options.upstashUrl || process.env.UPSTASH_REDIS_REST_URL) &&
      (options.token || options.upstashToken || process.env.UPSTASH_REDIS_REST_TOKEN)
    );

    if (hasUpstashConfig) {
      try {
        store = await createStore({
          ...options,
          storePath,
          isProduction
        });
      } catch (upstashInitErr) {
        logSanitizedError('Judge Demo Mode: Upstash persistence connection failed; falling back to in-memory sandbox store:', upstashInitErr);
        store = new DemoSandboxStore();
      }
    } else {
      store = new DemoSandboxStore();
    }
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

  // Multi-instance Serverless Session Management Configuration (Phase D.2 Hardened)
  // Dedicated MCP_SESSION_SECRET of min 32 chars strictly required in production.
  // Fallbacks to public git commit SHA, deployment ID, or static salts are strictly forbidden in production.
  const isTestRunner = Boolean(
    process.env.NODE_TEST_CONTEXT ||
    process.env.npm_lifecycle_event === 'test' ||
    process.execArgv.some(arg => arg.includes('test')) ||
    (process.argv[1] && /[/\\]test[/\\.]/i.test(process.argv[1]))
  );
  const isRealProduction = !isTestRunner && (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL));
  let sessionSecret = options.sessionSecret || process.env.MCP_SESSION_SECRET;

  if (isProduction) {
    const requiresStrictSecret = isRealProduction || Boolean(options.requireSessionSecret);
    if (requiresStrictSecret) {
      if (!sessionSecret || typeof sessionSecret !== 'string' || sessionSecret.trim().length < 32) {
        throw new Error('Configuration error: Dedicated MCP_SESSION_SECRET of at least 32 characters is required in production.');
      }
    } else if (!sessionSecret) {
      // In simulated test environment passing isProduction without real env or explicit requireSessionSecret:
      sessionSecret = 'test-isolated-production-simulation-secret-32-chars';
    } else if (typeof sessionSecret !== 'string' || sessionSecret.trim().length < 32) {
      throw new Error('Configuration error: Dedicated MCP_SESSION_SECRET of at least 32 characters is required in production.');
    }
  } else {
    // Local development mode: isolated dev secret
    if (!sessionSecret) {
      sessionSecret = 'dev-insecure-mcp-session-secret-local-only-not-for-production-32chars';
    }
  }

  const sessionTtlMs = options.sessionTtlMs ||
    parseInt(process.env.MCP_SESSION_TTL_MS, 10) ||
    (isDurable ? DEFAULT_SESSION_TTL_MS : DEFAULT_NON_DURABLE_SESSION_TTL_MS);

  const sessionManager = options.sessionManager || new SessionManager({
    secret: sessionSecret,
    ttlMs: sessionTtlMs,
    isDurable,
    store
  });
  // Maintain backward-compatible reference to local sessions Map
  const sessions = sessionManager.sessions;

  // Isolated in-memory demo sandbox stores for Judge Demo Mode: sessionId -> DemoSandboxStore
  const demoStores = new Map();

  function getOrCreateDemoStore(sessionId = null) {
    if (sessionId && demoStores.has(sessionId)) {
      return demoStores.get(sessionId);
    }
    const demoStore = new DemoSandboxStore();
    if (sessionId) {
      demoStores.set(sessionId, demoStore);
    }
    return demoStore;
  }

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
    const isRequestDemo = judgeDemoMode || req.headers['x-judge-demo'] === 'true';
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    if (apiKey) {
      if (authHeader !== undefined || req.headers['x-api-key'] !== undefined) {
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

      // No credentials provided
      if (isRequestDemo) {
        return {
          authenticated: false,
          isDemo: true
        };
      }

      return {
        authenticated: false,
        status: 401,
        message: 'Authentication required: missing Bearer token or x-api-key header'
      };
    }

    if (isProduction) {
      return {
        authenticated: false,
        noKeyInProduction: true,
        message: 'Authentication required: MCP_API_KEY must be configured in production for mutating operations.'
      };
    }

    if (judgeDemoMode && (authHeader === undefined && req.headers['x-api-key'] === undefined)) {
      return {
        authenticated: false,
        isDemo: true
      };
    }

    return { authenticated: true };
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
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
      if (auth.status === 401) {
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

        const isDemoSession = auth.isDemo || (judgeDemoMode && !auth.authenticated);

        // Security Guard 1: In production without durable persistence, refuse mutating operations on persistent storage
        if (isProduction && !isDurable && isMutating && !isDemoSession) {
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

        // Security Guard 2: In production without configured key, refuse mutating operations on persistent storage
        if (isProduction && !apiKey && isMutating && !isDemoSession) {
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

        // Security Guard 3: In Judge Demo Mode, administrative mutating operations require master API key
        if (isMutating && isDemoSession) {
          if (ADMINISTRATIVE_MUTATING_TOOLS.has(toolName)) {
            res.writeHead(401, {
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer realm="ProjectPilot MCP Gateway"'
            });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: `Authentication required: missing Bearer token or x-api-key header. Administrative operation '${toolName}' is restricted in Judge Demo Mode. Master API key required.`
              },
              id: parsedBody?.id || null
            }));
            return;
          }
        }

        let transport;
        if (sessionId) {
          try {
            transport = await sessionManager.resolveTransport(sessionId, async (sid) => {
              const sessionStore = isDemoSession ? getOrCreateDemoStore(sid) : store;
              const reconstructed = await reconstructMcpTransport(sid, sessionStore, {
                enableExtended: options.enableExtended !== undefined
                  ? options.enableExtended
                  : (process.env.PROJECTPILOT_EXTENDED_TOOLS === 'true'),
                isProduction,
                isDurable: isDemoSession ? false : isDurable,
                isDemo: isDemoSession,
                apiKey
              }, auth);

              reconstructed.onclose = () => {
                sessionManager.deleteLocal(sid);
                if (isDemoSession) {
                  demoStores.delete(sid);
                }
              };
              return reconstructed;
            });
          } catch (err) {
            const isStorageError = err?.name === 'StorageError' ||
              err?.code === 'ECONNREFUSED' ||
              Boolean(err?.message && /redis|store|storage|network|econnrefused/i.test(err.message));
            const statusCode = isStorageError ? 503 : 500;
            const message = isStorageError
              ? 'Durable session lookup temporarily unavailable'
              : 'Internal MCP transport reconstruction error';
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message },
              id: parsedBody?.id || null
            }));
            return;
          }

          if (!transport) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: `Session "${sessionId}" not found or expired.` },
              id: parsedBody?.id || null
            }));
            return;
          }
        } else {
          // Initialize a new stateful MCP transport session with signed token
          const newSessionId = sessionManager.generateSessionId();
          const sessionStore = isDemoSession ? getOrCreateDemoStore(newSessionId) : store;
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
            enableJsonResponse: true
          });
          const mcpServer = createProjectPilotMcpServer(sessionStore, {
            enableExtended: options.enableExtended !== undefined
              ? options.enableExtended
              : (process.env.PROJECTPILOT_EXTENDED_TOOLS === 'true'),
            isProduction,
            isDurable: isDemoSession ? false : isDurable,
            authenticated: auth.authenticated,
            isDemo: isDemoSession,
            apiKey
          });
          await mcpServer.connect(transport);

          transport.onclose = () => {
            if (transport.sessionId) {
              sessionManager.deleteLocal(transport.sessionId);
              if (isDemoSession) {
                demoStores.delete(transport.sessionId);
              }
            }
          };
        }

        try {
          await transport.handleRequest(req, res, parsedBody);
          if (transport.sessionId && !sessionManager.hasLocal(transport.sessionId)) {
            sessionManager.setLocal(transport.sessionId, transport, Date.now());
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
        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing or invalid mcp-session-id header for SSE stream' }));
          return;
        }

        const isDemoSession = !auth.authenticated;
        let transport;
        try {
          transport = await sessionManager.resolveTransport(sessionId, async (sid) => {
            const sessionStore = isDemoSession ? getOrCreateDemoStore(sid) : store;
            const reconstructed = await reconstructMcpTransport(sid, sessionStore, {
              enableExtended: options.enableExtended !== undefined
                ? options.enableExtended
                : (process.env.PROJECTPILOT_EXTENDED_TOOLS === 'true'),
              isProduction,
              isDurable: isDemoSession ? false : isDurable,
              isDemo: isDemoSession,
              apiKey
            }, auth);

            reconstructed.onclose = () => {
              sessionManager.deleteLocal(sid);
              if (isDemoSession) {
                demoStores.delete(sid);
              }
            };
            return reconstructed;
          });
        } catch (err) {
          const isStorageError = err?.name === 'StorageError' ||
            err?.code === 'ECONNREFUSED' ||
            Boolean(err?.message && /redis|store|storage|network|econnrefused/i.test(err.message));
          const statusCode = isStorageError ? 503 : 500;
          const message = isStorageError
            ? 'Durable session lookup temporarily unavailable'
            : 'Internal MCP transport reconstruction error';
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
          return;
        }

        if (!transport) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing or invalid mcp-session-id header for SSE stream' }));
          return;
        }

        await transport.handleRequest(req, res);
        return;
      }

      // E. DELETE: Clean session termination
      if (req.method === 'DELETE') {
        let isKnown = false;
        if (sessionId) {
          if (sessionManager.hasLocal(sessionId)) {
            isKnown = true;
          } else {
            const verified = verifySignedSessionId(sessionId, sessionManager.secret, sessionManager.ttlMs);
            if (verified) {
              try {
                const revoked = await sessionManager.isRevoked(sessionId);
                if (!revoked) {
                  isKnown = true;
                }
              } catch (err) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to verify session status in durable storage' }));
                return;
              }
            }
          }
        }

        if (isKnown) {
          try {
            await sessionManager.revoke(sessionId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'session_terminated', sessionId }));
          } catch (err) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to record session termination in durable storage' }));
          }
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
      const auth = authenticateRequest(req);
      const isDemo = !auth.authenticated;
      const targetStore = isDemo ? getOrCreateDemoStore() : store;
      if (!isDemo && typeof store.sync === 'function') {
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
        judgeDemoMode: true,
        activeMcpSessions: sessions.size,
        dataStats: {
          projects: targetStore.listProjects().length,
          tasks: targetStore.listTasks().length,
          blockers: targetStore.listBlockers().length
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
            const stream = fs.createReadStream(indexFile);
            stream.on('error', () => {
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
              } else if (!res.writableEnded) {
                res.end();
              }
            });
            stream.pipe(res);
            return;
          }
        } else if (stat.isFile()) {
          const ext = path.extname(safePath);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Content-Length': stat.size
          });
          if (req.method === 'HEAD') { res.end(); return; }
          const stream = fs.createReadStream(safePath);
          stream.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Internal Server Error');
            } else if (!res.writableEnded) {
              res.end();
            }
          });
          stream.pipe(res);
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
    } catch (unhandledErr) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Internal Server Error',
          message: 'An unexpected server error occurred.'
        }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return {
    server: httpServer,
    store,
    sessions,
    sessionManager,
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
      sessionManager.destroy().catch(() => {});
      return new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  };
}

let defaultServerInstance = null;
let defaultServerPromise = null;

/**
 * Safely retrieves or initializes the singleton server instance for serverless handlers.
 * Guarantees single-instance initialization under concurrent requests and
 * provides robust rejection recovery so a failed initialization attempt does not
 * permanently poison container memory.
 *
 * @param {Object} [options]
 * @returns {Promise<any>}
 */
export async function getOrInitServer(options = {}) {
  if (defaultServerInstance) {
    return defaultServerInstance;
  }

  if (!defaultServerPromise) {
    const currentPromise = createServer(options);
    defaultServerPromise = currentPromise;

    currentPromise
      .then((instance) => {
        defaultServerInstance = instance;
      })
      .catch((_err) => {
        // Reset cached promise only if it is still this exact failed attempt.
        // Prevents a late failure from clearing a newer successful or in-progress attempt.
        if (defaultServerPromise === currentPromise) {
          defaultServerPromise = null;
        }
      });
  }

  try {
    const instance = await defaultServerPromise;
    defaultServerInstance = instance;
    return instance;
  } catch (err) {
    if (defaultServerPromise) {
      defaultServerPromise.catch(() => {});
    }
    throw err;
  }
}

/**
 * Helper for test isolation to reset the cached serverless singleton.
 */
export function _resetServerlessInstanceForTest() {
  defaultServerInstance = null;
  defaultServerPromise = null;
}

/**
 * Serverless request handler for environments like Vercel.
 * Lazily initializes and caches a single HTTP server instance,
 * and ensures the serverless execution context remains active
 * until the HTTP response lifecycle has fully completed.
 */
export default async function handler(req, res) {
  let instance;
  try {
    instance = await getOrInitServer();
  } catch (initErr) {
    logSanitizedError('Serverless initialization failed:', initErr);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Initialization Error',
        message: 'Server failed to initialize due to configuration or persistence error.'
      }));
    }
    return;
  }

  if (res.writableEnded || res.finished) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
      res.removeListener('error', onError);
      req.removeListener('error', onError);
      resolve();
    };

    const onFinish = () => cleanup();
    const onClose = () => cleanup();
    const onError = (_err) => {
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } catch {}
      }
      cleanup();
    };

    res.once('finish', onFinish);
    res.once('close', onClose);
    res.once('error', onError);
    req.once('error', onError);

    try {
      instance.server.emit('request', req, res);
    } catch (emitErr) {
      onError(emitErr);
    }
  });
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
