/**
 * ProjectPilot AI - Mock Upstash Redis REST Server for Offline Testing
 * Simulates the Upstash REST command API protocol over local HTTP.
 */

import http from 'node:http';

export function createMockUpstashServer(options = {}) {
  const expectedToken = options.token || 'mock-secret-token';
  const store = new Map();
  let failNext = false;
  let delayMs = 0;

  const server = http.createServer(async (req, res) => {
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }

    if (failNext) {
      failNext = false;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Upstash Cluster Error' }));
      return;
    }

    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${expectedToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let command;
    try {
      command = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad JSON' }));
      return;
    }

    if (!Array.isArray(command) || command.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Command must be an array' }));
      return;
    }

    const [cmd, ...args] = command;
    const op = String(cmd).toUpperCase();

    if (op === 'GET') {
      const key = args[0];
      const val = store.has(key) ? store.get(key) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: val }));
      return;
    }

    if (op === 'SET') {
      const [key, val] = args;
      store.set(key, val);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'OK' }));
      return;
    }

    if (op === 'SETNX') {
      const [key, val] = args;
      if (store.has(key)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: 0 }));
      } else {
        store.set(key, val);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: 1 }));
      }
      return;
    }

    if (op === 'EVAL') {
      // Simulate Compare-And-Swap (CAS) optimistic locking
      // args: [script, numkeys, key, expectedVersion, newPayload]
      const [script, numkeys, key, rawExpectedVersion, newPayload] = args;
      const expectedVersion = parseInt(rawExpectedVersion, 10);

      const current = store.get(key);
      if (!current) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'KEY_NOT_FOUND' }));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(current);
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CORRUPTED' }));
        return;
      }

      const curVer = parsed.meta?.version || 0;
      if (expectedVersion > 0 && curVer !== expectedVersion) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `VERSION_CONFLICT: Expected ${expectedVersion} but found ${curVer}`
        }));
        return;
      }

      store.set(key, newPayload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'OK' }));
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unsupported mock command: ${op}` }));
  });

  return {
    server,
    store,
    setFailNext: (val) => { failNext = val; },
    setDelay: (ms) => { delayMs = ms; },
    start: () => new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve({
          port: addr.port,
          url: `http://127.0.0.1:${addr.port}`,
          token: expectedToken
        });
      }).on('error', reject);
    }),
    stop: () => new Promise(resolve => server.close(resolve))
  };
}
