/**
 * ProjectPilot AI - READ ALOUD 2.0 Engine
 * Full-Response Playback, Natural Voice, Intelligent Chunking, and Speech Reliability.
 * 
 * Solves the Chromium 4-5 line stoppage, handles long multiline technical reports,
 * normalizes Markdown/tables/code/URLs, supports multilingual content (English, Hindi, Marathi),
 * and prevents browser garbage collection stalls.
 */

// Global set holding active SpeechSynthesisUtterance references to prevent V8 garbage collection
const _activeUtterances = new Set();

/**
 * Common technical and markdown patterns for speech normalization
 */
const CODE_FENCE_REGEX = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`]+)`/g;
const MARKDOWN_HEADER_REGEX = /^(#{1,6})\s+(.+)$/gm;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;
const BARE_URL_REGEX = /\bhttps?:\/\/[^\s<>)"]+/gi;
const MARKDOWN_BOLD_ITALIC_REGEX = /(\*\*|__)(.*?)\1|(\*|_)(.*?)\3/g;
const MARKDOWN_STRIKE_REGEX = /~~(.*?)~~/g;
const BLOCKQUOTE_REGEX = /^\s*>\s*(.+)$/gm;
const HTML_TAG_REGEX = /<[^>]+>/g;
const MULTI_NEWLINE_REGEX = /\n{2,}/g;
const MULTI_SPACE_REGEX = /[ \t]+/g;
const TABLE_DIVIDER_REGEX = /^\|?[-:\s|]+\|?$/;
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

// Known Marathi distinctive tokens in Devanagari
const MARATHI_TOKENS = new Set([
  'आहे', 'आहेत', 'नाही', 'नाहीत', 'माझा', 'माझी', 'माझे', 'आमचा', 'आमची',
  'काय', 'झाला', 'झाली', 'झाले', 'येतोय', 'येते', 'दाखवा', 'सांगा', 'करा',
  'होत', 'होते', 'काम', 'बघा', 'कशामुळे', 'मदत', 'परत', 'सुरू', 'बंद'
]);

/**
 * Detects whether text is primarily Marathi, Hindi, or English.
 * @param {string} text
 * @returns {'mr'|'hi'|'en'}
 */
export function detectSpeechLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';
  
  if (DEVANAGARI_REGEX.test(text)) {
    const words = text.split(/[\s,।॥.!?-]+/);
    for (const w of words) {
      if (MARATHI_TOKENS.has(w)) {
        return 'mr';
      }
    }
    return 'hi';
  }
  
  return 'en';
}

/**
 * Normalizes rich Markdown, code blocks, technical tables, identifiers, and URLs
 * into clean, natural spoken prose without losing content meaning.
 * 
 * @param {string} rawText
 * @returns {string}
 */
