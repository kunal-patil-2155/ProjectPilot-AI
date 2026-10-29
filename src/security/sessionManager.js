/**
 * ProjectPilot AI - Multi-Instance Serverless MCP Session Management
 *
 * Provides cryptographically signed, tamper-proof session tokens for MCP Streamable HTTP.
 * Enables zero-dependency cross-instance session validation and reconstruction across
 * serverless containers (e.g. Vercel) without requiring sticky sessions or external infrastructure.
 *
 * Phase D.2 Hardened:
 * - Reject future-dated timestamps exceeding clock-skew tolerance.
 * - Enforce fail-closed durable revocation behavior (no false-positive 200 on DB write failure).
 * - Differentiate durable (24h) vs non-durable (1h) session lifetimes.
 */

import crypto, { randomUUID } from 'node:crypto';

export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for durable sessions
export const DEFAULT_NON_DURABLE_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour for non-durable sessions
export const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 60 * 1000; // 60 seconds

/**
 * Creates a cryptographically signed session ID incorporating UUID, timestamp, and HMAC signature.
 * Format: `${uuid}_${timestampBase36}_${hmacSignature}`
 * Conforms strictly to MCP session format regex: /^[a-zA-Z0-9_-]{1,128}$/
 *
 * @param {string} secret - Shared secret key (minimum 32 characters in production)
 * @param {Object} [options]
 * @param {string} [options.id] - Optional custom UUID (defaults to randomUUID())
 * @param {number} [options.now] - Optional timestamp in ms (defaults to Date.now())
 * @returns {string} Signed session ID
 */
export function createSignedSessionId(secret, options = {}) {
  const id = options.id || randomUUID();
  const now = options.now !== undefined ? options.now : Date.now();
  const ts = now.toString(36);
  const payload = `${id}_${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}_${sig}`;
}

/**
 * Verifies a signed session ID and checks for future timestamps and expiration.
 *
 * @param {string} token - Candidate session ID
 * @param {string} secret - Shared secret key
 * @param {Object|number} [options=DEFAULT_SESSION_TTL_MS] - Options object or maxAgeMs number
 * @param {number} [options.maxAgeMs=DEFAULT_SESSION_TTL_MS] - Maximum permitted age in ms
 * @param {number} [options.clockSkewToleranceMs=DEFAULT_CLOCK_SKEW_TOLERANCE_MS] - Future-timestamp tolerance
 * @param {number} [options.now] - Optional reference time in ms (defaults to Date.now())
 * @returns {{ id: string, createdAt: number } | null} Parsed payload if valid, null otherwise
 */
