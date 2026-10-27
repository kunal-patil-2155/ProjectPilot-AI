/**
 * ProjectPilot AI - Natural Language Understanding & Multilingual Intelligence System
 * Unified module exports.
 */

export { SpellingNormalizer, damerauLevenshtein, ABBREVIATIONS } from './spellingNormalizer.js';
export { LanguageDetector } from './languageDetector.js';
export { ConversationMemory } from './conversationMemory.js';
export { IntentClassifier, INTENTS } from './intentClassifier.js';
export { NaturalResponseEngine } from './naturalResponseEngine.js';
export { ModelProvider, LocalNaturalIntelligenceEngine, GeminiModelProvider } from './modelProvider.js';