export function normalizeTextForSpeech(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText;

  // 1. Process multi-line code blocks
  text = text.replace(CODE_FENCE_REGEX, (_match, lang, code) => {
    const lines = code.trim().split('\n').filter(l => l.trim().length > 0);
    const langLabel = lang ? `${lang} ` : '';
    if (lines.length === 0) {
      return ` ${langLabel}code block. `;
    } else if (lines.length === 1) {
      return ` ${langLabel}code command: ${lines[0]}. `;
    } else {
      const firstLine = lines[0].replace(/[{}();]/g, '').trim();
      return ` ${langLabel}code snippet: ${firstLine}, and ${lines.length - 1} more lines. `;
    }
  });

  // 2. Process Markdown tables
  const lines = text.split('\n');
  const processedLines = [];
  let inTable = false;
  let tableHeaderCols = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      // Check if it's a divider row |---|---|
      if (TABLE_DIVIDER_REGEX.test(line)) {
        continue;
      }
      
      const cells = line.split('|')
        .slice(1, -1)
        .map(c => c.trim())
        .filter(c => c.length > 0);

      if (!inTable) {
        // Table header row
        inTable = true;
        tableHeaderCols = cells;
        processedLines.push(`Table with columns: ${cells.join(', ')}.`);
      } else {
        // Table data row
        if (tableHeaderCols.length > 0 && cells.length === tableHeaderCols.length) {
          const rowDesc = cells.map((cell, idx) => `${tableHeaderCols[idx]}: ${cell}`).join(', ');
          processedLines.push(`Item: ${rowDesc}.`);
        } else {
          processedLines.push(`Row: ${cells.join(', ')}.`);
        }
      }
    } else {
      inTable = false;
      tableHeaderCols = [];
      processedLines.push(lines[i]);
    }
  }
  text = processedLines.join('\n');

  // 3. Process markdown headers (# Header -> Header.)
  text = text.replace(MARKDOWN_HEADER_REGEX, (_match, _hashes, title) => {
    return `${title.trim()}. `;
  });

  // 4. Process blockquotes (> Quote -> Note: Quote)
  text = text.replace(BLOCKQUOTE_REGEX, (_match, quote) => {
    return `Note: ${quote.trim()}. `;
  });

  // 5. Process Markdown links [label](url) -> label
  text = text.replace(MARKDOWN_LINK_REGEX, (_match, label) => {
    return label;
  });

  // 6. Simplify bare URLs (https://github.com/org/repo -> github dot com slash org slash repo)
  text = text.replace(BARE_URL_REGEX, (url) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace('www.', '');
      const pathParts = parsed.pathname.split('/').filter(p => p.length > 0);
      if (pathParts.length > 0) {
        return `${host} path ${pathParts.join(' slash ')}`;
      }
      return `${host}`;
    } catch {
      return url.replace(/^https?:\/\//i, '').replace(/\//g, ' slash ');
    }
  });

  // 7. Process inline code `identifier` (replace underscores/dashes with spaces for natural pronunciation)
  text = text.replace(INLINE_CODE_REGEX, (_match, code) => {
    let cleanCode = code.replace(/_/g, ' ');
    cleanCode = cleanCode.replace(/-/g, ' ');
    cleanCode = cleanCode.replace(/([a-z])([A-Z])/g, '$1 $2'); // camelCase separation
    cleanCode = cleanCode.replace(/=/g, ' equals ');
    return ` ${cleanCode} `;
  });

  // 8. Convert intra-word underscores to spaces for natural pronunciation (e.g. FINAL_SENTINEL_2026 -> FINAL SENTINEL 2026)
  text = text.replace(/([a-zA-Z0-9])_([a-zA-Z0-9])/g, '$1 $2');

  // 9. Process bullet points (*, -, +) and numbered items (1., 2.)
  text = text.replace(/^\s*[-*+]\s+(.+)$/gm, '• $1. ');
  text = text.replace(/^\s*(\d+)\.\s+(.+)$/gm, 'Step $1: $2. ');

  // 10. Remove bold, italic, strikethrough formatting markers
  text = text.replace(MARKDOWN_BOLD_ITALIC_REGEX, (_match, p1, p2, p3, p4) => p2 || p4 || '');
  text = text.replace(MARKDOWN_STRIKE_REGEX, '$1');

  // 11. Strip remaining HTML tags
  text = text.replace(HTML_TAG_REGEX, ' ');

  // 12. Normalize common technical acronyms and symbols
  text = text.replace(/\bMCP\b/g, 'M C P');
  text = text.replace(/\bAPI\b/g, 'A P I');
  text = text.replace(/\bURL\b/g, 'U R L');
  text = text.replace(/\bJSON\b/g, 'Jason');
  text = text.replace(/\bCI\/CD\b/g, 'C I C D');
  text = text.replace(/\bPR\b/g, 'P R');
  text = text.replace(/\bAST\b/g, 'A S T');
  text = text.replace(/&amp;/g, ' and ');
  text = text.replace(/&lt;/g, ' less than ');
  text = text.replace(/&gt;/g, ' greater than ');

  // 13. Normalize surrogate pairs / emojis gently (convert common emojis to natural words or remove unpronounceable symbols)
  text = text.replace(/⚡/g, ' lightning ');
  text = text.replace(/🔍/g, ' search ');
  text = text.replace(/🛑/g, ' stop ');
  text = text.replace(/📋/g, ' tasks ');
  text = text.replace(/🔧/g, ' maintenance ');
  text = text.replace(/🚀/g, ' rocket ');
  text = text.replace(/⚠️/g, ' warning ');
  text = text.replace(/✅/g, ' completed ');
  text = text.replace(/❌/g, ' failed ');
  text = text.replace(/📅/g, ' scheduled ');
  text = text.replace(/✦/g, ' ');

  // 14. Clean up excessive punctuation and collapse spaces
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(MULTI_SPACE_REGEX, ' ');
  text = text.replace(MULTI_NEWLINE_REGEX, '\n');

  return text.trim();
}

