/**
 * ProjectPilot AI - Model Provider Abstraction
 * Supports the built-in LocalNaturalIntelligenceEngine (zero dependencies, 100% offline, free)
 * and an optional Cloud Model Provider (e.g. Gemini API) when credentials are provided.
 */

export class LocalNaturalIntelligenceEngine {
  constructor(options = {}) {
    this.name = 'LocalNaturalIntelligenceEngine';
    this.providerName = 'local-natural-intelligence';
    this.isLocal = true;
    this.provider = 'built-in';
  }

  async generate({ prompt, context = {}, systemInstruction = '' }) {
    // Return structured operational envelope indicating local deterministic intelligence
    return {
      provider: this.name,
      isLocal: true,
      text: null, // Signals caller to use the NaturalResponseEngine templates
      metadata: {
        offlineCapable: true,
        zeroCost: true,
        latencyMs: 1
      }
    };
  }

  async generateResponse({ intent, query, context = {}, language = 'en' }) {
    return {
      provider: 'local-natural-intelligence',
      isExternalLlm: false,
      content: `Local analysis complete for intent "${intent}".`,
      language
    };
  }
}

export class GeminiModelProvider {
  constructor(apiKey, options = {}) {
    this.name = 'GeminiModelProvider';
    this.apiKey = apiKey;
    this.modelName = options.modelName || 'gemini-2.5-flash';
    this.timeoutMs = options.timeoutMs || 8000;
  }

  async generate({ prompt, context = {}, systemInstruction = '' }) {
    if (!this.apiKey) {
      throw new Error('Gemini API key is not configured.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
      const payload = {
        contents: [{
          role: 'user',
          parts: [{ text: `${systemInstruction ? systemInstruction + '\n\n' : ''}Context: ${JSON.stringify(context)}\n\nUser Request: ${prompt}` }]
        }]
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Gemini API returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

      return {
        provider: this.name,
        isLocal: false,
        text: generatedText,
        metadata: {
          model: this.modelName
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ModelProvider {
  constructor(options = {}) {
    this.localEngine = new LocalNaturalIntelligenceEngine();
    this.cloudProvider = options.apiKey ? new GeminiModelProvider(options.apiKey, options) : null;
  }

  setApiKey(apiKey) {
    this.cloudProvider = apiKey ? new GeminiModelProvider(apiKey) : null;
  }

  hasCloudProvider() {
    return Boolean(this.cloudProvider);
  }

  async generate(request) {
    if (this.cloudProvider) {
      try {
        const result = await this.cloudProvider.generate(request);
        if (result && result.text) return result;
      } catch (err) {
        console.warn('Cloud model provider error, falling back to local natural intelligence engine:', err.message);
      }
    }
    return this.localEngine.generate(request);
  }
}