export function verifySignedSessionId(token, secret, options = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('_');
  if (parts.length !== 3) return null;

  const [id, tsStr, sig] = parts;
  if (!id || !tsStr || !sig) return null;

  // Validate UUID part (case-insensitive 8-4-4-4-12 hex format)
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return null;
  }

  const payload = `${id}_${tsStr}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);

  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const createdAt = parseInt(tsStr, 36);
  if (isNaN(createdAt) || !Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }

  const maxAgeMs = typeof options === 'number'
    ? options
    : (options.maxAgeMs || DEFAULT_SESSION_TTL_MS);
  const clockSkewMs = typeof options === 'object' && options.clockSkewToleranceMs !== undefined
    ? options.clockSkewToleranceMs
    : DEFAULT_CLOCK_SKEW_TOLERANCE_MS;
  const now = typeof options === 'object' && options.now !== undefined
    ? options.now
    : Date.now();

  // Reject future-dated timestamps exceeding clock-skew tolerance
  if (createdAt > now + clockSkewMs) {
    return null;
  }

  // Reject expired tokens exceeding max permitted age
  if (now - createdAt > maxAgeMs) {
    return null;
  }

  return { id, createdAt };
}

/**
 * Multi-Instance Session Manager with Durable Revocation Support
 */
export class SessionManager {
  /**
   * @param {Object} options
   * @param {string} options.secret - Shared signing secret
   * @param {number} [options.ttlMs] - Session lifetime in milliseconds
   * @param {number} [options.clockSkewToleranceMs=DEFAULT_CLOCK_SKEW_TOLERANCE_MS] - Clock-skew tolerance
   * @param {boolean} [options.isDurable=false] - Whether durable storage is active
   * @param {Object} [options.store] - Optional store with remote Redis command support
   */
  constructor(options = {}) {
    if (!options.secret || typeof options.secret !== 'string') {
      throw new Error('SessionManager error: secret string is required.');
    }

    this.secret = options.secret;
    this.isDurable = Boolean(options.isDurable);
    this.ttlMs = options.ttlMs || (this.isDurable ? DEFAULT_SESSION_TTL_MS : DEFAULT_NON_DURABLE_SESSION_TTL_MS);
    this.clockSkewMs = options.clockSkewToleranceMs || DEFAULT_CLOCK_SKEW_TOLERANCE_MS;
    this.store = options.store || null;

    // Local in-memory session cache: sessionId -> { transport, createdAt }
    this.sessions = new Map();

    // Local revoked session cache: sessionId -> revokedTimestamp
    this.revokedSessions = new Map();
  }

  /**
   * Generate a new signed session token.
   * @returns {string}
   */
  generateSessionId() {
    return createSignedSessionId(this.secret);
  }

  /**
   * Verify a signed session token against this manager's secret, TTL, and clock skew.
   * @param {string} sessionId
   * @param {Object} [options]
   * @returns {{ id: string, createdAt: number } | null}
   */
  verifySessionId(sessionId, options = {}) {
    return verifySignedSessionId(sessionId, this.secret, {
      maxAgeMs: this.ttlMs,
      clockSkewToleranceMs: this.clockSkewMs,
      ...options
    });
  }

  /**
   * Check if a session is currently cached in local memory.
   * @param {string} sessionId
   * @returns {boolean}
   */
  hasLocal(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * Retrieve a locally cached session.
   * @param {string} sessionId
   * @returns {{ transport: any, createdAt: number } | undefined}
   */
  getLocal(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Cache a session locally.
   * @param {string} sessionId
   * @param {any} transport
   * @param {number} [createdAt]
   */
  setLocal(sessionId, transport, createdAt = Date.now()) {
    this.sessions.set(sessionId, { transport, createdAt });
  }

  /**
   * Remove a session from local cache.
   * @param {string} sessionId
   */
  deleteLocal(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Total number of active sessions in local instance memory.
   */
  get size() {
    return this.sessions.size;
  }

  /**
   * Check if a session has been revoked (locally or in remote storage).
   * Throws if durable store is configured but query fails (fails closed).
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async isRevoked(sessionId) {
    if (this.revokedSessions.has(sessionId)) {
      return true;
    }

    if (this.store && typeof this.store._command === 'function') {
      const val = await this.store._command(['GET', `mcp:revoked:${sessionId}`]);
      if (val) {
        this.revokedSessions.set(sessionId, Date.now());
        return true;
      }
    }

    return false;
  }

  /**
   * Revoke and terminate a session across instances.
   * Throws if durable persistence is configured but write fails (fails closed).
   * @param {string} sessionId
   */
  async revoke(sessionId) {
    this.revokedSessions.set(sessionId, Date.now());

    const local = this.sessions.get(sessionId);
    if (local) {
      try {
        await local.transport.close();
      } catch {}
      this.sessions.delete(sessionId);
    }

    if (this.store && typeof this.store._command === 'function') {
      const ttlSec = Math.max(60, Math.ceil(this.ttlMs / 1000));
      // Do not swallow: caller must know if durable revocation failed
      await this.store._command(['SET', `mcp:revoked:${sessionId}`, '1', 'EX', ttlSec]);
    }
  }

  /**
   * Resolves or reconstructs a transport for a given session ID.
   *
   * 1. Checks for revocation (fails closed if durable storage errors).
   * 2. Checks local in-memory session cache (and validates TTL).
   * 3. If missing from local memory, verifies HMAC token signature, clock-skew, and TTL.
   * 4. If valid, reconstructs transport via factory and caches locally.
   *
   * @param {string} sessionId
   * @param {Function} reconstructFn - Async factory `(sessionId, verified) => Promise<transport>`
   * @returns {Promise<any | null>} Transport instance or null if invalid/expired/revoked
   */
  async resolveTransport(sessionId, reconstructFn) {
    if (!sessionId) return null;

    // Check revocation (may throw if durable store is failing)
    if (await this.isRevoked(sessionId)) {
      return null;
    }

    // Check local in-memory session
    const local = this.sessions.get(sessionId);
    if (local) {
      if (Date.now() - local.createdAt > this.ttlMs) {
        // Expired in memory
        try {
          await local.transport.close();
        } catch {}
        this.sessions.delete(sessionId);
        return null;
      }
      return local.transport;
    }

    // Verify cryptographic signature, clock-skew, and TTL
    const verified = verifySignedSessionId(sessionId, this.secret, {
      maxAgeMs: this.ttlMs,
      clockSkewToleranceMs: this.clockSkewMs
    });
    if (!verified) {
      return null;
    }

    // Reconstruct transport for this serverless instance
    const transport = await reconstructFn(sessionId, verified);
    if (transport) {
      this.sessions.set(sessionId, { transport, createdAt: verified.createdAt });
    }
    return transport;
  }

  /**
   * Clean up expired sessions and tombstones from local memory.
   */
  cleanupExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.ttlMs) {
        try {
          session.transport.close();
        } catch {}
        this.sessions.delete(id);
      }
    }
    for (const [id, time] of this.revokedSessions.entries()) {
      if (now - time > this.ttlMs) {
        this.revokedSessions.delete(id);
      }
    }
  }

  /**
   * Close all active sessions.
   */
  async destroy() {
    for (const [, session] of this.sessions.entries()) {
      try {
        await session.transport.close();
      } catch {}
    }
    this.sessions.clear();
    this.revokedSessions.clear();
  }
}