/**
 * Splits text into safe, natural sentence/clause chunks respecting boundaries
 * and preserving multi-byte Unicode (Devanagari, surrogate pairs).
 * 
 * Target chunk length: ~180 characters (10-12s spoken audio)
 * 
 * @param {string} text
 * @param {number} [maxChunkLen=180]
 * @returns {string[]}
 */
export function chunkTextForSpeech(text, maxChunkLen = 180) {
  if (!text || typeof text !== 'string') return [];

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // If text is already under maxChunkLen, return single chunk
  if (trimmed.length <= maxChunkLen) {
    return [trimmed];
  }

  const rawChunks = [];

  // Split into paragraphs/lines first
  const paragraphs = trimmed.split(/\n+/);

  for (const para of paragraphs) {
    const cleanPara = para.trim();
    if (!cleanPara) continue;

    // Split paragraph by sentence terminators: . ! ? । (Devanagari danda) ॥ (double danda)
    // Positive lookbehind preserves terminator with the sentence
    const sentences = cleanPara.split(/(?<=[.!?।॥])\s+/);

    for (let s of sentences) {
      s = s.trim();
      if (!s) continue;

      if (s.length <= maxChunkLen) {
        rawChunks.push(s);
      } else {
        // Sentence is longer than maxChunkLen, subdivide by clause boundaries
        const clauses = s.split(/(?<=[,;:\u2014\u2013-])\s+/);
        let currentClauseAccum = '';

        for (const cl of clauses) {
          const trimmedCl = cl.trim();
          if (!trimmedCl) continue;

          if (currentClauseAccum.length === 0) {
            currentClauseAccum = trimmedCl;
          } else if (currentClauseAccum.length + 1 + trimmedCl.length <= maxChunkLen) {
            currentClauseAccum += ' ' + trimmedCl;
          } else {
            rawChunks.push(currentClauseAccum);
            currentClauseAccum = trimmedCl;
          }

          // If a single clause is still too long, split by words
          if (currentClauseAccum.length > maxChunkLen) {
            const words = currentClauseAccum.split(/\s+/);
            let wordAccum = '';
            for (const w of words) {
              if (wordAccum.length === 0) {
                wordAccum = w;
              } else if (wordAccum.length + 1 + w.length <= maxChunkLen) {
                wordAccum += ' ' + w;
              } else {
                rawChunks.push(wordAccum);
                wordAccum = w;
              }

              // Ultra-edge case: single word exceeds maxChunkLen -> atomic code point slice
              if (wordAccum.length > maxChunkLen) {
                const codePoints = Array.from(wordAccum);
                while (codePoints.length > 0) {
                  const piece = codePoints.splice(0, maxChunkLen).join('');
                  rawChunks.push(piece);
                }
                wordAccum = '';
              }
            }
            currentClauseAccum = wordAccum;
          }
        }

        if (currentClauseAccum.length > 0) {
          rawChunks.push(currentClauseAccum);
        }
      }
    }
  }

  // Combine consecutive short chunks if their combined length <= maxChunkLen
  const optimizedChunks = [];
  let buffer = '';

  for (const chunk of rawChunks) {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk) continue;

    if (!buffer) {
      buffer = trimmedChunk;
    } else if (buffer.length + 1 + trimmedChunk.length <= maxChunkLen) {
      buffer += ' ' + trimmedChunk;
    } else {
      optimizedChunks.push(buffer);
      buffer = trimmedChunk;
    }
  }

  if (buffer) {
    optimizedChunks.push(buffer);
  }

  return optimizedChunks;
}

