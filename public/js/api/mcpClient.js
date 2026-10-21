/**
 * ProjectPilot AI - Browser-side MCP Client
 * Communicates with the MCP server strictly over Streamable HTTP (spec: 2025-11-25).
 * Performs initialization, capability negotiation, tool discovery, and tool invocation.
 */

export class McpBrowserClient {
  constructor(endpoint = '/mcp') {
    this.endpoint = endpoint;
    this.sessionId = null;
    this.protocolVersion = '2025-11-25';
    this.connected = false;
    this.serverInfo = null;
    this.tools = [];
    this._requestId = 1;
    this.listeners = new Set();
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

    this._emit('request', {
      method: 'initialize',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: initPayload
    });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify(initPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`MCP Initialization failed [HTTP ${res.status}]: ${errText}`);
      this._emit('error', { stage: 'initialize', error: err.message });
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

    const notifyHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocolVersion
    };
    if (this.sessionId) {
      notifyHeaders['mcp-session-id'] = this.sessionId;
    }

    this._emit('request', { method: 'notifications/initialized', headers: notifyHeaders, body: notifyPayload });

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

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocolVersion
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    this._emit('request', { method: 'tools/list', headers, body: payload });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

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

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocolVersion
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    this._emit('tool_call_start', { name, args, payload, headers });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

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
      await fetch(this.endpoint, {
        method: 'DELETE',
        headers: { 'mcp-session-id': this.sessionId }
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
            } catch (err) {
              console.warn('Failed to parse SSE data chunk:', jsonStr);
            }
          }
        }
      }
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}
