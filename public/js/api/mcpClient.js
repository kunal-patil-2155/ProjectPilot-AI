/**
 * ProjectPilot AI - Browser-side MCP Client
 * Communicates with the MCP server strictly over Streamable HTTP (spec: 2025-11-25).
 * Performs initialization, capability negotiation, tool discovery, and tool invocation.
 * Supports secure authentication credentials (Bearer token / API key) when configured.
 */

export class McpBrowserClient {
  /**
   * @param {string} endpoint - HTTP URL to the MCP Streamable HTTP endpoint (default: '/mcp')
   * @param {Object|string} options - Configuration options or API key string
   * @param {string} options.apiKey - Optional API key for authenticating requests
   */
  constructor(endpoint = '/mcp', options = {}) {
    this.endpoint = endpoint;
    const opts = typeof options === 'string' ? { apiKey: options } : options;
    this.apiKey = opts.apiKey ? String(opts.apiKey).trim() : null;
    this.sessionId = null;
    this.protocolVersion = '2025-11-25';
    this.connected = false;
    this.serverInfo = null;
    this.tools = [];
    this._requestId = 1;
    this.listeners = new Set();
  }

  /**
   * Set or update authentication credential in memory.
   * @param {string|null} key
   */
  setApiKey(key) {
    this.apiKey = key ? String(key).trim() : null;
  }

  /**
   * Remove authentication credential from memory.
   */
  clearApiKey() {
    this.apiKey = null;
  }

  /**
   * Check if client currently holds an authentication credential in memory.
   * @returns {boolean}
   */
  hasApiKey() {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  /**
   * Return a copy of headers with sensitive authorization tokens redacted.
   */
  _sanitizeHeaders(headers) {
    if (!headers) return headers;
    const sanitized = { ...headers };
    if (sanitized['Authorization']) {
      sanitized['Authorization'] = 'Bearer [REDACTED]';
    }
    if (sanitized['authorization']) {
      sanitized['authorization'] = 'Bearer [REDACTED]';
    }
    if (sanitized['x-api-key']) {
      sanitized['x-api-key'] = '[REDACTED]';
    }
    return sanitized;
  }

  /**
   * Construct standard MCP headers including session and authentication tokens.
   */
  _buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocolVersion,
      ...extra
    };
    if (this.sessionId && !headers['mcp-session-id']) {
      headers['mcp-session-id'] = this.sessionId;
    }
    if (this.apiKey && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Register event listener for protocol activities (request, response, error).
   */
  onEvent(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _emit(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (err) {
        console.error('Listener error:', err);
      }
    }
  }

  /**
   * Connect and perform the full MCP initialization handshake.
   */
  async connect() {
    this._emit('connecting', { endpoint: this.endpoint });

    const initPayload = {
      jsonrpc: '2.0',
      id: this._requestId++,
      method: 'initialize',
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {
          roots: { listChanged: true },
          sampling: {}
        },
        clientInfo: {
          name: 'ProjectPilot-WebClient',
          version: '1.0.0'
        }
      }
    };

    const headers = this._buildHeaders();
    this._emit('request', {
      method: 'initialize',
      headers: this._sanitizeHeaders(headers),
      body: initPayload
    });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(initPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`MCP Initialization failed [HTTP ${res.status}]: ${errText}`);
      this._emit('error', { stage: 'initialize', status: res.status, error: err.message });
      throw err;
    }

    // Extract Session ID from header
    const sid = res.headers.get('mcp-session-id');
    this.sessionId = sid;

    const data = await this._parseResponse(res);
    this._emit('response', { stage: 'initialize', sessionId: sid, data });

    if (data.error) {
      throw new Error(`MCP Initialization rejected: ${data.error.message}`);
    }

    this.serverInfo = data.result?.serverInfo || null;

    // Send notifications/initialized
    const notifyPayload = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    };

    const notifyHeaders = this._buildHeaders();
    this._emit('request', { method: 'notifications/initialized', headers: this._sanitizeHeaders(notifyHeaders), body: notifyPayload });

    await fetch(this.endpoint, {
      method: 'POST',
      headers: notifyHeaders,
      body: JSON.stringify(notifyPayload)
    });

    this.connected = true;
    this._emit('connected', {
      sessionId: this.sessionId,
      serverInfo: this.serverInfo,
      protocolVersion: this.protocolVersion
    });

    // Discover tools
    await this.listTools();
    return this.tools;
  }

  /**
   * Discover available MCP tools.
   */
  async listTools() {
    if (!this.connected && !this.sessionId) {
      await this.connect();
    }

    const payload = {
      jsonrpc: '2.0',
      id: this._requestId++,
      method: 'tools/list',
      params: {}
    };

    const headers = this._buildHeaders();
    this._emit('request', { method: 'tools/list', headers: this._sanitizeHeaders(headers), body: payload });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (res.status === 404 && this.sessionId) {
      // Session expired or serverless container recycled; reconnect and retry once
      this.connected = false;
      this.sessionId = null;
      await this.connect();
      return this.listTools();
    }

    const data = await this._parseResponse(res);
    this._emit('response', { stage: 'tools/list', data });

    if (data.error) {
      throw new Error(`Failed to list tools: ${data.error.message}`);
    }

    this.tools = data.result?.tools || [];
    this._emit('tools_discovered', { count: this.tools.length, tools: this.tools });
    return this.tools;
  }

  /**
   * Invoke a tool with arguments.
   * @param {string} name
   * @param {Object} args
   */
  async callTool(name, args = {}) {
    if (!this.connected) {
      await this.connect();
    }

    const payload = {
      jsonrpc: '2.0',
      id: this._requestId++,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    };

    const headers = this._buildHeaders();
    this._emit('tool_call_start', { name, args, payload, headers: this._sanitizeHeaders(headers) });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (res.status === 404 && this.sessionId) {
      // Session expired or serverless container recycled; reconnect and retry once
      this.connected = false;
      this.sessionId = null;
      await this.connect();
      return this.callTool(name, args);
    }

    const data = await this._parseResponse(res);
    this._emit('tool_call_result', { name, args, data });

    if (data.error) {
      throw new Error(data.error.message);
    }

    const result = data.result;
    if (result?.isError) {
      const msg = result.content?.map(c => c.text).join('\n') || 'Tool execution error';
      throw new Error(msg);
    }

    // Parse structured JSON from content if possible
    let parsedContent = null;
    const textChunk = result?.content?.[0]?.text;
    if (textChunk) {
      try {
        parsedContent = JSON.parse(textChunk);
      } catch {
        parsedContent = textChunk;
      }
    }

    return {
      raw: result,
      data: parsedContent
    };
  }

  /**
   * Terminate the session cleanly with DELETE request.
   */
  async disconnect() {
    if (!this.sessionId) return;
    try {
      const headers = this._buildHeaders();
      await fetch(this.endpoint, {
        method: 'DELETE',
        headers
      });
    } catch (err) {
      console.warn('Disconnect notification failed:', err);
    } finally {
      this.connected = false;
      this.sessionId = null;
      this._emit('disconnected', {});
    }
  }

  /**
   * Helper to parse JSON or SSE format responses from Streamable HTTP.
   */
  async _parseResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (contentType.includes('application/json') || text.trim().startsWith('{')) {
      try {
        return JSON.parse(text);
      } catch {
        // Fallback below
      }
    }

    // Parse SSE stream format: "event: message\ndata: {...}\n\n"
    if (text.includes('data:')) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          if (jsonStr) {
            try {
              return JSON.parse(jsonStr);
            } catch {}
          }
        }
      }
    }

    return { raw: text };
  }
}