/**
 * Finds the best natural voice matching the requested language and preference.
 * 
 * @param {SpeechSynthesisVoice[]} voices
 * @param {'mr'|'hi'|'en'} lang
 * @param {string|null} preferredVoiceUri
 * @returns {SpeechSynthesisVoice|null}
 */
export function getBestVoice(voices, lang = 'en', preferredVoiceUri = null) {
  if (!voices || voices.length === 0) return null;

  // 1. User preferred voice match
  if (preferredVoiceUri) {
    const matched = voices.find(v => v.voiceURI === preferredVoiceUri);
    if (matched) return matched;
  }

  const naturalNamePatterns = /natural|neural|google|online|samantha|daniel|karen|serena|arthur|ava|jenny|guy|aria/i;

  // 2. Language-specific matching
  if (lang === 'mr') {
    // Check Marathi
    const marathiVoice = voices.find(v => v.lang.startsWith('mr') || /marathi/i.test(v.name));
    if (marathiVoice) return marathiVoice;

    // Fallback to Hindi
    const hindiVoice = voices.find(v => v.lang.startsWith('hi') || /hindi/i.test(v.name));
    if (hindiVoice) return hindiVoice;

    // Fallback to Indian English
    const indianEnVoice = voices.find(v => v.lang === 'en-IN');
    if (indianEnVoice) return indianEnVoice;
  } else if (lang === 'hi') {
    // Check Hindi
    const hindiVoice = voices.find(v => v.lang.startsWith('hi') || /hindi/i.test(v.name));
    if (hindiVoice) return hindiVoice;

    // Fallback to Indian English
    const indianEnVoice = voices.find(v => v.lang === 'en-IN');
    if (indianEnVoice) return indianEnVoice;
  }

  // 3. English / Default matching with Natural voice prioritization
  const englishVoices = voices.filter(v => v.lang.startsWith('en'));

  if (englishVoices.length > 0) {
    // Prefer natural / neural English voices
    const naturalVoice = englishVoices.find(v => naturalNamePatterns.test(v.name));
    if (naturalVoice) return naturalVoice;

    // Prefer en-US / en-GB
    const standardVoice = englishVoices.find(v => v.lang === 'en-US' || v.lang === 'en-GB');
    if (standardVoice) return standardVoice;

    return englishVoices[0];
  }

  // 4. Default system fallback
  return voices.find(v => v.default) || voices[0] || null;
}

/**
 * Calculates a speed-aware, safety-bounded watchdog timeout in milliseconds.
 * 
 * Accounts for:
 * 1. Chunk character length (textLength)
 * 2. Playback speed rate (clamped between 0.5 and 2.0)
 * 3. Conservative slow-speaker baseline: 8 characters per second at 1.0x rate
 * 4. Jitter / pause buffer: +8,000ms for browser scheduling & clause pauses
 * 5. Bounded between MIN_WATCHDOG_TIMEOUT (16,000ms) and MAX_WATCHDOG_TIMEOUT (60,000ms)
 * 
 * @param {string} text - Chunk text
 * @param {number} [rate=0.95] - Speech rate (0.5 to 2.0)
 * @returns {number} Timeout in milliseconds
 */
