/**
 * ProjectPilot AI - In-Memory Rate Limiter
 * Provides sliding-window rate limiting per IP address to resist abuse and brute-force attempts.
 */

export class RateLimiter {
  /**
   * @param {Object} options
   * @param {number} options.windowMs - Window duration in milliseconds (default: 60,000ms / 1 min)
   * @param {number} options.maxRequests - Maximum requests allowed in window (default: 120)
   * @param {boolean} options.enabled - Whether rate limiting is enabled (default: true)
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000;
    this.maxRequests = options.maxRequests || 120;
    this.enabled = options.enabled !== false;
    this.hits = new Map();

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a request from the given IP is allowed under the rate limit.
   * @param {string} ip
   * @returns {{ allowed: boolean, remaining: number, retryAfter?: number }}
   */
  isAllowed(ip) {
    if (!this.enabled) {
      return { allowed: true, remaining: this.maxRequests };
    }

    const clientIp = ip || 'unknown';
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.hits.get(clientIp) || [];
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.hits.set(clientIp, timestamps);
      const oldest = timestamps[0];
      const resetInSeconds = Math.ceil((oldest + this.windowMs - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, resetInSeconds)
      };
    }

    timestamps.push(now);
    this.hits.set(clientIp, timestamps);
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length
    };
  }

  /**
   * Purge expired timestamps to prevent unbounded memory growth.
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [ip, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(t => t > windowStart);
      if (valid.length === 0) {
        this.hits.delete(ip);
      } else {
        this.hits.set(ip, valid);
      }
    }
  }

  /**
   * Reset all rate limit counters (useful in tests).
   */
  reset() {
    this.hits.clear();
  }

  /**
   * Stop timer and clean up resources.
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.hits.clear();
  }
}
