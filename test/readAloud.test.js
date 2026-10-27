/**
 * ProjectPilot AI - READ ALOUD 2.0 Test Suite
 * Validates text normalization, natural chunking, multi-byte Unicode / Devanagari handling,
 * voice selection, sequential queue transitions, cancellation, and stall protection.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTextForSpeech,
  chunkTextForSpeech,
  detectSpeechLanguage,
  getBestVoice,
  calculateWatchdogTimeout,
  ReadAloudEngine
} from '../public/js/speech/readAloudEngine.js';

describe('ProjectPilot AI - READ ALOUD 2.0', () => {

  // ========================================================================
  // 1. TEXT NORMALIZATION UNIT TESTS
  // ========================================================================
  describe('1. Text Normalization (normalizeTextForSpeech)', () => {
    test('cleans markdown headers with natural pauses', () => {
      const raw = '### Project Health Audit\nAll services operational.';
      const normalized = normalizeTextForSpeech(raw);
      assert.match(normalized, /Project Health Audit\./);
      assert.match(normalized, /All services operational\./);
      assert.ok(!normalized.includes('###'));
    });

    test('cleans bold, italic, and strikethrough delimiters while preserving words', () => {
      const raw = 'The **critical blocker** is *partially resolved* and ~~obsolete~~.';
      const normalized = normalizeTextForSpeech(raw);
      assert.equal(normalized, 'The critical blocker is partially resolved and obsolete.');
    });

    test('normalizes blockquotes with spoken note indicator', () => {
      const raw = '> Ensure production database credentials are never logged.';
      const normalized = normalizeTextForSpeech(raw);
      assert.match(normalized, /Note: Ensure production database credentials are never logged\./);
      assert.ok(!normalized.includes('>'));
    });

    test('converts markdown links to spoken label', () => {
      const raw = 'Please refer to [Developer Documentation](https://docs.projectpilot.ai/mcp) for details.';
      const normalized = normalizeTextForSpeech(raw);
      assert.equal(normalized, 'Please refer to Developer Documentation for details.');
    });

    test('simplifies bare URLs into natural spoken domains and paths', () => {
      const raw = 'Repository: https://github.com/kunal-patil-2155/vedant-market';
      const normalized = normalizeTextForSpeech(raw);
      assert.ok(!normalized.includes('https://'));
      assert.ok(normalized.includes('github.com'));
      assert.ok(normalized.includes('kunal-patil-2155 slash vedant-market'));
    });

    test('converts inline code identifiers naturally (spaces for underscores, camelCase)', () => {
      const raw = 'Execute `inspect_github_repo` for `task-checkout-1` with `PORT=3000`.';
      const normalized = normalizeTextForSpeech(raw);
      assert.ok(normalized.includes('inspect github repo'));
      assert.ok(normalized.includes('task checkout 1'));
      assert.ok(normalized.includes('PORT equals 3000'));
      assert.ok(!normalized.includes('`'));
    });

    test('normalizes intra-word underscores to spaces without breaking markdown emphasis or sentinels', () => {
      const raw = 'The sentinel token is FINAL_SENTINEL_2026 and variable is USER_SESSION_ID.';
      const normalized = normalizeTextForSpeech(raw);
      assert.ok(normalized.includes('FINAL SENTINEL 2026'), `Expected 'FINAL SENTINEL 2026', got: ${normalized}`);
      assert.ok(normalized.includes('USER SESSION ID'), `Expected 'USER SESSION ID', got: ${normalized}`);
      assert.ok(!normalized.includes('FINALSENTINEL2026'), 'Underscores must not fuse words as italic');
    });

    test('converts single-line and multi-line code blocks gracefully', () => {
      const single = 'Run this:\n```bash\nnpm test\n```';
      const normSingle = normalizeTextForSpeech(single);
      assert.ok(normSingle.includes('code command: npm test'));

      const multi = '```javascript\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```';
      const normMulti = normalizeTextForSpeech(multi);
      assert.ok(normMulti.includes('code snippet: const a = 1, and 2 more lines'));
    });

    test('converts markdown tables into spoken column headers and row items without raw pipes', () => {
      const table = `
| Project | Status | Health |
|---|---|---|
| DevPulse | Active | 92% |
| CloudSync | Blocked | 45% |
`;
      const normalized = normalizeTextForSpeech(table);
      assert.ok(!normalized.includes('|'));
      assert.ok(normalized.includes('Table with columns: Project, Status, Health.'));
      assert.ok(normalized.includes('Item: Project: DevPulse, Status: Active, Health: 92%.'));
      assert.ok(normalized.includes('Item: Project: CloudSync, Status: Blocked, Health: 45%.'));
    });

    test('converts bullet points and numbered lists to natural spoken items', () => {
      const list = `
* First priority
* Second priority
1. Run diagnostics
2. Apply patch
`;
      const normalized = normalizeTextForSpeech(list);
      assert.ok(normalized.includes('• First priority.'));
      assert.ok(normalized.includes('• Second priority.'));
      assert.ok(normalized.includes('Step 1: Run diagnostics.'));
      assert.ok(normalized.includes('Step 2: Apply patch.'));
    });

    test('expands developer acronyms (MCP, API, JSON, CI/CD, AST)', () => {
      const raw = 'The MCP API returns a JSON payload verified by CI/CD and AST.';
      const normalized = normalizeTextForSpeech(raw);
      assert.ok(normalized.includes('M C P'));
      assert.ok(normalized.includes('A P I'));
      assert.ok(normalized.includes('Jason'));
      assert.ok(normalized.includes('C I C D'));
      assert.ok(normalized.includes('A S T'));
    });

    test('preserves Hindi and Marathi Devanagari text and punctuation', () => {
      const marathi = 'प्रकल्पाचे काम वेळेत सुरू आहे। सर्व चाचण्या यशस्वी झाल्या॥';
      const normalized = normalizeTextForSpeech(marathi);
      assert.ok(normalized.includes('प्रकल्पाचे काम वेळेत सुरू आहे।'));
      assert.ok(normalized.includes('सर्व चाचण्या यशस्वी झाल्या॥'));
    });

    test('handles empty and null inputs safely', () => {
      assert.equal(normalizeTextForSpeech(''), '');
      assert.equal(normalizeTextForSpeech(null), '');
      assert.equal(normalizeTextForSpeech(undefined), '');
      assert.equal(normalizeTextForSpeech('   \n  \t '), '');
    });
  });

  // ========================================================================
  // 2. TEXT CHUNKING UNIT TESTS
  // ========================================================================
  describe('2. Text Chunking (chunkTextForSpeech)', () => {
    test('returns single chunk for text under max length', () => {
      const text = 'Short response that fits in one chunk.';
      const chunks = chunkTextForSpeech(text, 180);
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0], text);
    });

    test('splits long text by sentence terminators (. ! ?)', () => {
      const text = 'First sentence is clear and concise. Second sentence gives more details about the deployment. Third sentence concludes the status report successfully.';
      const chunks = chunkTextForSpeech(text, 80);
      assert.ok(chunks.length >= 2);
      for (const chunk of chunks) {
        assert.ok(chunk.length <= 100, `Chunk exceeds expected bounds: ${chunk}`);
      }
    });

    test('splits Devanagari text using danda (।) and double danda (॥) boundaries', () => {
      const text = 'हा पहिला विभाग आहे आणि यात प्रकल्पाची माहिती आहे। हा दुसरा विभाग आहे ज्यात अडचणींची यादी दिली आहे॥ हा तिसरा विभाग आहे ज्यात पुढील पावले स्पष्ट केली आहेत।';
      const chunks = chunkTextForSpeech(text, 80);
      assert.ok(chunks.length >= 2);
      assert.ok(chunks[0].includes('पहिला विभाग'));
    });

    test('never breaks surrogate pairs or Unicode code points', () => {
      const emojiText = '🚀'.repeat(60); // 60 emojis (each 2 UTF-16 code units)
      const chunks = chunkTextForSpeech(emojiText, 40);
      assert.ok(chunks.length > 1);
      for (const chunk of chunks) {
        // Assert every emoji is intact (length in codepoints equals count of emojis)
        const codePoints = Array.from(chunk);
        for (const cp of codePoints) {
          assert.equal(cp, '🚀');
        }
      }
    });

    test('handles very long responses (>30 paragraphs, >20,000 characters) with final sentinel verification', () => {
      const paragraphs = [];
      for (let i = 1; i <= 35; i++) {
        paragraphs.push(
          `### Module Assessment ${i}: Subsystem Verification\n` +
          `ProjectPilot AI evaluated telemetry component #${i} across distributed nodes and verified operational readiness. ` +
          `All MCP tools confirmed status healthy, CAS concurrency resolved, and test coverage exceeded 95 percent. ` +
          `* Verified unit assertions for microservice #${i}.\n` +
          `* Validated latency threshold of less than 10 milliseconds.\n` +
          `* Verified database integrity and Upstash Redis synchronization for partition #${i}.\n` +
          `Diagnostic analysis concludes that subsystem #${i} has zero active blockers, healthy performance, and full compliance.`
        );
      }
      paragraphs.push(
        `### Verification Conclusion\n` +
        `FINAL_SENTINEL_2026: ProjectPilot operations assistant confirmed all 35 modules operational.`
      );
      const fullDoc = paragraphs.join('\n\n');
      assert.ok(fullDoc.length > 20000, `Expected > 20,000 characters, got: ${fullDoc.length}`);
      assert.ok(paragraphs.length >= 36, `Expected >= 36 paragraphs, got: ${paragraphs.length}`);

      const normalized = normalizeTextForSpeech(fullDoc);
      const chunks = chunkTextForSpeech(normalized, 180);
      assert.ok(chunks.length >= 80, `Expected >= 80 chunks for 20k chars, got: ${chunks.length}`);

      // First chunk check
      assert.ok(chunks[0].includes('Module Assessment 1'));

      // Final chunk check: MUST contain final sentinel phrase
      const lastChunk = chunks[chunks.length - 1];
      assert.ok(
        lastChunk.includes('FINAL SENTINEL 2026'),
        `Final chunk must contain sentinel phrase, got: "${lastChunk}"`
      );
      assert.ok(lastChunk.includes('all 35 modules operational'));
    });

    test('handles empty or whitespace-only inputs without throwing', () => {
      assert.deepEqual(chunkTextForSpeech(''), []);
      assert.deepEqual(chunkTextForSpeech('   \n\t  '), []);
      assert.deepEqual(chunkTextForSpeech(null), []);
      assert.deepEqual(chunkTextForSpeech(undefined), []);
    });
  });

  // ========================================================================
  // 3. LANGUAGE DETECTION & VOICE SELECTION TESTS
  // ========================================================================
  describe('3. Language Detection & Voice Selection', () => {
    test('detects Marathi when distinctive Marathi tokens are present', () => {
      const mr1 = 'प्रकल्पाचे काम वेळेत सुरू आहे, काही अडचण नाही.';
      assert.equal(detectSpeechLanguage(mr1), 'mr');

      const mr2 = 'मला सांगा काय झाले आहे.';
      assert.equal(detectSpeechLanguage(mr2), 'mr');
    });

    test('detects Hindi when Devanagari is present without Marathi tokens', () => {
      const hi = 'यह प्रोजेक्ट सफलतापूर्वक पूरा हो गया है और सभी सेवाएं सक्रिय हैं।';
      assert.equal(detectSpeechLanguage(hi), 'hi');
    });

    test('detects English for Latin script text', () => {
      const en = 'All 10 MCP tools are operational and the project health score is 92%.';
      assert.equal(detectSpeechLanguage(en), 'en');
    });

    test('selects preferred voice when matching URI is provided', () => {
      const mockVoices = [
        { voiceURI: 'google-en-us', name: 'Google US English', lang: 'en-US' },
        { voiceURI: 'ms-natural-jenny', name: 'Microsoft Jenny Natural', lang: 'en-US' }
      ];
      const selected = getBestVoice(mockVoices, 'en', 'ms-natural-jenny');
      assert.equal(selected.voiceURI, 'ms-natural-jenny');
    });

    test('prioritizes natural/neural English voices when no preference is set', () => {
      const mockVoices = [
        { voiceURI: 'generic-desktop', name: 'Desktop David', lang: 'en-US' },
        { voiceURI: 'google-natural', name: 'Google Natural English', lang: 'en-US' }
      ];
      const selected = getBestVoice(mockVoices, 'en');
      assert.equal(selected.voiceURI, 'google-natural');
    });

    test('selects Marathi voice if available, or falls back to Hindi / Indian English', () => {
      const mockVoicesWithoutMarathi = [
        { voiceURI: 'google-hi', name: 'Google Hindi', lang: 'hi-IN' },
        { voiceURI: 'google-en-in', name: 'Google Indian English', lang: 'en-IN' },
        { voiceURI: 'standard-en', name: 'Standard US English', lang: 'en-US' }
      ];
      const selected = getBestVoice(mockVoicesWithoutMarathi, 'mr');
      assert.equal(selected.voiceURI, 'google-hi');

      const mockVoicesWithMarathi = [
        { voiceURI: 'mr-natural', name: 'Marathi Natural', lang: 'mr-IN' },
        { voiceURI: 'google-hi', name: 'Google Hindi', lang: 'hi-IN' }
      ];
      const selectedMarathi = getBestVoice(mockVoicesWithMarathi, 'mr');
      assert.equal(selectedMarathi.voiceURI, 'mr-natural');
    });

    test('gracefully handles empty voices list', () => {
      assert.equal(getBestVoice([], 'en'), null);
      assert.equal(getBestVoice(null, 'en'), null);
    });
  });

  // Mock SpeechSynthesis implementation for unit testing
  class MockUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1.0;
      this.pitch = 1.0;
      this.volume = 1.0;
      this.voice = null;
      this.lang = 'en-US';
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  class MockSpeechSynthesis {
    constructor() {
      this.speaking = false;
      this.paused = false;
      this.queue = [];
      this.voices = [
        { voiceURI: 'google-en-us', name: 'Google US English Natural', lang: 'en-US', default: true },
        { voiceURI: 'google-hi-in', name: 'Google Hindi', lang: 'hi-IN', default: false }
      ];
    }

    getVoices() {
      return this.voices;
    }

    speak(utterance) {
      this.speaking = true;
      this.paused = false;
      this.queue.push(utterance);
      // Simulate asynchronous speech start
      setTimeout(() => {
        if (utterance.onstart) utterance.onstart();
      }, 1);
    }

    pause() {
      this.paused = true;
    }

    resume() {
      this.paused = false;
    }

    cancel() {
      this.speaking = false;
      this.paused = false;
      const remaining = [...this.queue];
      this.queue = [];
      for (const u of remaining) {
        if (u.onerror) u.onerror({ error: 'canceled' });
      }
    }

    // Test helper: manually simulate utterance finish
    simulateChunkFinished(index) {
      if (this.queue[index] && this.queue[index].onend) {
        this.queue[index].onend();
      }
    }
  }

  // Set global mock if in Node environment
  globalThis.SpeechSynthesisUtterance = MockUtterance;

  // ========================================================================
  // 4. READ ALOUD ENGINE STATE MACHINE & SEQUENTIAL QUEUE
  // ========================================================================
  describe('4. ReadAloudEngine Sequential Queue & Lifecycle', () => {

    test('initializes with default calm rate (0.95) and idle status', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });
      assert.equal(engine.status, 'idle');
      assert.equal(engine.rate, 0.95);
      assert.equal(engine.pitch, 1.0);
    });

    test('starts playback, chunks text, and emits progress on first chunk', (t, done) => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      let progressFired = false;
      engine.onProgress((p) => {
        progressFired = true;
        assert.equal(p.currentIndex, 0);
        assert.ok(p.totalChunks >= 2);
        assert.ok(p.chunkText.length > 0);
      });

      const longText = 'First sentence of the response details the initial investigation and active repository status. Second sentence explains the detailed steps needed to remediate critical blockers. Third sentence concludes the action plan with verification.';
      engine.speak(longText);

      assert.equal(engine.status, 'playing');
      assert.equal(mockSynth.queue.length, 1);
      assert.ok(progressFired);
      engine.stop();
      done();
    });

    test('sequentially advances through all chunks until completion', (t, done) => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      const progressEvents = [];
      engine.onProgress((p) => progressEvents.push(p.currentIndex));

      engine.onComplete(({ totalChunks }) => {
        assert.equal(engine.status, 'completed');
        assert.equal(progressEvents.length, totalChunks);
        assert.deepEqual(progressEvents, [0, 1, 2]);
        done();
      });

      const threeSentences = 'First step is inspecting logs and verifying all service health indicators across all microservices. Second step is analyzing traces and confirming that no memory leak or buffer exhaustion occurred. Third step is confirming health score reached ninety five percent and ready for production deployment.';
      engine.speak(threeSentences);

      // Simulate chunk 0 finishing
      mockSynth.simulateChunkFinished(0);
      // Simulate chunk 1 finishing
      mockSynth.simulateChunkFinished(1);
      // Simulate chunk 2 finishing
      mockSynth.simulateChunkFinished(2);
    });

    test('pauses and resumes active playback', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      engine.speak('A test sentence for pause and resume functionality.');
      assert.equal(engine.status, 'playing');

      engine.pause();
      assert.equal(engine.status, 'paused');
      assert.equal(mockSynth.paused, true);

      engine.resume();
      assert.equal(engine.status, 'playing');
      assert.equal(mockSynth.paused, false);
    });

    test('stopping playback cancels speech, invalidates session, and resets queue', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      engine.speak('Sentence one. Sentence two. Sentence three.');
      const initialSessionId = engine.sessionId;
      assert.equal(engine.status, 'playing');

      engine.stop();
      assert.equal(engine.status, 'stopped');
      assert.ok(engine.sessionId > initialSessionId);
      assert.equal(engine.currentUtterance, null);
      assert.equal(mockSynth.speaking, false);
    });

    test('prevents stale callbacks from prior sessions from advancing new session', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      engine.speak('Old session sentence one. Old session sentence two.');
      const oldSession = engine.sessionId;

      // User immediately clicks Stop and starts a new playback
      engine.stop();
      engine.speak('New session sentence one.');
      const newSession = engine.sessionId;
      assert.notEqual(oldSession, newSession);

      // Trigger old session chunk callback
      engine._speakChunk(1, oldSession);

      // Verify that engine did NOT process chunk under old session
      assert.equal(engine.sessionId, newSession);
    });

    test('restart replays from the very first chunk cleanly', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      const multichunk = 'First long sentence describing architecture and all components in detail. Second long sentence describing deployment pipelines and verification steps. Third long sentence confirming all operational telemetry indicators are healthy.';
      engine.speak(multichunk);
      assert.ok(engine.chunks.length >= 2);
      mockSynth.simulateChunkFinished(0);
      assert.equal(engine.currentIndex, 1);

      engine.restart();
      assert.equal(engine.currentIndex, 0);
      assert.equal(engine.status, 'playing');
    });

    test('setRate clamps rate between 0.5 and 2.0', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      engine.setRate(0.2); // too low
      assert.equal(engine.rate, 0.5);

      engine.setRate(3.5); // too high
      assert.equal(engine.rate, 2.0);

      engine.setRate(0.92);
      assert.equal(engine.rate, 0.92);
    });

    test('genuine utterance errors halt queue and are surfaced clearly without claiming completion', (t, done) => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      let completeFired = false;
      let errorFired = false;
      engine.onComplete(() => { completeFired = true; });
      engine.onError((err) => {
        errorFired = true;
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('not-allowed'));
      });

      engine.speak('Sentence one for error test. Sentence two.');
      assert.equal(engine.status, 'playing');

      // Simulate genuine failure on chunk 0
      const utterance0 = mockSynth.queue[0];
      utterance0.onerror({ error: 'not-allowed' });

      assert.equal(engine.status, 'error');
      assert.equal(errorFired, true);
      assert.equal(completeFired, false, 'Engine must NEVER claim completion on genuine error');
      assert.equal(engine.watchdogTimer, null, 'Watchdog timer must be cleared on error');
      done();
    });

    test('watchdog timer lifecycle: arms on speak, clears on pause, resumes on resume, clears on stop', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      engine.speak('Sentence for testing watchdog lifecycle.');
      assert.equal(engine.status, 'playing');
      assert.ok(engine.watchdogTimer !== null, 'Watchdog should be armed when chunk is dispatched');

      engine.pause();
      assert.equal(engine.status, 'paused');
      assert.equal(engine.watchdogTimer, null, 'Watchdog must be disarmed while paused');

      engine.resume();
      assert.equal(engine.status, 'playing');
      assert.ok(engine.watchdogTimer !== null, 'Watchdog must be re-armed when resumed');

      engine.stop();
      assert.equal(engine.status, 'stopped');
      assert.equal(engine.watchdogTimer, null, 'Watchdog must be disarmed when stopped');
    });

    test('rapid session replacement cancels previous session and starts new session cleanly', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      // Start session A
      engine.speak('Session A text for testing rapid session replacement.');
      const sessionA = engine.sessionId;
      const utteranceA = mockSynth.queue[0];

      // Immediately start session B
      engine.speak('Session B text which replaces session A immediately.');
      const sessionB = engine.sessionId;
      assert.notEqual(sessionA, sessionB);
      assert.equal(engine.status, 'playing');

      // Delayed callback from A fires now
      if (utteranceA && utteranceA.onend) {
        utteranceA.onend();
      }

      // Assert session B is still current and not corrupted by A
      assert.equal(engine.sessionId, sessionB);
      assert.equal(engine.status, 'playing');
      assert.ok(engine.rawText.includes('Session B'));
      engine.stop();
    });
  });

  // ========================================================================
  // 5. WATCHDOG RELIABILITY & STALE CALLBACK HARDENING (PHASE 2)
  // ========================================================================
  describe('5. Watchdog Reliability & Stale Callback Hardening (Phase 2)', () => {
    test('1. calculateWatchdogTimeout scales conservatively with chunk length and speed rate', () => {
      // 0 or short characters clamped to minimum 16,000ms
      assert.equal(calculateWatchdogTimeout('', 1.0), 16000);
      assert.equal(calculateWatchdogTimeout('Short utterance', 1.0), 16000);

      // Standard ~180-character chunk at rate 0.95 -> (180*1000)/(8*0.95) + 8000 = ~31684ms
      const timeoutStandard = calculateWatchdogTimeout('a'.repeat(180), 0.95);
      assert.ok(timeoutStandard >= 30000 && timeoutStandard <= 33000, `Expected ~31.7s, got ${timeoutStandard}`);

      // Slow rate (0.5x) on ~180-character chunk -> (180*1000)/(8*0.5) + 8000 = 53000ms
      const timeoutSlow = calculateWatchdogTimeout('a'.repeat(180), 0.5);
      assert.equal(timeoutSlow, 53000);

      // Extreme length capped at maximum 60,000ms
      const timeoutExtreme = calculateWatchdogTimeout('a'.repeat(800), 0.5);
      assert.equal(timeoutExtreme, 60000);
    });

    test('2. a valid utterance lasting longer than 16 seconds completes without watchdog interruption', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const mockSynth = new MockSpeechSynthesis();
        const engine = new ReadAloudEngine({ synth: mockSynth, rate: 0.95 });

        // Utterance of 160 chars
        const longSentence = 'This is an extensive and detailed technical sentence containing approximately one hundred and sixty characters to simulate an utterance taking twenty seconds to speak.';
        engine.speak(longSentence);

        assert.equal(engine.status, 'playing');
        assert.equal(mockSynth.queue.length, 1);
        const chunk0 = mockSynth.queue[0];

        // Advance 17 seconds (past previous 16s limit)
        mock.timers.tick(17000);

        // Assert: Watchdog must NOT have triggered! (status is still playing, recovery timer is null)
        assert.equal(engine.status, 'playing');
        assert.equal(engine.watchdogRecoveryTimer, null, 'Watchdog should not trigger at 17s for 160-char chunk');

        // Now chunk completes normally at 19 seconds
        mock.timers.tick(2000);
        chunk0.onend();

        assert.equal(engine.status, 'completed');
        assert.equal(engine.watchdogTimer, null);
      } finally {
        mock.timers.reset();
      }
    });

    test('3. speech at the slowest supported rate (0.5x) uses expanded safety timeout', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const mockSynth = new MockSpeechSynthesis();
        const engine = new ReadAloudEngine({ synth: mockSynth, rate: 0.5 });

        const slowText = 'A slower speech cadence requires extra speaking duration and must never be cut off prematurely by aggressive timeouts. ' +
          'The engine must grant ample time for clear pronunciation and natural delivery.';
        engine.speak(slowText);

        assert.equal(engine.status, 'playing');
        assert.equal(engine.rate, 0.5);

        // At rate 0.5, timeout should be ~40-53 seconds. Advance 25 seconds:
        mock.timers.tick(25000);
        assert.equal(engine.status, 'playing');
        assert.equal(engine.watchdogRecoveryTimer, null, 'Watchdog must not fire at 25s when speaking at 0.5x');

        // Simulate normal completion
        mockSynth.queue[0].onend();
        if (mockSynth.queue[1]) mockSynth.queue[1].onend();

        assert.equal(engine.status, 'completed');
      } finally {
        mock.timers.reset();
      }
    });

    test('4. normal onend completion clears all watchdog timers across multiple chunks', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      const text = 'First paragraph describing microservice health and active container cluster states in full detail.\n\n' +
        'Second paragraph describing database telemetry and cache hit rates across all regional instances.\n\n' +
        'Third paragraph confirming clean operations and zero critical errors found across all nodes.';
      engine.speak(text);

      assert.equal(engine.status, 'playing');
      assert.equal(engine.chunks.length, 3);

      // Complete all chunks sequentially
      for (let i = 0; i < engine.chunks.length; i++) {
        assert.ok(engine.watchdogTimer !== null, `Watchdog should be armed for chunk ${i}`);
        mockSynth.queue[i].onend();
      }

      assert.equal(engine.status, 'completed');
      assert.equal(engine.watchdogTimer, null, 'Watchdog timer must be cleared on completion');
      assert.equal(engine.watchdogRecoveryTimer, null, 'Recovery timer must be cleared on completion');
    });

    test('5. watchdog timeout recovery advances stalled chunk after pause/resume attempt', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const mockSynth = new MockSpeechSynthesis();
        const engine = new ReadAloudEngine({ synth: mockSynth, rate: 0.95 });

        const multiChunkText = 'First lengthy diagnostic paragraph detailing telemetry metrics that experiences a simulated browser synthesis hang.\n\n' +
          'Second diagnostic paragraph detailing storage replication that should be played once the watchdog recovers.\n\n' +
          'Third diagnostic paragraph concluding the inspection.';
        engine.speak(multiChunkText);

        assert.equal(engine.currentIndex, 0);
        const timeout = calculateWatchdogTimeout(mockSynth.queue[0].text, 0.95);

        // Advance past watchdog timeout
        mock.timers.tick(timeout + 50);
        assert.ok(engine.watchdogRecoveryTimer !== null, 'Recovery timer should be armed after stall');

        // Advance 2000ms recovery window
        mock.timers.tick(2050);

        // Assert: Engine advanced to chunk 1
        assert.equal(engine.currentIndex, 1, 'Engine must advance to chunk 1 after watchdog recovery');
        assert.equal(engine.status, 'playing');
        engine.stop();
      } finally {
        mock.timers.reset();
      }
    });

    test('6. a late onend after watchdog recovery does not advance the queue twice', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const mockSynth = new MockSpeechSynthesis();
        const engine = new ReadAloudEngine({ synth: mockSynth, rate: 0.95 });

        const multiChunkText = 'Chunk zero paragraph that will stall in browser synthesis engine and trigger watchdog timeout recovery.\n\n' +
          'Chunk one paragraph that starts playing immediately following watchdog recovery intervention.\n\n' +
          'Chunk two paragraph that must not be skipped or prematurely triggered by chunk zero.';
        engine.speak(multiChunkText);

        assert.equal(engine.currentIndex, 0);
        const chunk0Utterance = mockSynth.queue[0];
        const originalChunk0OnEnd = chunk0Utterance.onend; // Capture original callback reference
        const timeout = calculateWatchdogTimeout(chunk0Utterance.text, 0.95);

        // Trigger watchdog recovery to advance to chunk 1
        mock.timers.tick(timeout + 50);
        mock.timers.tick(2050);
        assert.equal(engine.currentIndex, 1, 'Watchdog should advance to chunk 1');

        // Verify that watchdog detached listeners from the stalled utterance
        assert.equal(chunk0Utterance.onend, null, 'Stalled utterance onend must be detached');

        // Now simulate delayed execution of the original onend closure
        if (originalChunk0OnEnd) originalChunk0OnEnd();

        // Engine must STILL be on chunk 1 (NOT advanced to chunk 2)
        assert.equal(engine.currentIndex, 1, 'Late onend from chunk 0 must NOT advance queue to chunk 2');
        engine.stop();
      } finally {
        mock.timers.reset();
      }
    });

    test('7. a late onerror after watchdog recovery does not abort active playback', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const mockSynth = new MockSpeechSynthesis();
        const engine = new ReadAloudEngine({ synth: mockSynth, rate: 0.95 });

        const multiChunkText = 'Chunk zero paragraph detailing telemetry metrics that will stall in browser synthesis and trigger watchdog timeout recovery.\n\n' +
          'Chunk one paragraph detailing storage replication that becomes active after watchdog recovery and continues execution.\n\n' +
          'Chunk two paragraph concluding the inspection and confirming all indicators are nominal and verified.';
        engine.speak(multiChunkText);

        assert.equal(engine.chunks.length, 3);
        const chunk0Utterance = mockSynth.queue[0];
        const originalChunk0OnError = chunk0Utterance.onerror;
        const timeout = calculateWatchdogTimeout(chunk0Utterance.text, 0.95);

        // Advance via watchdog
        mock.timers.tick(timeout + 50);
        mock.timers.tick(2050);
        assert.equal(engine.currentIndex, 1);

        // Verify that watchdog detached listeners from the stalled utterance
        assert.equal(chunk0Utterance.onerror, null, 'Stalled utterance onerror must be detached');

        // Now chunk 0 fires late error via original closure
        if (originalChunk0OnError) originalChunk0OnError({ error: 'synthesis-failed' });

        // Assert: Engine status must NOT be error
        assert.equal(engine.status, 'playing', 'Late onerror from superseded chunk must not fail active engine');
        engine.stop();
      } finally {
        mock.timers.reset();
      }
    });

    test('8. stop while a watchdog is pending cleans up all timers and aborts callbacks', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const mockSynth = new MockSpeechSynthesis();
        const engine = new ReadAloudEngine({ synth: mockSynth });

        engine.speak('A diagnostic sentence for testing stop while watchdog is pending.');
        assert.ok(engine.watchdogTimer !== null);

        // User clicks stop
        engine.stop();

        assert.equal(engine.status, 'stopped');
        assert.equal(engine.watchdogTimer, null, 'watchdogTimer must be null after stop');
        assert.equal(engine.watchdogRecoveryTimer, null, 'watchdogRecoveryTimer must be null after stop');

        // Advance timers by 60s
        mock.timers.tick(60000);

        // Assert: Engine stays stopped, does not attempt speech
        assert.equal(engine.status, 'stopped');
      } finally {
        mock.timers.reset();
      }
    });

    test('9. restart while speech is active cancels current chunk and restarts at chunk 0', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      const multiText = 'First paragraph describing the repository architecture and deployment state. Second paragraph detailing microservice telemetry and latency metrics. Third paragraph concluding inspection.';
      engine.speak(multiText);

      // Advance to chunk 1
      mockSynth.queue[0].onend();
      assert.equal(engine.currentIndex, 1);

      // Click restart
      engine.restart();

      assert.equal(engine.status, 'playing');
      assert.equal(engine.currentIndex, 0, 'Restart must begin from chunk 0');
      engine.stop();
    });

    test('10. session replacement during playback prevents previous session from advancing', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      // Start Response A
      engine.speak('Response A sentence one. Response A sentence two.');
      const sessionA = engine.sessionId;
      const uttA = mockSynth.queue[0];

      // Immediately replace with Response B
      engine.speak('Response B sentence one. Response B sentence two.');
      const sessionB = engine.sessionId;
      assert.notEqual(sessionA, sessionB);

      // Simulate late onend on Response A
      if (uttA && uttA.onend) uttA.onend();

      // Assert Response B is still on chunk 0
      assert.equal(engine.sessionId, sessionB);
      assert.equal(engine.currentIndex, 0);
      assert.ok(engine.rawText.includes('Response B'));
      engine.stop();
    });

    test('11. pause and resume does not duplicate chunk advancement or watchdog timers', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      const multiText = 'Sentence one of the multi chunk message detailing initial telemetry indicators and microservice latency across nodes.\n\n' +
        'Sentence two of the multi chunk message detailing storage replication state and database snapshot consistency.\n\n' +
        'Sentence three of the message concluding inspection and verifying all components are healthy.';
      engine.speak(multiText);

      assert.equal(engine.status, 'playing');
      assert.equal(engine.chunks.length, 3);
      assert.ok(engine.watchdogTimer !== null);

      // Pause
      engine.pause();
      assert.equal(engine.status, 'paused');
      assert.equal(engine.watchdogTimer, null, 'Watchdog must be null while paused');

      // Resume
      engine.resume();
      assert.equal(engine.status, 'playing');
      assert.ok(engine.watchdogTimer !== null, 'Watchdog must re-arm upon resume');

      // Chunk 0 finishes normally
      mockSynth.queue[0].onend();
      assert.equal(engine.currentIndex, 1, 'Should advance to chunk 1 exactly once');
      engine.stop();
    });

    test('12. empty input and final-chunk completion transition cleanly without hanging', () => {
      const mockSynth = new MockSpeechSynthesis();
      const engine = new ReadAloudEngine({ synth: mockSynth });

      let completeFired = false;
      engine.onComplete(() => { completeFired = true; });

      // Empty input
      const res = engine.speak('   ');
      assert.equal(res, false);
      assert.equal(completeFired, true);
      assert.equal(engine.status, 'completed');
      assert.equal(engine.watchdogTimer, null);

      // Single chunk completion
      completeFired = false;
      engine.speak('Single short sentence.');
      assert.equal(engine.status, 'playing');
      mockSynth.queue[0].onend();
      assert.equal(completeFired, true);
      assert.equal(engine.status, 'completed');
      assert.equal(engine.watchdogTimer, null);
    });
  });
});