export function calculateWatchdogTimeout(text, rate = 0.95) {
  const textLength = typeof text === 'string' ? text.length : 0;
  const clampedRate = Math.min(Math.max(Number(rate) || 0.95, 0.5), 2.0);

  // Conservative baseline: 8 characters/second at 1.0x rate
  // At rate R: speed is (8 * R) chars/second -> (textLength * 1000) / (8 * R) ms
  const estimatedDurationMs = Math.round((textLength * 1000) / (8 * clampedRate));

  // Add safety buffer (+8s) for browser audio thread init, punctuation pauses, and thread scheduling
  const totalCalculatedMs = estimatedDurationMs + 8000;

  // Clamp between safe bounds: min 16s, max 60s
  return Math.min(Math.max(totalCalculatedMs, 16000), 60000);
}

/**
 * ReadAloudEngine
 * Complete state machine, sequential playback queue, accessible controls,
 * and garbage-collection / stall protection.
 */
export class ReadAloudEngine {
  constructor(options = {}) {
    this.synth = options.synth || (typeof window !== 'undefined' ? window.speechSynthesis : null);
    
    // Playback state
    this.status = 'idle'; // 'idle' | 'playing' | 'paused' | 'stopped' | 'completed'
    this.rawText = '';
    this.normalizedText = '';
    this.chunks = [];
    this.currentIndex = 0;
    this.currentUtterance = null;
    this.sessionId = 0;
    this.activeMessageId = null;

    // Voice & Delivery settings
    this.rate = options.rate || 0.95; // Calm, steady cadence
    this.pitch = options.pitch || 1.0;
    this.volume = options.volume || 1.0;
    this.preferredVoiceUri = options.preferredVoiceUri || null;
    this.autoPlay = options.autoPlay !== undefined ? options.autoPlay : true;
    this.language = 'en';

    // Chunk watchdog timer to detect genuine browser synthesis stalls without periodic stutters
    this.watchdogTimer = null;
    this.watchdogRecoveryTimer = null;
    this.chunkDispatchId = 0;
    this._activeChunkResolver = null;

    // Event listeners
    this.listeners = {
      stateChange: new Set(),
      progress: new Set(),
      chunkStart: new Set(),
      chunkEnd: new Set(),
      complete: new Set(),
      error: new Set()
    };

    // Load persisted preferences if available
    this._loadSettings();

    // Bind voice change listener
    if (this.synth && typeof this.synth.addEventListener === 'function') {
      this.synth.addEventListener('voiceschanged', () => this._onVoicesChanged());
    } else if (this.synth && 'onvoiceschanged' in this.synth) {
      this.synth.onvoiceschanged = () => this._onVoicesChanged();
    }
  }

  /**
   * Loads voice and rate settings from localStorage.
   * @private
   */
  _loadSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('projectpilot_voice_settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.rate && typeof parsed.rate === 'number') {
            this.rate = Math.min(Math.max(parsed.rate, 0.5), 2.0);
          }
          if (parsed.preferredVoiceUri) {
            this.preferredVoiceUri = parsed.preferredVoiceUri;
          }
          if (typeof parsed.autoPlay === 'boolean') {
            this.autoPlay = parsed.autoPlay;
          }
        }
      }
    } catch {
      // Ignore security errors / sandboxed storage
    }
  }

  /**
   * Persists settings to localStorage.
   * @private
   */
  _saveSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('projectpilot_voice_settings', JSON.stringify({
          rate: this.rate,
          preferredVoiceUri: this.preferredVoiceUri,
          autoPlay: this.autoPlay
        }));
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Returns list of available browser voices.
   * @returns {SpeechSynthesisVoice[]}
   */
  getVoices() {
    if (!this.synth || typeof this.synth.getVoices !== 'function') return [];
    return this.synth.getVoices() || [];
  }

  /**
   * Sets reading speed rate (0.5 to 2.0).
   * @param {number} rate
   */
  setRate(rate) {
    this.rate = Math.min(Math.max(Number(rate) || 0.95, 0.5), 2.0);
    this._saveSettings();
  }

  /**
   * Sets preferred voice URI.
   * @param {string|null} voiceUri
   */
  setVoice(voiceUri) {
    this.preferredVoiceUri = voiceUri;
    this._saveSettings();
  }

  /**
   * Sets auto-play toggle.
   * @param {boolean} enabled
   */
  setAutoPlay(enabled) {
    this.autoPlay = !!enabled;
    this._saveSettings();
  }

  /**
   * Starts reading text aloud from the beginning.
   * 
   * @param {string} text - Raw assistant text
   * @param {Object} [options]
   * @param {string} [options.messageId] - ID of message bubble being read
   * @param {'mr'|'hi'|'en'} [options.lang] - Override detected language
   * @returns {boolean}
   */
  speak(text, options = {}) {
    if (!this.synth) {
      this._emit('error', new Error('Speech synthesis is not supported in this environment.'));
      return false;
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      this.stop();
      this._setState('completed');
      this._emit('complete', { totalChunks: 0 });
      return false;
    }

    // Stop existing playback & invalidate ongoing sessions
    this.stop();

    this.sessionId++;
    const currentSession = this.sessionId;

    this.rawText = text;
    this.activeMessageId = options.messageId || null;
    this.language = options.lang || detectSpeechLanguage(text);

    // Normalize and chunk
    this.normalizedText = normalizeTextForSpeech(text);
    this.chunks = chunkTextForSpeech(this.normalizedText);
    this.currentIndex = 0;

    if (this.chunks.length === 0) {
      this._clearWatchdog();
      this._setState('completed');
      this._emit('complete', { totalChunks: 0 });
      return true;
    }

    this._setState('playing');
    this._speakChunk(0, currentSession);

    return true;
  }

  /**
   * Speaks a specific chunk by index within the active session.
   * @private
   */
  _speakChunk(index, session) {
    if (session !== this.sessionId || this.status !== 'playing') {
      return;
    }

    if (index >= this.chunks.length) {
      this._clearWatchdog();
      this._activeChunkResolver = null;
      this._setState('completed');
      this._emit('complete', { totalChunks: this.chunks.length });
      return;
    }

    this.currentIndex = index;
    const chunkText = this.chunks[index];
    const dispatchId = ++this.chunkDispatchId;
    let isChunkResolved = false;

    // Per-chunk resolver guard: ensures each chunk advances or resolves the queue AT MOST ONCE
    const resolveChunk = (source) => {
      if (isChunkResolved) return false;
      if (session !== this.sessionId || this.chunkDispatchId !== dispatchId) return false;
      isChunkResolved = true;
      return true;
    };
    this._activeChunkResolver = resolveChunk;

    // Emit progress event
    this._emit('progress', {
      currentIndex: index,
      totalChunks: this.chunks.length,
      chunkText,
      percentage: Math.round(((index + 1) / this.chunks.length) * 100),
      messageId: this.activeMessageId
    });

    const UtteranceClass = typeof window !== 'undefined' && window.SpeechSynthesisUtterance 
      ? window.SpeechSynthesisUtterance 
      : (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);

    if (!UtteranceClass) {
      this._clearWatchdog();
      this._activeChunkResolver = null;
      this._setState('error');
      this._emit('error', new Error('SpeechSynthesisUtterance constructor unavailable.'));
      return;
    }

    const utterance = new UtteranceClass(chunkText);
    this.currentUtterance = utterance;

    // Configure voice properties
    const voices = this.getVoices();
    const voice = getBestVoice(voices, this.language, this.preferredVoiceUri);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = this.language === 'mr' ? 'mr-IN' : (this.language === 'hi' ? 'hi-IN' : 'en-US');
    }

    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    utterance.volume = this.volume;

    // Retain strong reference to prevent Chromium garbage collection
    _activeUtterances.add(utterance);

    // Arm speed-aware chunk watchdog timer
    this._startWatchdog(index, session, chunkText, dispatchId, utterance);

    utterance.onstart = () => {
      if (session === this.sessionId && this.chunkDispatchId === dispatchId) {
        this._emit('chunkStart', { index, chunkText, messageId: this.activeMessageId });
      }
    };

    utterance.onend = () => {
      this._clearWatchdog();
      _activeUtterances.delete(utterance);

      if (!resolveChunk('onend')) {
        return; // Stale or already resolved callback (e.g. by watchdog); prevent duplicate advance
      }

      if (session === this.sessionId && this.status === 'playing') {
        this._emit('chunkEnd', { index, chunkText, messageId: this.activeMessageId });
        // Sequentially queue next chunk
        this._speakChunk(index + 1, session);
      }
    };

    utterance.onerror = (event) => {
      this._clearWatchdog();
      _activeUtterances.delete(utterance);

      // 'canceled' or 'interrupted' is normal when user clicks Stop, restarts, or watchdog cancels stalled speech
      if (event && (event.error === 'canceled' || event.error === 'interrupted')) {
        return;
      }

      if (!resolveChunk('onerror')) {
        return; // Chunk already resolved (e.g. by watchdog recovery); ignore late error
      }

      const errType = event ? (event.error || 'unknown') : 'unknown';
      console.warn(`Speech synthesis error at chunk ${index}: ${errType}`);

      if (session === this.sessionId && this.status === 'playing') {
        // Genuine error: halt queue immediately, transition to error state, and do NOT falsely report completion
        this._setState('error');
        this._emit('error', new Error(`Speech synthesis error: ${errType}`));
      }
    };

    try {
      this.synth.speak(utterance);
    } catch (err) {
      this._clearWatchdog();
      _activeUtterances.delete(utterance);
      if (resolveChunk('catch')) {
        this._setState('error');
        this._emit('error', err);
      }
    }
  }

  /**
   * Pauses active speech playback.
   */
  pause() {
    if (this.status !== 'playing' || !this.synth) return;
    this._clearWatchdog();
    try {
      this.synth.pause();
    } catch {
      // Ignore
    }
    this._setState('paused');
  }

  /**
   * Resumes paused speech playback.
   */
  resume() {
    if (this.status !== 'paused' || !this.synth) return;
    this._setState('playing');
    try {
      this.synth.resume();
      if (this.chunks[this.currentIndex]) {
        this._startWatchdog(
          this.currentIndex,
          this.sessionId,
          this.chunks[this.currentIndex],
          this.chunkDispatchId,
          this.currentUtterance
        );
      }
    } catch {
      // Fallback: replay current chunk if browser fails resume
      this._speakChunk(this.currentIndex, this.sessionId);
    }
  }

  /**
   * Immediately stops speech and resets playback queue.
   */
  stop() {
    this.sessionId++; // Invalidate active session callbacks
    this.chunkDispatchId++; // Invalidate active chunk callbacks
    this._clearWatchdog();
    this._activeChunkResolver = null;

    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {
        // Ignore
      }
    }

    _activeUtterances.clear();
    this.currentUtterance = null;
    this.currentIndex = 0;
    this._setState('stopped');
  }

  /**
   * Restarts reading the current text from the very beginning.
   */
  restart() {
    if (!this.rawText) return;
    this.speak(this.rawText, {
      messageId: this.activeMessageId,
      lang: this.language
    });
  }

  /**
   * Arms chunk watchdog timer to detect genuine browser synthesis stalls without periodic audio stutters.
   * Dynamically calculates timeout based on chunk length and speech rate.
   * 
   * @param {number} index - Chunk index
   * @param {number} session - Active session ID
   * @param {string} chunkText - Chunk text to calculate duration
   * @param {number} dispatchId - Monotonic chunk dispatch identifier
   * @param {Object} [utterance] - Reference to active utterance
   * @private
   */
  _startWatchdog(index, session, chunkText, dispatchId, utterance) {
    this._clearWatchdog();
    if (typeof setTimeout === 'undefined') return;

    const timeoutMs = calculateWatchdogTimeout(chunkText, this.rate);

    this.watchdogTimer = setTimeout(() => {
      if (session !== this.sessionId || this.chunkDispatchId !== dispatchId || this.status !== 'playing') {
        return;
      }

      console.warn(`[ReadAloudEngine] Watchdog triggered for chunk ${index} (timeout: ${timeoutMs}ms, rate: ${this.rate}); attempting browser synthesis recovery.`);
      try {
        if (this.synth) {
          this.synth.pause();
          this.synth.resume();
        }
      } catch {
        // Ignore
      }

      // If still unrecovered after 2 seconds, advance stalled chunk
      this.watchdogRecoveryTimer = setTimeout(() => {
        if (session !== this.sessionId || this.chunkDispatchId !== dispatchId || this.status !== 'playing') {
          return;
        }

        console.warn(`[ReadAloudEngine] Watchdog advancing stalled chunk ${index} to prevent lockup.`);

        // 1. Mark this chunk as resolved so late onend/onerror callbacks cannot fire or advance
        if (typeof this._activeChunkResolver === 'function') {
          if (!this._activeChunkResolver('watchdog')) {
            return;
          }
        }

        // 2. Detach listeners from stalled utterance to prevent memory retention and late events
        if (utterance) {
          utterance.onend = null;
          utterance.onerror = null;
          utterance.onstart = null;
        }
        _activeUtterances.delete(utterance);

        // 3. Cancel stalled speech in synthesis engine safely
        try {
          if (this.synth) {
            this.synth.cancel();
          }
        } catch {
          // Ignore
        }

        // 4. Safely advance to next chunk
        this._speakChunk(index + 1, session);
      }, 2000);

      if (this.watchdogRecoveryTimer && typeof this.watchdogRecoveryTimer.unref === 'function') {
        this.watchdogRecoveryTimer.unref();
      }
    }, timeoutMs);

    if (this.watchdogTimer && typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref();
    }
  }

  /**
   * Clears watchdog and recovery timers safely.
   * @private
   */
  _clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.watchdogRecoveryTimer) {
      clearTimeout(this.watchdogRecoveryTimer);
      this.watchdogRecoveryTimer = null;
    }
  }

  /**
   * Internal state transition handler.
   * @private
   */
  _setState(newStatus) {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this._emit('stateChange', {
      status: this.status,
      messageId: this.activeMessageId,
      currentIndex: this.currentIndex,
      totalChunks: this.chunks.length
    });
  }

  /**
   * Voice changed callback.
   * @private
   */
  _onVoicesChanged() {
    // If user has not explicitly chosen a voice, dynamic resolution handles it
  }

  // Event subscription helpers
  onStateChange(fn) { this.listeners.stateChange.add(fn); return () => this.listeners.stateChange.delete(fn); }
  onProgress(fn) { this.listeners.progress.add(fn); return () => this.listeners.progress.delete(fn); }
  onChunkStart(fn) { this.listeners.chunkStart.add(fn); return () => this.listeners.chunkStart.delete(fn); }
  onChunkEnd(fn) { this.listeners.chunkEnd.add(fn); return () => this.listeners.chunkEnd.delete(fn); }
  onComplete(fn) { this.listeners.complete.add(fn); return () => this.listeners.complete.delete(fn); }
  onError(fn) { this.listeners.error.add(fn); return () => this.listeners.error.delete(fn); }

  /**
   * Internal event emitter.
   * @private
   */
  _emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => {
        try {
          fn(data);
        } catch (err) {
          console.error(`Error in ReadAloudEngine ${event} listener:`, err);
        }
      });
    }
  }
}
